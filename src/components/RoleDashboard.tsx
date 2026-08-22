'use client';

import type { AppView } from './Sidebar';

type Actor = { email: string; role: string; permissions: string[] };

const ROLE_CONTENT: Record<string, { title: string; description: string; tasks: string[]; actions: Array<{ label: string; view: AppView }> }> = {
  SUPER_ADMIN: {
    title: 'Administrative Command Center',
    description: 'Akses penuh untuk konfigurasi, master data, payroll operation, payment control, dan audit.',
    tasks: ['Kelola klien & project', 'Pantau seluruh workflow', 'Kelola role & konfigurasi'],
    actions: [{ label: 'Kelola klien & project', view: 'clients' }, { label: 'Buka payroll operations', view: 'operations' }, { label: 'Lihat system logs', view: 'logs' }],
  },
  PAYROLL_PROCESSOR: {
    title: 'Payroll Preparation Workspace',
    description: 'Maker dari kesiapan data sampai pembuatan dan submit Payment Instruction.',
    tasks: ['Perbaiki blocker Data Readiness', 'Finalisasi payroll', 'Buat dan submit PI ke Controller'],
    actions: [{ label: 'Buka submission', view: 'operations' }, { label: 'Periksa karyawan', view: 'employees' }, { label: 'Lihat klien', view: 'clients' }],
  },
  PAYROLL_CONTROLLER: {
    title: 'Payroll Control Workspace',
    description: 'Checker independen untuk approval PI, bukti bayar, rekonsiliasi, dan billing.',
    tasks: ['Review dan approve/reject PI', 'Verifikasi bukti bayar', 'Kontrol rekonsiliasi dan billing'],
    actions: [{ label: 'Review payroll', view: 'operations' }, { label: 'Lihat laporan', view: 'reports' }],
  },
  CLIENT_USER: {
    title: 'Client Payroll Workspace',
    description: 'Monitoring read-only untuk data klien dan project yang ditetapkan pada akun Anda.',
    tasks: ['Pantau status payroll', 'Pantau status pembayaran', 'Unduh laporan dan invoice'],
    actions: [{ label: 'Lihat status submission', view: 'operations' }, { label: 'Unduh laporan', view: 'reports' }],
  },
};

export default function RoleDashboard({ actor, onNavigate }: { actor: Actor | null; onNavigate: (view: AppView) => void }) {
  const role = actor?.role || 'CLIENT_USER';
  const content = ROLE_CONTENT[role] || {
    title: 'Read-only Workspace', description: 'Akses Anda terbatas pada data yang diizinkan.', tasks: ['Lihat ringkasan'], actions: [{ label: 'Lihat dashboard', view: 'dashboard' as AppView }],
  };
  return (
    <div className="role-dashboard-card">
      <div>
        <div className="role-dashboard-kicker">{role.replaceAll('_', ' ')}</div>
        <h2>{content.title}</h2>
        <p>{content.description}</p>
        <div className="role-dashboard-actions">
          {content.actions.map((action) => <button type="button" key={action.label} onClick={() => onNavigate(action.view)}>{action.label}</button>)}
        </div>
      </div>
      <div className="role-dashboard-tasks">
        <span>Fokus pekerjaan</span>
        {content.tasks.map((task, index) => <div key={task}><b>{index + 1}</b>{task}</div>)}
        {actor?.permissions.includes('payment:approve') ? <em>✓ Payment Approver aktif</em> : null}
      </div>
    </div>
  );
}
