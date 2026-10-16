// Real production Rust admission/bridge and Node main; disposable target only.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
const {validateResult,matches}=createRequire(import.meta.url)('../sidecar/contracts.cjs');
const {deletionFingerprint}=createRequire(import.meta.url)('../sidecar/assistant/deletion-scope.cjs');
const root=resolve(new URL('..',import.meta.url).pathname.replace(/^\/([a-z]:)/i,'$1'));
const profile=await mkdtemp(join(tmpdir(),'pam-contract-native-'));
const node=join(root,'src-tauri/binaries/pam-node-x86_64-pc-windows-msvc.exe');
const child=spawn(resolve(process.argv[2]),['--pam-process-test',node,join(root,'sidecar/main.cjs'),join(root,'src-tauri/runtime'),profile],{windowsHide:true,shell:false,stdio:'pipe'});
const closed=new Promise(resolve=>child.once('close',resolve));
let stderr='';child.stderr.on('data',v=>stderr+=v);
const iterator=createInterface({input:child.stdout})[Symbol.asyncIterator]();let id=0;
async function wire(value) {
  child.stdin.write(JSON.stringify({method:'contract_request',payload:value})+'\n');
  let timer;const next=await Promise.race([iterator.next(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Native fixture timeout '+stderr)),55000);})]).finally(()=>clearTimeout(timer));
  assert.equal(next.done,false,stderr);return JSON.parse(next.value);
}
async function request(method,payload={}) {
  const value={version:1,id:++id,requestId:randomUUID(),method,payload};const reply=await wire(value);
  assert.equal(reply.version,1);assert.equal(reply.id,value.id);assert.equal(reply.requestId,value.requestId);assert.equal(reply.method,method);
  if(reply.ok)assert.equal(validateResult(method,reply.result),true,method);else {assert.equal(matches(reply.error,'PamError'),true);assert.equal(reply.error.requestId,value.requestId);}
  return reply;
}
try {
  const base={version:1,id:1,requestId:randomUUID(),method:'restart_engine',payload:{}};
  for(const patch of [{version:2},{method:'unknown'},{method:'test_application',payload:{executable:node,arguments:[]}}]) {
    const reply=await wire({...base,...patch});assert.equal(reply.ok,false);assert.equal(JSON.parse(reply.error).code,'invalid_request');
  }
  assert.deepEqual(await readdir(profile),[],'Admission failures must not reach sidecar/profile/effects');
  const marker=join(profile,'effect.txt');
  const saved=await request('save_application',{name:'Contract fixture',description:'Disposable Node marker',executable:node,arguments:['-e',"require('node:fs').writeFileSync(process.argv[1],'once')",marker],aliases:[],enabled:true});
  assert.equal(saved.ok,true,JSON.stringify(saved.error));const applicationId=saved.result.applications[0].id;
  const proposal=(await request('prepare_action',{applicationId,action:'open'})).result;
  const turn=await request('confirm',{id:proposal.id});assert.equal(turn.ok,true,JSON.stringify(turn.error));assert.equal(turn.result.status,'executed');
  for(let n=0;;n++){try{assert.equal(await readFile(marker,'utf8'),'once');break;}catch(error){if(n===40)throw error;await new Promise(resolve=>setTimeout(resolve,25));}}
  assert.equal((await request('confirm',{id:proposal.id})).result.status,'consumed');
  const expired=(await request('prepare_action',{applicationId,action:'open'})).result;
  const recordPath=join(profile,'proposals',expired.id+'.json'),record=JSON.parse(await readFile(recordPath,'utf8'));
  record.turn.proposal.expiresAt=0;await writeFile(recordPath,JSON.stringify(record));
  assert.equal((await request('confirm',{id:expired.id})).result.status,'expired');
  const unknown=await request('confirm',{id:randomUUID()});assert.equal(unknown.result.proposal.state,'unknown');
  const exported=await request('export_diagnostics');assert.equal(exported.ok,true,JSON.stringify(exported.error));
  const learned=await request('save_command_alias',{phrase:'Ouvre la fixture',applicationId,action:'open'});assert.equal(learned.ok,true,JSON.stringify(learned.error));
  const alias=learned.result.commandAliases[0];
  const refused=await request('delete_command_alias',{id:alias.id,expectedFingerprint:'0'.repeat(64)});assert.equal(refused.ok,false);
  const removed=await request('delete_command_alias',{id:alias.id,expectedFingerprint:deletionFingerprint(learned.result,'formulation',alias.id)});assert.equal(removed.ok,true,JSON.stringify(removed.error));assert.equal(removed.result.commandAliases.length,0);assert.equal(removed.result.applications[0].id,applicationId);
  const deleted=await request('delete_application',{id:applicationId,expectedFingerprint:deletionFingerprint(removed.result,'application',applicationId)});assert.equal(deleted.ok,true,JSON.stringify(deleted.error));assert.equal(deleted.result.applications.length,0);
  console.log('PASS deletion fingerprint preserved through production Rust IPC; stale rejected, individual/app deletion confirmed; disposable profile only');
  console.log('PASS production native IPC: invalid/version/unknown rejected before startup; config/action/results/error/expired/consumed correlated; disposable Node effect; no replay');
} finally {
  child.stdin.end(JSON.stringify({method:'quit'})+'\n');
  let timer;try{await Promise.race([closed,new Promise(resolve=>{timer=setTimeout(()=>{child.kill();resolve();},5000);})]);}finally{clearTimeout(timer);}
  assert.equal(dirname(profile),tmpdir());await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
