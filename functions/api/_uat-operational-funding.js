import {d1All} from './_d1.js';

// Hide ONLY data-only legacy UAT accounts with no remaining financial work.
// Retains all source rows, credentials, audits, and account IDs; never alters
// provider/payment state. Accounts with active PI/DR/gateway/limit remain shown.
export async function archivedUatFundingAccountIds(database,organizationId){
  const rows=await d1All(database,`SELECT ppa.id
    FROM payment_provider_accounts ppa
    WHERE ppa.org_id=? AND ppa.provider='E2PAY'
      AND ppa.environment='UAT' AND ppa.account_scope='SUB_ACCOUNT'
      AND EXISTS (SELECT 1 FROM legacy_data_cutover_records ldc
        WHERE ldc.org_id=ppa.org_id AND ldc.source_account_id=ppa.id
          AND ldc.environment='UAT' AND ldc.source_type='UAT_PROVIDER_ACCOUNT')
      AND NOT EXISTS (SELECT 1 FROM payment_instructions pi
        LEFT JOIN uat_administrative_closures closed
          ON closed.org_id=pi.org_id AND closed.source_document_id=pi.id
        WHERE pi.org_id=ppa.org_id AND pi.provider_account_registry_id=ppa.id
          AND closed.id IS NULL)
      AND NOT EXISTS (SELECT 1 FROM disbursement_requests dr
        WHERE dr.org_id=ppa.org_id AND dr.provider_account_registry_id=ppa.id
          AND (dr.status NOT IN ('REJECTED','CANCELLED') OR EXISTS
            (SELECT 1 FROM disbursement_executions de WHERE de.disbursement_request_id=dr.id)))
      AND NOT EXISTS (SELECT 1 FROM payment_gateway_transactions gt
        JOIN payment_instructions pi ON pi.id=gt.payment_instruction_id AND pi.org_id=gt.org_id
        WHERE gt.org_id=ppa.org_id AND pi.provider_account_registry_id=ppa.id)
      AND NOT EXISTS (SELECT 1 FROM e2pay_disbursement_limit_requests lr
        WHERE lr.org_id=ppa.org_id AND lr.provider_account_registry_id=ppa.id
          AND lr.status IN ('PENDING_APPROVAL','ACTIVE'))`,[organizationId]);
  return new Set(rows.map(row=>row.id));
}
