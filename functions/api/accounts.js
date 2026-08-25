import {
  ACCOUNT_ROLES,
  generateTemporaryPassword,
  passwordRecord,
  validatePassword,
  verifyPassword,
} from "./_account-auth.js";
import { d1All, d1Batch, d1First, hasD1 } from "./_d1.js";
import {
  ROLES,
  authorize,
  enforceRateLimit,
  handlePreflight,
  publicError,
  secureJson,
} from "./_security.js";

const METHODS = "GET, POST, OPTIONS";
const ORG_ID = "ORG-OTSINDO";

function normalizedEmail(value) {
  const email = String(value || "")
    .trim()
    .toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254
    ? email
    : null;
}

function profile(body) {
  const avatarUrl = String(body.avatarUrl || "").trim();
  return {
    avatarUrl:
      !avatarUrl || /^https:\/\/[a-z0-9.-]+(?:\/[^\s]*)?$/i.test(avatarUrl)
        ? avatarUrl || null
        : null,
    jobTitle:
      String(body.jobTitle || "")
        .trim()
        .slice(0, 100) || null,
    department:
      String(body.department || "")
        .trim()
        .slice(0, 100) || null,
    phone:
      String(body.phone || "")
        .trim()
        .replace(/[^0-9+() -]/g, "")
        .slice(0, 30) || null,
  };
}

function validClientIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(String).filter(Boolean))].slice(0, 200);
}

function validProjectIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(String).filter(Boolean))].slice(0, 500);
}

function clientScopeOperations(userId, clientIds) {
  return [
    {
      statement: "DELETE FROM user_client_scopes WHERE user_id=?",
      bindings: [userId],
    },
    ...clientIds.map((clientId) => ({
      statement: `INSERT OR IGNORE INTO user_client_scopes (user_id, client_id)
        SELECT ?, id FROM clients WHERE id=? AND org_id=?`,
      bindings: [userId, clientId, ORG_ID],
    })),
  ];
}

function projectScopeOperations(userId, projectIds, clientIds) {
  return [
    {
      statement: "DELETE FROM user_project_scopes WHERE user_id=?",
      bindings: [userId],
    },
    ...projectIds.map((projectId) => ({
      statement: `INSERT OR IGNORE INTO user_project_scopes (user_id, project_id)
        SELECT ?, id FROM projects WHERE id=? AND org_id=? AND client_id IN (${clientIds.map(() => "?").join(",")})`,
      bindings: [userId, projectId, ORG_ID, ...clientIds],
    })),
  ];
}

async function projectScopesAreValid(database, projectIds, clientIds) {
  if (!projectIds.length) return true;
  const row = await d1First(
    database,
    `SELECT COUNT(*) AS count FROM projects
    WHERE org_id=? AND id IN (${projectIds.map(() => "?").join(",")})
      AND client_id IN (${clientIds.map(() => "?").join(",")})`,
    [ORG_ID, ...projectIds, ...clientIds],
  );
  return Number(row?.count || 0) === projectIds.length;
}

