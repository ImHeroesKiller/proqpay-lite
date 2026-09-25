export type OperationalHealthState = 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'IDLE' | 'CHECKING';

export const OPERATIONAL_HEALTH_LABEL:Record<OperationalHealthState,string> = {
  HEALTHY:'Healthy',
  DEGRADED:'Degraded',
  DOWN:'Down',
  IDLE:'Idle',
  CHECKING:'Checking',
};

export function operationalHealthLabel(state:OperationalHealthState) {
  return OPERATIONAL_HEALTH_LABEL[state];
}

export function serviceHealthState(input:{
  ready?:boolean;
  checks?:Array<{status?:string}>;
} | null):OperationalHealthState {
  if (!input) return 'CHECKING';
  if (input.ready === true) return 'HEALTHY';
  if ((input.checks || []).some((item) => item.status === 'error')) return 'DOWN';
  return 'DEGRADED';
}
