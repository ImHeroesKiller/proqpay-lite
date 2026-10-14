import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=new URL('../src/components/',import.meta.url);
test('integration notices offer a visible accessible close button',()=>{
 const bubble=readFileSync(new URL('ui/DismissibleBubble.tsx',root),'utf8');
 assert.match(bubble,/aria-label="Tutup notifikasi"/);
 assert.match(bubble,/setHidden\(true\)/);
 for(const file of ['PaymentGatewayIntegrationPanel.tsx','E2PayOperationsConsole.tsx','ApiEndpointMonitor.tsx']){
  const content=readFileSync(new URL(file,root),'utf8');
  assert.doesNotMatch(content,/<div className="app-notice-bubble/);
  assert.match(content,/(?:<Notice |<DismissibleBubble )/);
 }
});
