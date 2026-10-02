import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script=new URL('../scripts/p4-operational-closure.mjs',import.meta.url);
const iso=(hoursAgo)=>new Date(Date.now()-hoursAgo*3600000).toISOString();

function run({staleBackup=false,openIncident=false}={}){
  const dir=mkdtempSync(join(tmpdir(),'p4-ops-'));
  const files={
    health:{ready:true,database:'d1',auth_mode:'session',checks:[{status:'ok'}]},
    release:{commit:'abc123'},
    assert:[],
    runs:[
      {id:1,name:'Production Security Uptime Monitor',status:'completed',conclusion:'success',created_at:iso(1)},
      {id:2,name:'Security D1 Backup & Restore Drill',status:'completed',conclusion:'success',created_at:iso(staleBackup?48:2)},
      {id:3,name:'Security Quarterly Restore Assurance',status:'completed',conclusion:'success',created_at:iso(24)},
      {id:4,name:'Security Audit Integrity Checkpoint',status:'completed',conclusion:'success',created_at:iso(2)},
    ],
    issues:openIncident?[{number:9,title:'SECURITY OPS: production health failed',state:'open',html_url:'https://example.test/9'}]:[],
    backup:{ok:true,integrity:'ok',bytes:1000,checkedAt:new Date().toISOString()},
  };
  const args=[];
  for(const [name,value] of Object.entries(files)){
    const p=join(dir,name+'.json');
    writeFileSync(p,JSON.stringify(value));
    args.push(p);
  }
  const out=join(dir,'out.json');
  const result=spawnSync(process.execPath,[script.pathname,...args,out],{
    encoding:'utf8',
    env:{...process.env,GITHUB_SHA:'abc123'},
  });
  return {result,evidence:JSON.parse(readFileSync(out,'utf8'))};
}

test('P4.4 evidence passes when production and operational evidence are current',()=>{
  const {result,evidence}=run();
  assert.equal(result.status,0,result.stderr||result.stdout);
  assert.equal(evidence.status,'PASS');
  assert.deepEqual(evidence.blockers,[]);
});

test('P4.4 evidence fails closed for stale backup workflow evidence',()=>{
  const {result,evidence}=run({staleBackup:true});
  assert.equal(result.status,1);
  assert.equal(evidence.status,'FAIL');
  assert.ok(evidence.blockers.some((x)=>x.includes('STALE_WORKFLOW_EVIDENCE:Security D1 Backup & Restore Drill')));
});

test('P4.4 evidence blocks an open production security incident',()=>{
  const {result,evidence}=run({openIncident:true});
  assert.equal(result.status,1);
  assert.ok(evidence.blockers.includes('OPEN_OPERATIONAL_SECURITY_INCIDENT'));
});
