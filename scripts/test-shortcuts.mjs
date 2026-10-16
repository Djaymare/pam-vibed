import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, dirname, basename} from 'node:path';
import {createServer} from 'node:http';
import {createServer as probeServer} from 'node:net';
import {createRequire} from 'node:module';
const {validateResult}=createRequire(import.meta.url)('../sidecar/contracts.cjs');
assert.equal(process.platform,'win32');
const host=process.env.PAM_SHORTCUT_TEST_HOST;
assert.ok(host,'Set PAM_SHORTCUT_TEST_HOST to the freshly built production debug pam.exe');
const directory=await mkdtemp(join(tmpdir(),'pam-shortcut-ipc-'));
const profile=join(directory,'profile');await mkdir(profile);
const sentinel='Disposable assistant profile, never read by this test';
await writeFile(join(profile,'config.json'),sentinel);
const server=createServer((_req,res)=>res.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><title>PAM disposable shortcut IPC</title><p>Test du raccourci uniquement.</p>'));
const delay=ms=>new Promise(done=>setTimeout(done,ms));
let child,socket,id=0;
const checks=[];
async function launch(){
  const probe=probeServer();await new Promise(done=>probe.listen(0,'127.0.0.1',done));const port=probe.address().port;await new Promise(done=>probe.close(done));
  child=spawn(host,[],{windowsHide:true,stdio:'pipe',env:{...process.env,PAM_PROFILE_DIR:profile,WEBVIEW2_USER_DATA_FOLDER:join(directory,'webview'),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port}`}});
  child.stderr.on('data',data=>process.stderr.write(data));
  let target;
  for(let i=0;i<150;i++){try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page'&&t.url.startsWith('http://localhost:1420'));}catch{}if(target)break;if(child.exitCode!==null)throw Error('Host exited '+child.exitCode);await delay(100);}
  assert.ok(target,'Production main WebView2 available');socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((done,reject)=>{socket.onopen=done;socket.onerror=reject;});
  const pending=new Map();socket.onmessage=event=>{const r=JSON.parse(event.data),p=pending.get(r.id);if(!p)return;pending.delete(r.id);clearTimeout(p.timer);r.error?p.reject(Error(JSON.stringify(r.error))):p.done(r.result);};
  const evaluate=expression=>new Promise((done,reject)=>{const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(Error('IPC evaluation timed out'));},10000);pending.set(key,{done:r=>{if(r.exceptionDetails)reject(Error(JSON.stringify(r.exceptionDetails)));else done(r.result.value);},reject,timer});socket.send(JSON.stringify({id:key,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));});
  return async(method,payload={})=>{
    const frame={version:1,id:++id,requestId:crypto.randomUUID(),method,payload};
    const result=await evaluate(`window.__TAURI_INTERNALS__.invoke('assistant_request',{request:${JSON.stringify(frame)}})`);
    assert.equal(result.requestId,frame.requestId);assert.equal(result.ok,true);assert.ok(validateResult(method,result.result));return result.result;
  };
}
async function quit(call){
  // The native quit request intentionally exits before a reply can be observed.
  const exited=new Promise(done=>child.once('exit',done));
  void call('desktop_action',{action:'quit'}).catch(()=>{});
  await Promise.race([exited,delay(10000).then(()=>{if(child.exitCode===null)throw Error('Native quit timed out');})]);socket.close();
}
try{
  await new Promise((done,reject)=>{server.once('error',reject);server.listen(1420,'localhost',done);});
  let call=await launch();
  const before=await call('voice_shortcut');assert.equal(before.id,'ctrl_shift_space');
  const changed=await call('voice_shortcut',{shortcut:'ctrl_alt_space'});assert.equal(changed.id,'ctrl_alt_space');assert.equal(changed.available,true);assert.equal(changed.error,'');checks.push('Production Tauri IPC validates, registers and persists the alternative');
  assert.equal(await readFile(join(profile,'config.json'),'utf8'),sentinel);checks.push('Assistant profile bytes unchanged; no sidecar request');
  await quit(call);call=await launch();
  const restarted=await call('voice_shortcut');assert.equal(restarted.id,'ctrl_alt_space');assert.equal(restarted.available,true);checks.push('Fresh production process registers the persisted alternative');
  await quit(call);
  console.log(JSON.stringify({checks,passed:checks.length},null,2));
}finally{
  socket?.close();if(child&&child.exitCode===null){child.kill();await new Promise(done=>child.once('exit',done));}
  if(server.listening)await new Promise(done=>server.close(done));
  assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.ok(basename(directory).startsWith('pam-shortcut-ipc-'));
  for(let i=0;i<20;i++){try{await rm(directory,{recursive:true,force:true});break;}catch(error){if(i===19)throw error;await delay(200);}}
}
