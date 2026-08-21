import fs from 'node:fs';
import { pbkdf2Sync, randomBytes } from 'node:crypto';

const outputPath = String(process.argv[2] || '').trim();
const email = String(process.env.PROQPAY_BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
const password = String(process.env.PROQPAY_BOOTSTRAP_ADMIN_PASSWORD || '');
const name = String(process.env.PROQPAY_BOOTSTRAP_ADMIN_NAME || 'ProQPay Super Admin').trim().slice(0, 120);

if (!outputPath) throw new Error('Path SQL bootstrap wajib diisi');
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
  throw new Error('PROQPAY_BOOTSTRAP_ADMIN_EMAIL tidak valid');
}
if (password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
  throw new Error('PROQPAY_BOOTSTRAP_ADMIN_PASSWORD wajib minimal 12 karakter dan mengandung huruf besar, huruf kecil, angka, serta simbol');
}
if (!name) throw new Error('Nama bootstrap admin tidak valid');

const escapeSql = (value) => String(value).replaceAll("'", "''");
const iterations = 100_000;
const salt = randomBytes(18).toString('base64url');
const hash = pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('base64url');
const userId = `USR-BOOTSTRAP-${randomBytes(12).toString('hex')}`;

const sql = `INSERT INTO app_users
  (id, org_id, name, email, role, status, password_hash, password_salt,
   password_iterations, must_change_password, payment_approver, created_by)
VALUES (
  '${escapeSql(userId)}', 'ORG-OTSINDO', '${escapeSql(name)}', '${escapeSql(email)}',
  'SUPER_ADMIN', 'ACTIVE', '${escapeSql(hash)}', '${escapeSql(salt)}',
  ${iterations}, 1, 1, 'SYSTEM_CUTOVER'
)
ON CONFLICT(email) DO UPDATE SET
  name=excluded.name,
  role='SUPER_ADMIN',
  status='ACTIVE',
  password_hash=excluded.password_hash,
  password_salt=excluded.password_salt,
  password_iterations=excluded.password_iterations,
  must_change_password=1,
  payment_approver=1,
  failed_login_attempts=0,
  locked_until=NULL,
  updated_at=datetime('now');
`;

fs.writeFileSync(outputPath, sql, { mode: 0o600 });
console.log('Bootstrap admin SQL prepared without exposing credentials.');