async function activeSuperAdminCount(database) {
  const row = await d1First(
    database,
    "SELECT COUNT(*) AS count FROM app_users WHERE role='SUPER_ADMIN' AND status='ACTIVE'",
  );
  return Number(row?.count || 0);
}

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS")
    return handlePreflight(request, env, METHODS);
  if (!["GET", "POST"].includes(request.method))
    return secureJson(
      { error: "Method not allowed" },
      405,
      request,
      env,
      METHODS,
    );

  const authorization = await authorize(request, env, {
    roles: ROLES,
    mutating: request.method === "POST",
    methods: METHODS,
  });
  if (authorization.response) return authorization.response;
  const limited = await enforceRateLimit(
    request,
    env,
    authorization.actor,
    "accounts",
    METHODS,
  );
  if (limited) return limited;
  const respond = (data, status = 200) =>
    secureJson(data, status, request, env, METHODS);
  if (!hasD1(env)) return respond({ error: "Cloudflare D1 unavailable" }, 503);
  const database = env.DB;
  const actor = authorization.actor;
  const requestId = crypto.randomUUID();

  try {
    if (request.method === "GET") {
      if (actor.role !== "SUPER_ADMIN")
        return respond({ error: "Insufficient role" }, 403);
      const [users, clients, projects] = await Promise.all([
        d1All(
          database,
          `SELECT u.id, u.name, u.email, u.role, u.status, u.must_change_password,
          u.payment_approver, u.last_login_at, u.created_at, p.avatar_url, p.job_title, p.department, p.phone,
          (SELECT json_group_array(client_id) FROM user_client_scopes WHERE user_id=u.id) AS client_ids,
          (SELECT json_group_array(project_id) FROM user_project_scopes WHERE user_id=u.id) AS project_ids
          FROM app_users u LEFT JOIN app_user_profiles p ON p.user_id=u.id WHERE u.org_id=? ORDER BY u.created_at ASC`,
          [ORG_ID],
        ),
        d1All(
          database,
          "SELECT id, name FROM clients WHERE org_id=? ORDER BY name ASC",
          [ORG_ID],
        ),
        d1All(
          database,
          "SELECT id, client_id, code, name, status FROM projects WHERE org_id=? ORDER BY name ASC",
          [ORG_ID],
        ),
      ]);
      const ids = (value) => {
        try {
          return JSON.parse(value || "[]");
        } catch {
          return [];
        }
      };
      return respond({
        ok: true,
        users: users.map((user) => ({
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          status: user.status,
          mustChangePassword: user.must_change_password,
          paymentApprover: Boolean(user.payment_approver),
          clientIds: ids(user.client_ids),
          projectIds: ids(user.project_ids),
          avatarUrl: user.avatar_url,
          jobTitle: user.job_title,
          department: user.department,
          phone: user.phone,
          lastLoginAt: user.last_login_at,
          createdAt: user.created_at,
        })),
        clients,
        projects,
        roles: ACCOUNT_ROLES,
      });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return respond({ error: "Invalid JSON" }, 400);
    }
    if (body.action === "CHANGE_PASSWORD") {
      const newPassword = String(body.newPassword || "");
      const problem = validatePassword(newPassword);
      if (problem) return respond({ error: problem }, 422);
      const current = await d1First(
        database,
        "SELECT * FROM app_users WHERE id=? LIMIT 1",
        [actor.id],
      );
      if (
        !current ||
        !(await verifyPassword(String(body.currentPassword || ""), current))
      ) {
        return respond({ error: "Password saat ini tidak valid" }, 401);
      }
      const record = await passwordRecord(newPassword);
      await d1Batch(database, [
        {
          statement: `UPDATE app_users SET password_hash=?, password_salt=?, password_iterations=?,
          must_change_password=0, password_changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
          updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`,
          bindings: [record.hash, record.salt, record.iterations, actor.id],
        },
        {
          statement: "DELETE FROM app_sessions WHERE user_id=?",
          bindings: [actor.id],
        },
        {
          statement: `INSERT INTO audit_logs (id, org_id, username, role, action, detail, entity, entity_id)
          VALUES (?, ?, ?, ?, 'ACCOUNT_PASSWORD_CHANGED', ?, 'app_user', ?)`,
          bindings: [
            `AUD-${crypto.randomUUID()}`,
            ORG_ID,
            actor.email,
            actor.role,
            "Password diubah oleh pemilik akun; seluruh sesi dicabut",
            actor.id,
          ],
        },
      ]);
      return respond({ ok: true, sessionRevoked: true });
    }

    if (actor.role !== "SUPER_ADMIN")
      return respond({ error: "Insufficient role" }, 403);

    if (body.action === "CREATE") {
      const name = String(body.name || "")
        .trim()
        .slice(0, 120);
      const email = normalizedEmail(body.email);
      const role = String(body.role || "CLIENT_USER").toUpperCase();
      if (!name || !email || !ACCOUNT_ROLES.includes(role))
        return respond({ error: "Nama, email, atau role tidak valid" }, 422);
      const clientIds =
        role === "CLIENT_USER" ? validClientIds(body.clientIds) : [];
      const projectIds =
        role === "CLIENT_USER" ? validProjectIds(body.projectIds) : [];
      if (role === "CLIENT_USER" && !clientIds.length)
        return respond(
          { error: "CLIENT_USER wajib memiliki minimal satu client scope" },
          422,
        );
      if (!(await projectScopesAreValid(database, projectIds, clientIds)))
        return respond(
          { error: "Project scope harus berasal dari klien yang dipilih" },
          422,
        );
      const password = generateTemporaryPassword();
      const record = await passwordRecord(password);
      const id = `USR-${crypto.randomUUID()}`;
      const userProfile = profile(body);
      await d1Batch(database, [
        {
          statement: `INSERT INTO app_users
          (id, org_id, name, email, role, status, password_hash, password_salt, password_iterations,
            must_change_password, payment_approver, created_by)
          VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, 1, ?, ?)`,
          bindings: [
            id,
            ORG_ID,
            name,
            email,
            role,
            record.hash,
            record.salt,
            record.iterations,
            role === "PAYROLL_CONTROLLER" && Boolean(body.paymentApprover)
              ? 1
              : 0,
            actor.email,
          ],
        },
        ...clientScopeOperations(id, clientIds),
        ...projectScopeOperations(id, projectIds, clientIds),
        {
          statement: `INSERT INTO app_user_profiles(user_id,avatar_url,job_title,department,phone) VALUES(?,?,?,?,?)`,
          bindings: [
            id,
            userProfile.avatarUrl,
            userProfile.jobTitle,
            userProfile.department,
            userProfile.phone,
          ],
        },
        {
          statement: `INSERT INTO audit_logs (id, org_id, username, role, action, detail, entity, entity_id)
          VALUES (?, ?, ?, ?, 'ACCOUNT_CREATED', ?, 'app_user', ?)`,
          bindings: [
            `AUD-${crypto.randomUUID()}`,
            ORG_ID,
            actor.email,
            actor.role,
            `${email} · ${role}`,
            id,
          ],
        },
      ]);
      return respond(
        {
          ok: true,
          user: {
            id,
            name,
            email,
            role,
            status: "ACTIVE",
            clientIds,
            projectIds,
          },
          temporaryPassword: password,
        },
        201,
      );
    }

    if (body.action === "UPDATE") {
      const userId = String(body.userId || "");
      const existing = await d1First(
        database,
        "SELECT * FROM app_users WHERE id=? AND org_id=? LIMIT 1",
        [userId, ORG_ID],
      );
      if (!existing) return respond({ error: "User tidak ditemukan" }, 404);
      const role = String(body.role || existing.role).toUpperCase();
      const status = String(body.status || existing.status).toUpperCase();
      if (
        !ACCOUNT_ROLES.includes(role) ||
        !["ACTIVE", "SUSPENDED", "INACTIVE"].includes(status)
      )
        return respond({ error: "Role atau status tidak valid" }, 422);
      if (
        existing.role === "SUPER_ADMIN" &&
        existing.status === "ACTIVE" &&
        (role !== "SUPER_ADMIN" || status !== "ACTIVE") &&
        (await activeSuperAdminCount(database)) <= 1
      ) {
        return respond(
          {
            error:
              "Super Admin aktif terakhir tidak boleh dinonaktifkan atau diturunkan",
          },
          409,
        );
      }
      const name = String(body.name || existing.name)
        .trim()
        .slice(0, 120);
      const clientIds =
        role === "CLIENT_USER" ? validClientIds(body.clientIds) : [];
      const projectIds =
        role === "CLIENT_USER" ? validProjectIds(body.projectIds) : [];
      const userProfile = profile(body);
      if (role === "CLIENT_USER" && !clientIds.length)
        return respond(
          { error: "CLIENT_USER wajib memiliki minimal satu client scope" },
          422,
        );
      if (!(await projectScopesAreValid(database, projectIds, clientIds)))
        return respond(
          { error: "Project scope harus berasal dari klien yang dipilih" },
          422,
        );
      await d1Batch(database, [
        {
          statement: `UPDATE app_users SET name=?, role=?, status=?, payment_approver=?,
          updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`,
          bindings: [
            name,
            role,
            status,
            role === "PAYROLL_CONTROLLER" && Boolean(body.paymentApprover)
              ? 1
              : 0,
            userId,
          ],
        },
        ...clientScopeOperations(userId, clientIds),
        ...projectScopeOperations(userId, projectIds, clientIds),
        {
          statement: `INSERT INTO app_user_profiles(user_id,avatar_url,job_title,department,phone,updated_at)
          VALUES(?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(user_id) DO UPDATE SET
          avatar_url=excluded.avatar_url,job_title=excluded.job_title,department=excluded.department,phone=excluded.phone,updated_at=excluded.updated_at`,
          bindings: [
            userId,
            userProfile.avatarUrl,
            userProfile.jobTitle,
            userProfile.department,
            userProfile.phone,
          ],
        },
        ...(status !== "ACTIVE" || role !== existing.role
          ? [
              {
                statement: "DELETE FROM app_sessions WHERE user_id=?",
                bindings: [userId],
              },
            ]
          : []),
        {
          statement: `INSERT INTO audit_logs (id, org_id, username, role, action, detail, entity, entity_id)
          VALUES (?, ?, ?, ?, 'ACCOUNT_UPDATED', ?, 'app_user', ?)`,
          bindings: [
            `AUD-${crypto.randomUUID()}`,
            ORG_ID,
            actor.email,
            actor.role,
            `${existing.email} · ${role} · ${status}`,
            userId,
          ],
        },
      ]);
      return respond({ ok: true });
    }

    if (body.action === "RESET_PASSWORD") {
      const userId = String(body.userId || "");
      const user = await d1First(
        database,
        "SELECT id FROM app_users WHERE id=? AND org_id=? LIMIT 1",
        [userId, ORG_ID],
      );
      if (!user) return respond({ error: "User tidak ditemukan" }, 404);
      const password = generateTemporaryPassword();
      const record = await passwordRecord(password);
      await d1Batch(database, [
        {
          statement: `UPDATE app_users SET password_hash=?, password_salt=?, password_iterations=?,
          must_change_password=1, failed_login_attempts=0, locked_until=NULL,
          updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`,
          bindings: [record.hash, record.salt, record.iterations, userId],
        },
        {
          statement: "DELETE FROM app_sessions WHERE user_id=?",
          bindings: [userId],
        },
        {
          statement: `INSERT INTO audit_logs (id, org_id, username, role, action, detail, entity, entity_id)
          VALUES (?, ?, ?, ?, 'ACCOUNT_PASSWORD_RESET', ?, 'app_user', ?)`,
          bindings: [
            `AUD-${crypto.randomUUID()}`,
            ORG_ID,
            actor.email,
            actor.role,
            "Password sementara dibuat; seluruh sesi user dicabut",
            userId,
          ],
        },
      ]);
      return respond({ ok: true, temporaryPassword: password });
    }

    return respond({ error: "Action tidak dikenal" }, 422);
  } catch (error) {
    if (
      String(error?.message || "").includes(
        "UNIQUE constraint failed: app_users.email",
      )
    ) {
      return respond({ error: "Email sudah digunakan" }, 409);
    }
    return respond(publicError(error, requestId), 500);
  }
}
