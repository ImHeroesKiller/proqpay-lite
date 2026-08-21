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

export async function syncDatabaseFromCloudflare(db: any, options: SyncOptions = {}) {
  const [response, stateResponse, directoryResponse, planResponse] = await Promise.all([
    fetch('/api/employees', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: options.signal,
    }),
    fetch('/api/state', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: options.signal,
    }),
    fetch('/api/client-projects', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: options.signal,
    }).catch(() => null),
    fetch('/api/operating-model?resource=service-plans', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: options.signal,
    }).catch(() => null),
  ]);
  const [data, stateData, directoryData, planData] = await Promise.all([
    response.json().catch(() => ({})),
    stateResponse.json().catch(() => ({})),
    directoryResponse?.json().catch(() => ({})) || {},
    planResponse?.json().catch(() => ({})) || {},
  ]);
  if (!response.ok) throw new Error(data.message || data.error || `HTTP ${response.status}`);

  const employees = Array.isArray(data.employees) ? data.employees : [];
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

export async function persistBusinessState(db: any) {
  const state = {
    payrolls: db.payrolls || [],
    approvals: db.approvals || [],
    invoices: db.invoices || [],
    arMonitor: db.arMonitor || [],
    auditLogs: db.auditLogs || [],
  };
  const response = await fetch('/api/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || `HTTP ${response.status}`);
  return data;
}
