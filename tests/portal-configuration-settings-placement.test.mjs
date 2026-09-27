import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=(path)=>readFile(new URL(`../${path}`,import.meta.url),'utf8');

test('Portal Configuration is owned by Settings, not sidebar navigation',async()=>{
  const [sidebar,settings,nav]=await Promise.all([
    read('src/components/Sidebar.tsx'),
    read('src/components/SettingsModal.tsx'),
    read('src/lib/navigation-config.ts'),
  ]);
  assert.doesNotMatch(sidebar,/getViewLabel\("portalSettings", role\)/);
  assert.match(settings,/id: "portal"/);
  assert.match(settings,/label: "Portal Configuration"/);
  assert.match(settings,/roleHasCapability\(role \|\| "", "employee-services:manage"\)/);
  assert.match(settings,/<PortalSettings \/>/);
  assert.doesNotMatch(nav,/label: "Portal Configuration".*NAV_SEARCH_ITEMS/s);
});
