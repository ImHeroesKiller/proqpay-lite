export type AppRole =
  | 'SUPER_ADMIN'
  | 'PAYROLL_PROCESSOR'
  | 'PAYROLL_CONTROLLER'
  | 'CLIENT_USER'
  | 'PAYROLL'
  | 'HR'
  | 'FINANCE'
  | 'DIRECTOR'
  | 'VIEWER';

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
  theme: 'light' | 'soft' | 'contrast';
  accentColor: 'indigo' | 'blue' | 'teal';
  density: 'comfortable' | 'compact';
  sidebarMode: 'expanded' | 'compact';
  enableAnimations: boolean;
  defaultView: 'dashboard' | 'operations' | 'employees' | 'clients' | 'reports';
  dashboardPageSize: number;
  employeePageSize: number;
  autoRefreshMinutes: number;
  showKpis: boolean;
  showWorkforceInsights: boolean;
  showClientPortfolio: boolean;
  showDataSourceBadges: boolean;
  showSparklines: boolean;
  showMap: boolean;
  showClientDetail: boolean;
  idaTypingMs: number;
  idaShowCot: boolean;
  idaCompactResponses: boolean;
  idaAutoSuggestions: boolean;
  maskSensitiveData: boolean;
  contractAlertDays: number;
  notifyDataQuality: boolean;
  notifyContractExpiry: boolean;
  notifyPayrollApproval: boolean;
  currentUserId: string;
  users: AppUser[];
};

const KEY = 'proqpay_settings_v3';

export const DEFAULT_SETTINGS: AppSettings = {
  orgName: 'ProQPay Lite',
  defaultPeriod: new Date().toISOString().slice(0, 7),
  serviceFeePerEmp: 1_500_000,
  bpjsFeePerEmp: 300_000,
  adminFee: 2_000_000,
  currency: 'IDR',
  locale: 'id-ID',
  theme: 'light',
  accentColor: 'indigo',
  density: 'comfortable',
  sidebarMode: 'expanded',
  enableAnimations: true,
  defaultView: 'dashboard',
  dashboardPageSize: 5,
  employeePageSize: 15,
  autoRefreshMinutes: 0,
  showKpis: true,
  showWorkforceInsights: true,
  showClientPortfolio: true,
  showDataSourceBadges: true,
  showSparklines: true,
  showMap: true,
  showClientDetail: true,
  idaTypingMs: 28,
  idaShowCot: true,
  idaCompactResponses: false,
  idaAutoSuggestions: true,
  maskSensitiveData: false,
  contractAlertDays: 30,
  notifyDataQuality: true,
  notifyContractExpiry: true,
  notifyPayrollApproval: true,
  currentUserId: '',
  users: [],
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
  return s.users.find((u) => u.id === s.currentUserId) || s.users[0] || {
    id: 'current', name: 'Pengguna', email: '', role: 'VIEWER', active: true,
  };
}

export function onSettingsChange(cb: () => void) {
  const h = () => cb();
  window.addEventListener('proqpay-settings', h);
  return () => window.removeEventListener('proqpay-settings', h);
}
