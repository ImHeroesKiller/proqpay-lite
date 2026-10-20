// Read-only release gate: a provider Git build must not race reviewed CI deploys.
export function assertReviewedPagesProject(project){
  const source=project?.source;
  if(source?.type==='github' && (source.config?.deployments_enabled!==false || source.config?.production_deployments_enabled!==false)) throw new Error('PAGES_AUTOMATIC_DEPLOYMENT_ENABLED: disable direct Git deployments before releasing');
  if(project?.production_branch!=='main') throw new Error('PAGES_PRODUCTION_BRANCH_MISMATCH');
  if(project?.build_config?.build_command!=='npm run build') throw new Error('PAGES_BUILD_COMMAND_MISMATCH');
  return true;
}
if(process.argv[1] && import.meta.url===new URL(process.argv[1],'file:').href){
  const account=process.env.CLOUDFLARE_ACCOUNT_ID;
  const project=process.env.PAGES_PROJECT_NAME||'proqpay-lite';
  const token=process.env.CLOUDFLARE_API_TOKEN;
  if(!account||!token) throw new Error('Cloudflare credentials required');
  const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/${project}`,{headers:{Authorization:`Bearer ${token}`}});
  const body=await response.json();
  if(!response.ok||body.success===false) throw new Error('Unable to verify Pages release control');
  assertReviewedPagesProject(body.result);
  console.log('Pages release control verified: CI deploy only, main, complete build');
}
