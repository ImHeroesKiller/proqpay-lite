import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const workspaces=[
  '../src/app/page.tsx',
  '../src/components/OperatingWorkspace.tsx',
  '../src/components/UnifiedPayrollWorkspace.tsx',
  '../src/components/PaymentGatewayExecutionActions.tsx',
  '../src/components/PaymentGatewaySettings.tsx',
  '../src/components/E2PayFundingLimitControl.tsx',
];

test('operational frontend has no obsolete P5.4 transactional UAT card or canary instructions',async()=>{
  for(const file of workspaces){
    const source=await readFile(new URL(file,import.meta.url),'utf8');
    assert.doesNotMatch(source,/P5\.4\s+Transactional\s+UAT|Single.recipient\s+canary|batch\s+5\s+beneficiar(?:y|ies)/i,file);
  }
});
