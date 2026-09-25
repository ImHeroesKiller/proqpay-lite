export const APP_ROLES = Object.freeze([
  'SUPER_ADMIN',
  'PAYROLL_PROCESSOR',
  'PAYROLL_CONTROLLER',
  'CLIENT_USER',
]);

export const ROLE_VIEWS = Object.freeze({
  SUPER_ADMIN: Object.freeze([
    'dashboard','operations','exceptions','payments','billing','integrations',
    'employees','clients','reports','logs','ewa','portalSettings',
  ]),
  PAYROLL_PROCESSOR: Object.freeze([
    'dashboard','operations','exceptions','payments','billing','employees','clients','reports',
  ]),
  PAYROLL_CONTROLLER: Object.freeze([
    'dashboard','operations','exceptions','payments','billing','reports',
  ]),
  CLIENT_USER: Object.freeze(['dashboard','operations','reports']),
});

export const ROLE_PERMISSIONS = Object.freeze({
  SUPER_ADMIN: Object.freeze([
    'read','employees:write','import:write','schema:write','settings:write',
    'client:write','project:write','service-plan:write','submission:write',
    'exception:write','payment:prepare','PAYMENT_APPROVER','payment:approve',
    'reconciliation:write','billing:prepare','billing:approve','ar:write',
  ]),
  PAYROLL_PROCESSOR: Object.freeze([
    'read','employees:write','import:write','submission:write','exception:write',
    'payroll:write','payment:prepare','reconciliation:write','billing:prepare',
  ]),
  PAYROLL_CONTROLLER: Object.freeze([
    'read','approval:write','PAYMENT_APPROVER','payment:approve',
    'reconciliation:write','billing:approve','ar:write',
  ]),
  CLIENT_USER: Object.freeze(['read']),
});

export const ROLE_CAPABILITIES = Object.freeze({
  SUPER_ADMIN: Object.freeze([
    'data-intake','settings','integrations:view','integrations:manage',
    'gateway:view','gateway:execute','audit:view','employee-services:manage',
  ]),
  PAYROLL_PROCESSOR: Object.freeze([
    'data-intake','gateway:view','gateway:execute',
  ]),
  PAYROLL_CONTROLLER: Object.freeze([
    'gateway:view',
  ]),
  CLIENT_USER: Object.freeze([]),
});

export function viewsForRole(role = '') {
  return ROLE_VIEWS[role] || ['dashboard'];
}

export function permissionsForRole(role = '') {
  return ROLE_PERMISSIONS[role] || [];
}

export function capabilitiesForRole(role = '') {
  return ROLE_CAPABILITIES[role] || [];
}

export function roleHasCapability(role, capability) {
  return capabilitiesForRole(role).includes(capability);
}
