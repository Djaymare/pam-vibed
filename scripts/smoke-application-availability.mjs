// Production Rust bridge and Node sidecar; only disposable targets/profiles.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, copyFile, readFile, writeFile, unlink, rm } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
assert.equal(process.platform, 'win32');
assert.ok(process.argv[2], 'Pass the process-tests PAM executable');
const profile = await mkdtemp(join(tmpdir(), 'pam-availability-native-'));
const node = join(root, 'src-tauri/binaries/pam-node-x86_64-pc-windows-msvc.exe');
const child = spawn(resolve(process.argv[2]), ['--pam-process-test', node, join(root,'sidecar/main.cjs'), join(root,'src-tauri/runtime'), profile], {windowsHide:true,shell:false,stdio:'pipe'});
let stderr = ''; child.stderr.on('data', chunk=>stderr+=chunk);
const lines = createInterface({input:child.stdout});
const iterator = lines[Symbol.asyncIterator]();
async function request(method, payload={}) {
  child.stdin.write(JSON.stringify({method,payload})+'\n');
  let timer;
  const result = await Promise.race([iterator.next(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(`Timeout ${method}: ${stderr}`)),55000);})]).finally(()=>clearTimeout(timer));
  assert.equal(result.done,false,stderr); return JSON.parse(result.value);
}
const ok = response => { assert.equal(response.ok,true,response.error); return response.result; };
try {
  const executable = join(profile,'fixture.exe'); await copyFile(node,executable);
  let config = ok(await request('save_application',{name:'Fixture',description:'Exécutable jetable',executable,arguments:['--version'],aliases:['Mon test'],enabled:true}));
  const app = config.applications[0];
  config = ok(await request('save_command_alias',{phrase:'Ouvre mon test',applicationId:app.id,action:'open'}));
  const aliases = config.commandAliases;
  const pending = ok(await request('prepare_action',{applicationId:app.id,action:'open',arguments:{}}));
  await unlink(executable);
  assert.equal(ok(await request('status')).applicationAvailability[app.id].available,false);
  assert.equal(ok(await request('confirm',{id:pending.id})).results[0].success,false);
  assert.equal((await request('test_application',app)).ok,false);
  config = ok(await request('set_application_enabled',{id:app.id,enabled:false}));
  assert.deepEqual(config.applications[0],{...app,enabled:false}); assert.deepEqual(config.commandAliases,aliases);
  ok(await request('save_application',{...app,enabled:false}));
  assert.equal((await request('set_application_enabled',{id:app.id,enabled:true})).ok,false);
  await copyFile(node,executable);
  ok(await request('set_application_enabled',{id:app.id,enabled:true}));
  console.log('PASS native manual: deleted .exe cannot launch; disable, repair, reenable retain data');
  // Structurally valid persisted registration, absent from the real catalogue.
  const appId = 'PAM.MissingAvailabilityFixture!Application';
  const windowsApp = {...app,executable:join(process.env.SystemRoot,'explorer.exe'),arguments:[`shell:AppsFolder\\${appId}`],windowsApp:{appId,kind:'store',icon:null}};
  config.applications = [windowsApp];
  await writeFile(join(profile,'applications.json'),JSON.stringify(config));
  assert.equal(ok(await request('status')).applicationAvailability[app.id].available,false);
  const proposed = ok(await request('prepare_action',{applicationId:app.id,action:'open',arguments:{}}));
  const refused = ok(await request('confirm',{id:proposed.id}));
  assert.equal(refused.results[0].success,false); assert.match(refused.results[0].message,/absente du catalogue/);
  config = ok(await request('set_application_enabled',{id:app.id,enabled:false}));
  assert.deepEqual(config.applications[0],{...windowsApp,enabled:false}); assert.deepEqual(config.commandAliases,aliases);
  ok(await request('save_application',{...windowsApp,enabled:false}));
  assert.equal((await request('set_application_enabled',{id:app.id,enabled:true})).ok,false);
  assert.equal((await request('test_application',windowsApp)).ok,false);
  // Repair by selecting a manual test executable. Preserve the record/phrases.
  ok(await request('save_application',{...app,enabled:false}));
  const repaired = ok(await request('set_application_enabled',{id:app.id,enabled:true}));
  assert.deepEqual(repaired.commandAliases,aliases); assert.deepEqual(repaired.applications[0],app);
  assert.deepEqual(JSON.parse(await readFile(join(profile,'applications.json'),'utf8')),repaired);
  console.log('PASS native Windows catalogue: absent target blocked through confirmation/test, disabled record preserved, repair reenables');
  child.stdin.write(JSON.stringify({method:'quit'})+'\n');
  await new Promise(done=>child.once('exit',done));
} finally {
  lines.close();
  if(child.exitCode===null){child.kill();await new Promise(done=>child.once('exit',done));}
  assert.equal(dirname(resolve(profile)),resolve(tmpdir())); assert.ok(basename(profile).startsWith('pam-availability-native-'));
  await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
