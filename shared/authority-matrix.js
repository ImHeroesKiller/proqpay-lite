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


export const ACTION_RULES = Object.freeze({
  'data-intake.upload': Object.freeze({ capability:'data-intake' }),
  'employees.manage': Object.freeze({ permission:'employees:write' }),
  'clients.manage': Object.freeze({ permission:'client:write' }),
  'payroll.prepare': Object.freeze({ permission:'payroll:write' }),
  'payroll.approve': Object.freeze({ permission:'approval:write' }),
  'payment.prepare': Object.freeze({ permission:'payment:prepare' }),
  'payment.execute': Object.freeze({ capability:'gateway:execute' }),
  'payment.approve': Object.freeze({ permission:'payment:approve' }),
  'reconciliation.manage': Object.freeze({ permission:'reconciliation:write' }),
  'billing.prepare': Object.freeze({ permission:'billing:prepare' }),
  'billing.approve': Object.freeze({ permission:'billing:approve' }),
  'ar.manage': Object.freeze({ permission:'ar:write' }),
  'integrations.view': Object.freeze({ capability:'integrations:view' }),
  'integrations.manage': Object.freeze({ capability:'integrations:manage' }),
  'audit.view': Object.freeze({ capability:'audit:view' }),
  'settings.manage': Object.freeze({ capability:'settings' }),
  'employee-services.manage': Object.freeze({ capability:'employee-services:manage' }),
});

export function roleCanAction(role, action) {
  const rule = ACTION_RULES[action];
  if (!rule) return false;
  if (rule.permission) return permissionsForRole(role).includes(rule.permission);
  if (rule.capability) return roleHasCapability(role, rule.capability);
  return false;
}
