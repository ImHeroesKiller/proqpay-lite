import type {
  ExecutionPlan,
  SharedContext,
  WorkerResult,
  WorkflowStage,
} from './contracts';

const STAGE_ORDER: WorkflowStage[] = [
  'UNDERSTAND',
  'PLAN',
  'DELEGATE',
  'COLLECT',
  'VALIDATE',
  'SUMMARIZE',
  'PREVIEW',
  'CONFIRMATION',
  'EXECUTE',
  'AUDIT',
  'REFRESH_DASHBOARD',
  'COMPLETED',
];

export type WorkflowDecision = {
  stage: WorkflowStage;
  executable: boolean;
  blockers: string[];
  facts: string[];
  warnings: string[];
  errors: string[];
  evidenceCount: number;
};

export function reconcileWorkerResults(
  plan: ExecutionPlan,
  results: WorkerResult[],
  context: SharedContext,
  confirmation?: string
): WorkflowDecision {
  const expected = new Set(plan.tasks.map((task) => task.worker));
  const returned = new Set(results.map((result) => result.worker));
  const blockers: string[] = [];

  expected.forEach((worker) => {
    if (!returned.has(worker)) blockers.push(`Worker ${worker} belum mengembalikan hasil.`);
  });

  const errors = results.flatMap((result) => result.errors);
  const warnings = results.flatMap((result) => result.warnings);
  const facts = results.flatMap((result) => result.facts);
  const evidenceCount = results.reduce((count, result) => count + result.evidence.length, 0);

  if (errors.length) blockers.push(...errors);
  if (!evidenceCount) blockers.push('Tidak ada evidence yang mendukung hasil worker.');
  if (!context.organization.name || !context.currentUser.email || !context.currentRole) {
    blockers.push('Shared context tidak lengkap.');
  }
  if (
    plan.requiresConfirmation &&
    confirmation?.trim().toUpperCase() !== plan.confirmationPhrase?.toUpperCase()
  ) {
    blockers.push(`Konfirmasi wajib: ${plan.confirmationPhrase}.`);
  }

  const executable = blockers.length === 0;
  return {
    stage: executable ? (plan.requiresConfirmation ? 'EXECUTE' : 'SUMMARIZE') : 'BLOCKED',
    executable,
    blockers,
    facts,
    warnings,
    errors,
    evidenceCount,
  };
}

export function canAdvanceWorkflow(from: WorkflowStage, to: WorkflowStage) {
  if (to === 'BLOCKED') return true;
  const fromIndex = STAGE_ORDER.indexOf(from);
  const toIndex = STAGE_ORDER.indexOf(to);
  return fromIndex >= 0 && toIndex === fromIndex + 1;
}
