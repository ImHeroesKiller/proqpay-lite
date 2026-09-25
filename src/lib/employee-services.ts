export const EWA_STATUSES = [
  "SUBMITTED",
  "APPROVED",
  "DISBURSED",
  "REPAYING",
  "REPAID",
  "REJECTED",
  "CANCELLED",
] as const;

export type EwaStatus = (typeof EWA_STATUSES)[number];

export type EwaLifecycleMeta = {
  label: string;
  shortLabel: string;
  step: number;
  tone: "info" | "success" | "warning" | "danger";
  note: string;
};

export const EWA_LIFECYCLE: Record<EwaStatus, EwaLifecycleMeta> = {
  SUBMITTED: {
    label: "Menunggu approval",
    shortLabel: "Menunggu",
    step: 1,
    tone: "warning",
    note: "Pengajuan sudah diterima dan menunggu review payroll.",
  },
  APPROVED: {
    label: "Disetujui",
    shortLabel: "Siap cair",
    step: 2,
    tone: "info",
    note: "Pengajuan sudah disetujui dan menunggu pencairan.",
  },
  DISBURSED: {
    label: "Sudah dicairkan",
    shortLabel: "Dicairkan",
    step: 3,
    tone: "info",
    note: "Dana sudah dicairkan ke rekening gaji karyawan.",
  },
  REPAYING: {
    label: "Potong payroll",
    shortLabel: "Dalam payroll",
    step: 4,
    tone: "info",
    note: "Potongan advance sudah masuk ke payroll periode berjalan.",
  },
  REPAID: {
    label: "Lunas",
    shortLabel: "Lunas",
    step: 5,
    tone: "success",
    note: "Advance telah lunas setelah rekonsiliasi payroll.",
  },
  REJECTED: {
    label: "Ditolak",
    shortLabel: "Ditolak",
    step: 1,
    tone: "danger",
    note: "Pengajuan tidak disetujui.",
  },
  CANCELLED: {
    label: "Dibatalkan",
    shortLabel: "Dibatalkan",
    step: 1,
    tone: "warning",
    note: "Pengajuan telah dibatalkan.",
  },
};

export function isEwaStatus(value: string): value is EwaStatus {
  return EWA_STATUSES.includes(value as EwaStatus);
}

export function ewaMeta(status?: string): EwaLifecycleMeta {
  if (status && isEwaStatus(status)) return EWA_LIFECYCLE[status];
  return {
    label: status || "Diproses",
    shortLabel: status || "Diproses",
    step: 1,
    tone: "info",
    note: "Status pengajuan sedang diperbarui.",
  };
}

export function formatPortalDate(value?: string) {
  return value ? String(value).replace("T", " ").slice(0, 16) : "—";
}
