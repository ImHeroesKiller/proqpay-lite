type SyncOptions = {
  requireData?: boolean;
  signal?: AbortSignal;
};

function companiesFromEmployees(employees: any[]) {
  const names = Array.from(
    new Set(employees.map((employee) => employee.company).filter(Boolean))
  );

  return names.map((name, index) => {
    const firstEmployee = employees.find((employee) => employee.company === name);
    return {
      id: `CMP-D1-${index + 1}`,
      name,
      npwp: '',
      address: '',
      pic: '',
      phone: '',
      payrollType: 'BULANAN',
      payrollSetup: {
        type: 'BULANAN',
        umrRegion: firstEmployee?.region || 'DKI Jakarta',
        umrYear: 2025,
        bpjsKesehatan: true,
        bpjsKetenagakerjaan: true,
        pph21: true,
      },
    };
  });
}

function projectsFromEmployees(employees: any[]) {
  const keys = Array.from(new Set(employees.map((employee) => employee.project).filter(Boolean)));
  return keys.map((name, index) => {
    const firstEmployee = employees.find((employee) => employee.project === name);
    return {
      id: `PRJ-D1-${index + 1}`,
      name,
      company: firstEmployee?.company || '',
      region: firstEmployee?.region || '',
      status: 'ACTIVE',
    };
  });
}

async function fetchAllEmployees(signal?: AbortSignal) {
  const employees: any[] = [];
  let offset = 0;
  for (let page = 0; page < 1000; page += 1) {
    const response = await fetch(`/api/employees?limit=200&offset=${offset}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || `HTTP ${response.status}`);
    employees.push(...(Array.isArray(data.employees) ? data.employees : []));
    const nextOffset = data?.meta?.nextOffset;
    if (nextOffset === null || nextOffset === undefined) return employees;
    offset = Number(nextOffset);
    if (!Number.isFinite(offset) || offset < 0) throw new Error('Invalid employee pagination metadata');
  }
  throw new Error('Employee pagination exceeded safety limit');
}

export async function syncDatabaseFromCloudflare(db: any, options: SyncOptions = {}) {
  const [employees, stateResponse, directoryResponse, planResponse] = await Promise.all([
    fetchAllEmployees(options.signal),
    fetch('/api/state', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: options.signal,
    }),
    fetch('/api/client-projects', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: options.signal,
    }),
    fetch('/api/operating-model?resource=service-plans', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: options.signal,
    }).catch(() => null),
  ]);
  // A failed canonical source must not silently appear as a successful empty
  // sync. /api/state is intentionally forbidden to CLIENT_USER (403) and
  // service plans can also be unavailable by role; other failures are errors.
  if(!directoryResponse.ok)throw new Error(`DIRECTORY_SYNC_FAILED: HTTP ${directoryResponse.status}`);
  if(!stateResponse.ok && stateResponse.status!==403)throw new Error(`CANONICAL_STATE_SYNC_FAILED: HTTP ${stateResponse.status}`);
  if(planResponse && !planResponse.ok && planResponse.status!==403)throw new Error(`SERVICE_PLAN_SYNC_FAILED: HTTP ${planResponse.status}`);
  const [stateData, directoryData, planData] = await Promise.all([
    stateResponse.ok?stateResponse.json().catch(() => ({})):Promise.resolve({}),
    directoryResponse.json(),
    planResponse?.ok?planResponse.json().catch(() => ({})):Promise.resolve({}),
  ]);
  const directory = directoryData as any;
  const servicePlans = planResponse?.ok && Array.isArray((planData as any).servicePlans)
    ? (planData as any).servicePlans
    : [];
  const derivedCompanies = companiesFromEmployees(employees);
  const directoryClients = Array.isArray(directory.clients) ? directory.clients : [];
  const companies = directoryClients.length
    ? directoryClients.map((client: any) => {
        const derived = derivedCompanies.find((item: any) => item.name === client.name);
        return { ...derived, ...client, id: client.id, name: client.name };
      })
    : derivedCompanies;
  const derivedProjects = projectsFromEmployees(employees);
  const directoryProjects = Array.isArray(directory.projects) ? directory.projects : [];
  const projectNames = new Set(directoryProjects.map((project: any) => String(project.name).toLowerCase()));
  const projects = [
    ...directoryProjects.map((project: any) => ({
      ...project,
      company: project.client_name || project.company || '',
      region: project.province || project.region || '',
      status: project.status || 'ACTIVE',
    })),
    ...derivedProjects.filter((project: any) => !projectNames.has(String(project.name).toLowerCase())),
  ];
  const remoteState = stateResponse.ok && stateData?.state ? stateData.state : {};
  const canonicalState = Object.fromEntries(
    ['payrolls', 'approvals', 'invoices', 'arMonitor', 'auditLogs'].map((key) => [
      key,
      Array.isArray(remoteState[key]) ? remoteState[key] : [],
    ])
  );

  const nextDb = {
    ...db,
    employees,
    companies,
    projects,
    servicePlans,
    ...canonicalState,
    meta: {
      ...db.meta,
      lastCloudflareSyncAt: Date.now(),
      dataSource: 'cloudflare-d1',
    },
  };
  return { db: nextDb, count: employees.length, synced: true };
}

// G0: legacy business-state writes are disabled by /api/state (HTTP 410).
// Reject immediately instead of claiming success for a browser-only mutation.
export async function persistBusinessState(_db: any):Promise<never> {
  throw new Error('LEGACY_STATE_WRITE_DISABLED: Use canonical payroll, PI and billing APIs');
}
