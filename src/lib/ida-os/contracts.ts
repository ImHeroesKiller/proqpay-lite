export type WorkerId =
  | 'PAYROLL'
  | 'HR'
  | 'OPERATIONS'
  | 'COMPLIANCE'
  | 'DOCUMENT'
  | 'FINANCE';

export type IdaRole =
  | 'SUPER_ADMIN'
  | 'PAYROLL_PROCESSOR'
  | 'PAYROLL_CONTROLLER'
  | 'CLIENT_USER'
  | 'HR'
  | 'PAYROLL'
  | 'DIRECTOR'
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
  servicePlanId?: string;
  serviceTier?: 'TIER_1_PAYMENT_PROCESSING' | 'TIER_2_MANAGED_PAYROLL' | 'TIER_3_INTEGRATED_AUTOMATION';
  payrollPeriod?: string;
  currentPayrollRun?: { id?: string; status?: string };
  submissionId?: string;
  workflowStage?: string;
  pendingExceptionIds?: string[];
  pendingConfirmation?: string;
  recentFileId?: string;
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
  ruleVersion?: string;
};

export type WorkerResult = {
  worker: WorkerId;
  answerMarkdown?: string;
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
