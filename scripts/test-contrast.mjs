import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createServer as createNetServer } from 'node:net';

// Real Windows WebView2 + Vue components, with only native services simulated.
// Build src-tauri/examples/modal-test-host.rs first and set PAM_MODAL_TEST_HOST.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
assert.equal(process.platform, 'win32', 'This suite requires Windows WebView2.');
const host = process.env.PAM_MODAL_TEST_HOST;
assert.ok(host, 'Set PAM_MODAL_TEST_HOST to the compiled disposable host.');
const dependencyRoot = resolve(process.env.PAM_TEST_DEPENDENCY_ROOT || root);
const { createServer } = await import(pathToFileURL(join(dependencyRoot, 'node_modules/vite/dist/node/index.js')));
const { default: vue } = await import(pathToFileURL(join(dependencyRoot, 'node_modules/@vitejs/plugin-vue/dist/index.mjs')));
const fixture = join(root, 'tests/fixtures/contrast-native.js');
const server = await createServer({ configFile: false, root, cacheDir: join(dependencyRoot, 'node_modules/.vite-contrast-test'), plugins: [vue()],
  resolve: { alias: [ { find: /^@tauri-apps\/(api\/(core|event)|plugin-dialog)$/, replacement: fixture }, {find:'./audio/recorder',replacement:join(root,'tests/fixtures/contrast-recorder.js')} ] },
  server: { host: '127.0.0.1', port: 0, watch:{ignored:['**/artifacts/**']}, fs: { allow: [root, dependencyRoot] } },
});
const portServer = createNetServer();
await new Promise(done => portServer.listen(0, '127.0.0.1', done));
const debugPort = portServer.address().port;
await new Promise(done => portServer.close(done));
const profile = await mkdtemp(join(tmpdir(), 'pam-modal-'));
let child, socket;
const delay = ms => new Promise(done => setTimeout(done, ms));
try {
  await server.listen();
  const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/contrast-page.html`;
  child = spawn(host, [], { windowsHide: true, stdio: 'pipe', env: { ...process.env, PAM_MODAL_TEST_URL: url, PAM_MODAL_TEST_PROFILE: profile, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort}` } });
  child.on('error', error => console.error(error));
  child.stderr.on('data', data => process.stderr.write(data));
  let target;
  for (let i = 0; i < 200; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(t => t.type === 'page' && t.url.startsWith(url)); } catch {}
    if (target) break;
    if (child.exitCode !== null) throw Error(`Host exited: ${child.exitCode}`);
    await delay(100);
  }
  assert.ok(target, 'WebView2 debugging target available');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, reject) => { socket.onopen = done; socket.onerror = reject; });
  let seq = 0;
  const pending = new Map();
  socket.onmessage = event => { const r = JSON.parse(event.data); if (!r.id) { if (r.method === 'Runtime.exceptionThrown') console.error(JSON.stringify(r.params)); return; } const p = pending.get(r.id); if (!p) return; pending.delete(r.id); clearTimeout(p.timer); r.error ? p.reject(Error(JSON.stringify(r.error))) : p.resolve(r.result); };
  const cdp = (method, params = {}) => new Promise((done, reject) => { const id = ++seq; const timer = setTimeout(() => { pending.delete(id); reject(Error(`Timeout: ${method}`)); }, 10000); pending.set(id, { resolve: done, reject, timer }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
  await cdp('Runtime.enable');
  const wait = async expression => { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await delay(30); } throw Error(`Not ready: ${expression}; DOM=${await evaluate('document.body.innerHTML')}`); };
  const key = async (name, modifiers = 0) => {
    const codes = { Tab: 9, Enter: 13, Escape: 27, a: 65 };
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: name === 'a' ? 'KeyA' : name, windowsVirtualKeyCode: codes[name], modifiers, text: name === 'Enter' ? '\r' : undefined });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: name === 'a' ? 'KeyA' : name, windowsVirtualKeyCode: codes[name], modifiers });
    await delay(25);
  };
  const {auditRendered}=await import('../tests/contrast-audit.js');
  const reports=[];
  const before=process.argv.includes('--before');
  const extra=process.argv.includes('--extra');
  const reportName=before?'before.json':extra?'after-extra.json':'after.json';
  const output=resolve(process.env.PAM_CONTRAST_OUTPUT || 'artifacts/pam07');
  const {mkdir}=await import('node:fs/promises');await mkdir(output,{recursive:true});
  const set=async (selector,value)=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const click=async selector=>{await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await delay(100);};
  const scan=async label=>{
    await delay(80);const a=await evaluate(`(${auditRendered.toString()})()`);a.label=label;reports.push(a);
    await writeFile(join(output,reportName),JSON.stringify({runtime:await evaluate('navigator.userAgent'),reports},null,2)+'\n');
    if(!before){assert.equal(a.failures.length,0,`${label}: text contrast/font failures ${JSON.stringify(a.failures)}`);assert.ok(a.controls.every(c=>c.width>=24&&c.height>=24),`${label}: targets ${JSON.stringify(a.controls.filter(c=>c.width<24||c.height<24))}`);assert.ok(a.viewport.scrollWidth<=a.viewport.width+1,`${label}: horizontal overflow`);}
    // WebView2's native page zoom does not scale CDP's inferred full-page clip.
    // Capture the actual visible surface; keyboard checks scroll each action in.
    await writeFile(join(output,`${before?'before':'after'}-${label}.png`),Buffer.from((await cdp('Page.captureScreenshot',{captureBeyondViewport:false})).data,'base64'));
  };
  const keyboard=async label=>{
    const count=await evaluate('document.querySelectorAll("button,input,textarea,select,summary").length');
    for(let i=0;i<count+2;i++){await key('Tab');const a=await evaluate(`(${auditRendered.toString()})()`);if(a.focus?.tag==='BODY')continue;assert.ok(a.focus.visible&&a.focus.width>=2&&a.focus.outline!=='none',`${label}: focus ${JSON.stringify(a.focus)}`);assert.ok(a.focus.ratio>=3,`${label}: focus contrast ${JSON.stringify(a.focus)}`);assert.ok(a.focus.rect.left>=0&&a.focus.rect.right<=a.viewport.width+1&&a.focus.rect.top>=0&&a.focus.rect.bottom<=a.viewport.height+1,`${label}: focused action clipped ${JSON.stringify(a.focus)}`);}
  };
  let viewportMode='normal';
  const load=async state=>{await cdp('Page.navigate',{url:`${url}?state=${state}&viewport=${viewportMode}`});await wait('!!document.querySelector(".page-intro") && !document.querySelector(".text-request input")?.disabled');};
  for(const [mode,width,height,forced] of [['normal',1180,820,false],['minimum',780,620,false],['zoom200',390,310,false],['contrast-light',780,620,true],['contrast-dark',390,310,true]]){
    if(before&&mode!=='normal')continue;
    viewportMode=mode==='contrast-dark'?'zoom200':mode==='contrast-light'?'minimum':mode;
    await cdp('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:forced?'active':'none'},{name:'prefers-color-scheme',value:mode==='contrast-dark'?'dark':'light'}]});
    await load('ready');await wait(`innerWidth===${width} && innerHeight===${height}`);await scan(`${mode}-assistant-empty`);
    if(extra){
      await evaluate('window.pamFixture.setState("mic-wait")');await click('.mic-button');await scan(`${mode}-microphone-waiting`);
      await evaluate('window.pamFixture.release()');await wait('!!document.querySelector(".mic-button.recording")');await scan(`${mode}-recording`);
      await click('.voice-center .text-button');await wait('!document.querySelector(".mic-button.recording")');
      await evaluate('window.pamFixture.setState("mic-denied")');await click('.mic-button');await scan(`${mode}-microphone-denied`);
      await evaluate('window.pamFixture.setState("waiting")');await set('.text-request input','En attente');await click('.send-button');await scan(`${mode}-processing`);
      await evaluate('window.pamFixture.release()');await wait('!document.querySelector(".text-request input").disabled');
      await load('ambiguous');await scan(`${mode}-media-ambiguous`);
      await click('nav button:nth-of-type(3)');await click('.command-aliases .icon-button');
      for(const action of ['deezer_content','deezer_smarttracklist']){await set('.command-alias-editor>label:nth-of-type(3) select',action);await scan(`${mode}-${action}`);await keyboard(`${mode}-${action}`);}
      await load('recovery');await scan(`${mode}-profile-error`);await click('.notice.error button');await scan(`${mode}-profile-confirmation`);await keyboard(`${mode}-profile-confirmation`);
      await click('[aria-label="Confirmation de récupération"] button');await scan(`${mode}-profile-restored`);
      continue;
    }
    await click('.deezer-controls details summary');await scan(`${mode}-media-expanded`);
    for(const status of ['executed','pending','unsupported','silence','failed','cancelled','partial']){await set('.text-request input',status);await click('.send-button');}
    await evaluate('document.querySelectorAll(".turn-card details").forEach(e=>e.open=true)');await scan(`${mode}-history`);
    if(!before)await keyboard(mode);
    await click('.turn-correction button');await wait('!!document.querySelector("#correction-title")');
    await set('dialog select', '11111111-1111-4111-8111-111111111111');
    await set('dialog label:nth-of-type(3) select','deezer_search');await scan(`${mode}-correction`);
    await click('dialog .primary');await scan(`${mode}-correction-error`);await key('Escape');
    await click('nav button:nth-of-type(2)');await scan(`${mode}-applications`);
    await evaluate('window.pamFixture.setState("waiting")');await click('.page-intro .primary');await scan(`${mode}-picker-waiting`);
    await evaluate('window.pamFixture.release()');await wait('!!document.querySelector(".discovery-item")');await scan(`${mode}-picker`);
    if(!before)await keyboard(`${mode}-picker`);
    await evaluate('window.pamFixture.setState("error")');await click('.discovery-summary button');await scan(`${mode}-picker-error`);
    await click('.discovery-footer button');await wait('!!document.querySelector("#editor-title")');
    await set('dialog input[data-dialog-initial-focus]','Test');await set('dialog textarea[required]','Application de test');await set('.path-field input','C:\\fixture.exe');
    await click('.advanced summary');await scan(`${mode}-editor`);if(!before)await keyboard(`${mode}-editor`);
    await click('.launch-test button');await scan(`${mode}-editor-test-error`);
    await evaluate('window.pamFixture.setState("ready")');await click('.launch-test button');await scan(`${mode}-editor-test-success`);
    await click('dialog .modal-footer .primary');await scan(`${mode}-editor-save-error`);await key('Escape');
    await click('nav button:nth-of-type(3)');await scan(`${mode}-settings`);
    await click('.command-aliases .icon-button');await scan(`${mode}-alias-editor`);if(!before)await keyboard(`${mode}-alias-editor`);
    await click('.alias-form-footer .primary');await scan(`${mode}-alias-error`);
    await load('offline');await scan(`${mode}-offline`);await click('nav button:nth-of-type(3)');await scan(`${mode}-runtime-error`);
    await load('empty');await scan(`${mode}-no-apps`);await click('nav button:nth-of-type(2)');await scan(`${mode}-no-applications`);
    await load('error');await set('.text-request input','Demande');await click('.send-button');await scan(`${mode}-request-error`);
  }
  await writeFile(join(output,reportName),JSON.stringify({runtime:await evaluate('navigator.userAgent'),reports},null,2)+'\n');
  console.log(JSON.stringify({before,reports:reports.length,texts:reports.reduce((s,r)=>s+r.texts.length,0),failures:reports.reduce((s,r)=>s+r.failures.length,0),output}));
} finally {
  socket?.close();
  if(child&&child.exitCode===null){child.kill();await Promise.race([new Promise(done=>child.once('exit',done)),delay(3000)]);}
  await server.close();
  assert.ok(dirname(resolve(profile))===resolve(tmpdir())&&basename(profile).startsWith('pam-modal-'));
  await rm(profile,{recursive:true,force:true,maxRetries:20,retryDelay:100});
}
