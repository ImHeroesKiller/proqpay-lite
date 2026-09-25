export type IntegrationHealthState = 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'IDLE';

export type IntegrationHealth = {
  state: IntegrationHealthState;
  label: string;
  reason: string;
};

export function integrationHealthLabel(state: IntegrationHealthState) {
  return state === 'HEALTHY'
    ? 'Healthy'
    : state === 'DEGRADED'
      ? 'Degraded'
      : state === 'DOWN'
        ? 'Down'
        : 'Idle';
}

export function gatewayRuntimeHealth(input: {
  provider?: string | null;
  seamlessConfigured?: boolean;
  seamlessReason?: string | null;
  hostedReason?: string | null;
  inspected?: boolean;
}): IntegrationHealth {
  if (!input.inspected) return { state:'IDLE', label:'Belum diperiksa', reason:'Jalankan readiness check.' };
  if (!input.provider || input.provider === 'UNCONFIGURED') {
    return { state:'IDLE', label:'Not configured', reason:'Belum ada provider aktif untuk runtime payment.' };
  }
  if (input.seamlessConfigured) {
    return { state:'HEALTHY', label:'Operational', reason:'Adapter aktif dan credential runtime memenuhi readiness.' };
  }
  return {
    state:'DEGRADED',
    label:'Action needed',
    reason:input.seamlessReason || input.hostedReason || 'Gateway belum siap digunakan.',
  };
}

export function apiRecoveryGuidance(state: IntegrationHealthState) {
  if (state === 'DOWN') {
    return 'Periksa endpoint dengan error tertinggi, buka Audit Logs memakai Correlation ID, lalu retry setelah akar masalah diperbaiki.';
  }
  if (state === 'DEGRADED') {
    return 'Prioritaskan endpoint lambat/error dan validasi perubahan terakhir sebelum traffic meningkat.';
  }
  if (state === 'IDLE') {
    return 'Belum ada traffic. Pastikan aplikasi eksternal mengirim App ID monitoring dan tetap memakai autentikasi ProQPay.';
  }
  return 'Tidak ada recovery action yang diperlukan saat ini.';
}
