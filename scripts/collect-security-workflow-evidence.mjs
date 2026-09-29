import fs from 'node:fs';

const [outputPath] = process.argv.slice(2);
if(!outputPath) throw new Error('Usage: node collect-security-workflow-evidence.mjs <output.json>');

const token=String(process.env.GITHUB_TOKEN||'');
const repository=String(process.env.GITHUB_REPOSITORY||'');
if(!token || !repository.includes('/')) throw new Error('GITHUB_TOKEN and GITHUB_REPOSITORY are required');

const workflowFiles=[
  'security-sca.yml',
  'security-backup.yml',
  'security-audit-integrity.yml',
  'security-uptime.yml',
  'security-dast.yml',
  'security-quarterly-restore.yml',
  'cloudflare-deploy.yml',
];

async function latest(file){
  const branchQuery=file==='security-dast.yml' ? '' : '&branch=main';
  const response=await fetch(`https://api.github.com/repos/${repository}/actions/workflows/${file}/runs?per_page=10${branchQuery}`,{
    headers:{
      Authorization:`Bearer ${token}`,
      Accept:'application/vnd.github+json',
      'X-GitHub-Api-Version':'2022-11-28',
      'User-Agent':'ProQPay-Security-Assurance',
    },
  });
  if(!response.ok) throw new Error(`GitHub workflow evidence failed for ${file}: HTTP ${response.status}`);
  const json=await response.json();
  const run=(json.workflow_runs||[]).find((item)=>item.status==='completed') || (json.workflow_runs||[])[0];
  return run ? {
    file,
    name:run.name,
    conclusion:run.conclusion,
    updatedAt:run.updated_at,
    runId:run.id,
    headSha:run.head_sha,
  } : {file,name:file,conclusion:'missing',updatedAt:null,runId:null,headSha:null};
}

const workflows=[];
for(const file of workflowFiles) workflows.push(await latest(file));
const evidence={generatedAt:new Date().toISOString(),repository,workflows};
fs.writeFileSync(outputPath,JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence,null,2));
