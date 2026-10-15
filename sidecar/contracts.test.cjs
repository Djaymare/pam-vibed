const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),{spawnSync}=require('node:child_process');
const {contract,matches,validateRequest,validatePayload,validateResult}=require('./contracts.cjs');
test('generated contracts match their source and the error catalogue',()=>{
  const result=spawnSync(process.execPath,['scripts/generate-contracts.mjs','--check'],{encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(contract.definitions.PamError.properties.code.enum,Object.keys(require('./error-catalog.json')));
});
test('a schema edit without regeneration fails in an isolated source copy',async t=>{
  const fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
  const directory=await fsp.mkdtemp(path.join(os.tmpdir(),'pam-contract-drift-'));
  t.after(()=>fsp.rm(directory,{recursive:true,force:true}));
  for(const file of ['scripts/generate-contracts.mjs','scripts/rust-contracts.mjs','sidecar/contracts.cjs','sidecar/contracts.json','src/contracts.generated.ts','src/contract-runtime.js','src-tauri/src/contracts_generated.rs']) {
    await fsp.mkdir(path.dirname(path.join(directory,file)),{recursive:true});await fsp.copyFile(file,path.join(directory,file));
  }
  const run=()=>spawnSync(process.execPath,['scripts/generate-contracts.mjs','--check'],{cwd:directory,encoding:'utf8',windowsHide:true});
  assert.equal(run().status,0);
  const runtime=path.join(directory,'sidecar/contracts.cjs');
  await fsp.writeFile(runtime,(await fsp.readFile(runtime,'utf8')).replaceAll('\r\n','\n').replaceAll('\n','\r\n'));
  assert.equal(run().status,0,'Windows CRLF source must generate the same contract');
  const file=path.join(directory,'sidecar/contracts.json'),schema=JSON.parse(await fsp.readFile(file,'utf8'));
  schema.definitions.TurnStatus.enum.push('unreflected_change');await fsp.writeFile(file,JSON.stringify(schema));
  const result=run();assert.notEqual(result.status,0);assert.match(result.stderr,/Contract drift/);
});
test('Node, browser and Rust share valid/invalid requests and business results',async()=>{
  const browser=await import('../src/contract-runtime.js');
  const fixtures=JSON.parse(fs.readFileSync('tests/fixtures/contracts.json','utf8'));
  for(const fixture of fixtures) {
    const validate=fixture.request?validateRequest(fixture.request):matches(fixture.value,fixture.type);
    const web=fixture.request?browser.validateRequest(fixture.request):browser.matches(fixture.value,fixture.type);
    assert.equal(Boolean(validate),fixture.valid,fixture.name);assert.equal(Boolean(web),fixture.valid,fixture.name);
  }
  assert.equal(validatePayload('settings',{language:'fr',autoExecute:true,confidenceThreshold:'bad'}),false);
  assert.equal(validateResult('confirm',{status:'expired'}),false);
});
test('invalid requests are rejected before configuration, engine or launch',async t=>{
  const {createAssistant}=require('./assistant.cjs');
  const os=require('node:os'),path=require('node:path'),fsp=require('node:fs/promises');
  const directory=await fsp.mkdtemp(path.join(os.tmpdir(),'pam-contract-'));
  t.after(()=>fsp.rm(directory,{recursive:true,force:true}));
  let effects=0;const handle=createAssistant({runtimeDirectory:directory,configDirectory:directory,runEngine:async()=>{effects++;},launchApplication:async()=>{effects++;}});
  for(const [method,payload]of [['unknown',{}],['settings',{language:'fr'}],['prepare_action',{applicationId:'x',action:'erase_disk'}],['process_audio',{audio:[256]}]])await assert.rejects(handle(method,payload),error=>error.diagnostic.code==='invalid_request');
  assert.equal(effects,0);assert.equal(fs.existsSync(path.join(directory,'applications.json')),false);
});
test('real Node entrypoint refuses incompatible version, unknown method and invalid payload before effects',async t=>{
  const {spawn}=require('node:child_process'),os=require('node:os'),path=require('node:path'),fsp=require('node:fs/promises'),{createInterface}=require('node:readline');
  const directory=await fsp.mkdtemp(path.join(os.tmpdir(),'pam-wire-contract-'));
  const child=spawn(process.execPath,[path.join(__dirname,'main.cjs'),directory,directory],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  const closed=new Promise(resolve=>child.once('close',resolve));
  t.after(async()=>{if(child.exitCode===null)child.kill();await closed;await fsp.rm(directory,{recursive:true,force:true});});
  const replies=[];createInterface({input:child.stdout}).on('line',line=>replies.push(JSON.parse(line)));
  const base={version:1,id:1,requestId:'11111111-1111-4111-8111-111111111111',method:'status',payload:{}};
  child.stdin.end([{...base,version:2},{...base,id:2,method:'unknown'},{...base,id:3,method:'settings',payload:{language:'fr'}}].map(v=>JSON.stringify(v)).join('\n')+'\n');
  assert.equal(await closed,0);assert.equal(replies.length,3);
  for(const reply of replies){assert.equal(reply.ok,false);assert.equal(reply.error.code,'invalid_request');assert.equal(reply.version,1);}
  assert.equal(fs.existsSync(path.join(directory,'applications.json')),false);
  assert.equal(fs.existsSync(path.join(directory,'executions')),false);
});
