export type WorkerId =
  | 'PAYROLL'
  | 'HR'
  | 'OPERATIONS'
  | 'COMPLIANCE'
  | 'DOCUMENT'
  | 'FINANCE';

export type IdaRole =
  | 'SUPER_ADMIN'
  | 'HR'
  | 'PAYROLL'
  | 'APPROVER'
  | 'FINANCE'
  | 'VIEWER';

export type WorkflowStage =
  | 'UNDERSTAND'
  | 'PLAN'
  | 'DELEGATE'
  | 'COLLECT'
  | 'VALIDATE'
  | 'SUMMARIZE'
  | 'PREVIEW'
  | 'CONFIRMATION'
  | 'EXECUTE'
  | 'AUDIT'
  | 'REFRESH_DASHBOARD'
  | 'COMPLETED'
  | 'BLOCKED';

export type ActionRisk = 'READ' | 'WRITE' | 'FINANCIAL' | 'DESTRUCTIVE';

export type SharedContext = {
  organization: { id?: string; name: string };
  currentUser: { id?: string; email: string };
  currentRole: IdaRole;
  conversation: { id?: string; recentMessages?: string[] };
  currentClient?: { id?: string; name: string };
  currentProject?: { id?: string; name: string };
  payrollPeriod?: string;
  currentPayrollRun?: { id?: string; status?: string };
  permissions: string[];
  language: 'id' | 'en';
  timezone: string;
};

export type Evidence = {
  source: 'DATABASE' | 'BUSINESS_SERVICE' | 'DOCUMENT' | 'REGULATION';
  table?: string;
  recordIds?: string[];
  service?: string;
  description: string;
};

export type Calculation = {
  name: string;
  formula: string;
  inputs: Record<string, number | string>;
  result: number;
  currency?: 'IDR';
};

export type WorkerResult = {
  worker: WorkerId;
  facts: string[];
  calculations: Calculation[];
  warnings: string[];
  errors: string[];
  evidence: Evidence[];
  sourceTables: string[];
  businessRules: string[];
  suggestedActions: string[];
  requiresConfirmation: boolean;
};

export type WorkerTask = {
  id: string;
  worker: WorkerId;
  capability: string;
  objective: string;
  risk: ActionRisk;
  context: SharedContext;
  input: Record<string, unknown>;
};

export type ExecutionPlan = {
  id: string;
  intent: string;
  objective: string;
  stage: WorkflowStage;
  tasks: WorkerTask[];
  risk: ActionRisk;
  requiresConfirmation: boolean;
  confirmationPhrase?: string;
  affectedRecords: string[];
  createdAt: number;
};

export type OrchestrationResult = {
  plan: ExecutionPlan;
  allowed: boolean;
  blockers: string[];
};
