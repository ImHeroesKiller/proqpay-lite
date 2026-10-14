import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../src/components/IntegrationsWorkspace.tsx',import.meta.url),'utf8');
test('integration categories are mutually exclusive tab pages with accessible keyboard navigation',()=>{
 assert.match(src,/role="tablist"/);
 assert.match(src,/role="tabpanel"/);
 assert.match(src,/aria-selected=/);
 assert.match(src,/ArrowRight/);
 assert.match(src,/ArrowLeft/);
 assert.match(src,/tab==='gateway'\?</);
 assert.match(src,/<PaymentGatewayIntegrationPanel canManage=\{canManage\} canView=\{canView\}/);
 assert.match(src,/<ApiEndpointMonitor onOpenAuditCorrelation=\{onOpenAuditCorrelation\}/);
});
test('integration tab deep link uses shared route-state and preserves other filters',()=>{
 assert.match(src,/patchRoute\(\{integrationTab:/);
 assert.match(src,/subscribeRoute\(sync\)/);
 assert.match(src,/routeParams\(\)\.get\('integrationTab'\)/);
});
