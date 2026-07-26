export type AppRole = 'SUPER_ADMIN' | 'PAYROLL' | 'HR' | 'FINANCE' | 'DIRECTOR' | 'VIEWER';

export type AppUser = {
  id: string;
  name: string;
  email: string;
  role: AppRole;
  active: boolean;
};

export type AppSettings = {
  orgName: string;
  defaultPeriod: string;
  serviceFeePerEmp: number;
  bpjsFeePerEmp: number;
  adminFee: number;
  currency: 'IDR';
  locale: 'id-ID';
  theme: 'light' | 'soft';
  density: 'comfortable' | 'compact';
  showSparklines: boolean;
  showMap: boolean;
  showClientDetail: boolean;
  idaTypingMs: number;
  idaShowCot: boolean;
  currentUserId: string;
  users: AppUser[];
};

const KEY = 'proqpay_settings_v2';

export const DEFAULT_SETTINGS: AppSettings = {
  orgName: 'ProQPay Demo Corp',
  defaultPeriod: '2025-07',
  serviceFeePerEmp: 1_500_000,
  bpjsFeePerEmp: 300_000,
  adminFee: 2_000_000,
  currency: 'IDR',
  locale: 'id-ID',
  theme: 'light',
  density: 'comfortable',
  showSparklines: true,
  showMap: true,
  showClientDetail: true,
  idaTypingMs: 28,
  idaShowCot: true,
  currentUserId: 'U1',
  users: [
    { id: 'U1', name: 'Super Admin', email: 'admin@proqpay.id', role: 'SUPER_ADMIN', active: true },
    { id: 'U2', name: 'Rina Payroll', email: 'payroll@proqpay.id', role: 'PAYROLL', active: true },
    { id: 'U3', name: 'Budi HR', email: 'hr@proqpay.id', role: 'HR', active: true },
    { id: 'U4', name: 'Sari Finance', email: 'finance@proqpay.id', role: 'FINANCE', active: true },
    { id: 'U5', name: 'Viewer Demo', email: 'viewer@proqpay.id', role: 'VIEWER', active: false },
  ],
};

export function loadSettings(): AppSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw), users: JSON.parse(raw).users || DEFAULT_SETTINGS.users };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: AppSettings) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEY, JSON.stringify(s));
  window.dispatchEvent(new CustomEvent('proqpay-settings'));
}

export function currentUser(s: AppSettings): AppUser {
  return s.users.find((u) => u.id === s.currentUserId) || s.users[0];
}

export function onSettingsChange(cb: () => void) {
  const h = () => cb();
  window.addEventListener('proqpay-settings', h);
  return () => window.removeEventListener('proqpay-settings', h);
}
