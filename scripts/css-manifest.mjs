/** G1 — Ordered, unlayered CSS entrypoints. Do not reorder without a visual/cascade review. */
export const globalFoundationCss=[
  'src/app/styles/tokens.css',
  'src/app/globals.css',
  'src/app/styles/premium.css',
  'src/app/styles/shell.css',
  'src/app/styles/shared-ui.css',
  'src/app/styles/operations.css',
];
export const domainPolishCss=[
  'src/app/polish.css',
  'src/app/styles/polish-dashboard.css',
  'src/app/styles/polish-directory.css',
  'src/app/styles/polish-data-operations.css',
  'src/app/styles/polish-payruns.css',
  'src/app/styles/polish-billing.css',
  'src/app/styles/polish-people-reports.css',
];
export const featureCss=[
  'src/app/employee-services.css',
  'src/app/audit-console.css',
  'src/app/e2pay-wallet.css',
  'src/app/styles/workspace-v2.css',
];
export const accessibilityCss=['src/app/styles/accessibility.css'];
export const orderedGlobalCss=[...globalFoundationCss,...domainPolishCss,...featureCss,...accessibilityCss];
export const originalLegacyHashes={
  global:'feb5cb820c57dc2a9297de582cfc0e92366cb4d6c989cb6f42d28b3de55e847a',
  polish:'4b3c8cf3de6c698bde2ff90c0ccd12b537dca63f39f32a4101e1a5a38f78d789',
};
