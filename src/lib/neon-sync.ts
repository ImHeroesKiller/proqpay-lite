type SyncOptions = {
  requireData?: boolean;
  signal?: AbortSignal;
};

function companiesFromEmployees(employees: any[], existingCompanies: any[]) {
  const existing = new Map(
    (existingCompanies || []).map((company: any) => [company.name, company])
  );
  const names = Array.from(
    new Set(employees.map((employee) => employee.company).filter(Boolean))
  );

  return names.map((name, index) => {
    const current = existing.get(name);
    if (current) return current;
    const firstEmployee = employees.find((employee) => employee.company === name);
    return {
      id: `CMP-NEON-${index + 1}`,
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

export async function syncDatabaseFromNeon(db: any, options: SyncOptions = {}) {
  const response = await fetch('/api/employees', {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: options.signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || data.error || `HTTP ${response.status}`);
  }

  const employees = Array.isArray(data.employees) ? data.employees : [];
  if (!employees.length && !options.requireData) {
    return { db, count: 0, synced: false };
  }

  const nextDb = {
    ...db,
    employees,
    companies: companiesFromEmployees(employees, db.companies || []),
    meta: {
      ...db.meta,
      lastNeonSyncAt: Date.now(),
      dataSource: 'neon',
    },
  };
  return { db: nextDb, count: employees.length, synced: true };
}
