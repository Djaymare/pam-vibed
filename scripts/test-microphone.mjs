import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer as netServer } from 'node:net';
import { createServer as httpServer } from 'node:http';
import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';

// Interactive regression host: stdin accepts JSON {command:'state'|'start'|
// 'test'|'finish'|'cancel'|'hide'|'close'|'suspend'|'quit'}. Hardware and permissions stay manual.
// PAM_MICROPHONE_HOST must be a freshly built production debug binary.
assert.equal(process.platform, 'win32');
const host = process.env.PAM_MICROPHONE_HOST;
assert.ok(host, 'Set PAM_MICROPHONE_HOST to the current debug pam.exe.');
const dependencyRoot = resolve(process.env.PAM_TEST_DEPENDENCY_ROOT || '.');
const { build } = await import(pathToFileURL(join(dependencyRoot, 'node_modules/vite/dist/node/index.js')));
const { default: vue } = await import(pathToFileURL(join(dependencyRoot, 'node_modules/@vitejs/plugin-vue/dist/index.mjs')));
const root = resolve('.'), profile = await mkdtemp(join(tmpdir(), 'pam-microphone-'));
// Serve compiled assets: a development client can reload after sleep and erase
// the very recorder state this test needs to observe.
const site = join(profile, 'site');
await build({ root, configFile: false, plugins: [vue()], build: {
  outDir: site, emptyOutDir: true,
  rollupOptions: { input: join(root, 'tests/fixtures/microphone-page.html') },
} });
const server = httpServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = resolve(site, '.' + (pathname === '/' ? '/tests/fixtures/microphone-page.html' : pathname));
    if (!file.startsWith(site + sep)) { res.writeHead(403).end(); return; }
    const content = await readFile(file);
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(content);
  } catch { res.writeHead(404).end(); }
});
const probe = netServer(); await new Promise(done => probe.listen(0, '127.0.0.1', done));
const port = probe.address().port; await new Promise(done => probe.close(done));
const delay = ms => new Promise(done => setTimeout(done, ms));
let child, socket, input;
const observations = [], checks = [], failures = [];
const save = async (profileRemoved = false) => {
  if (process.env.PAM_MICROPHONE_RESULT) await writeFile(process.env.PAM_MICROPHONE_RESULT, JSON.stringify({ observations, checks, failures, profileRemoved }, null, 2));
};
try {
  await new Promise((done, reject) => { server.once('error', reject); server.listen(1420, 'localhost', done); });
  child = spawn(host, [], { windowsHide: true, stdio: 'pipe', env: { ...process.env,
    PAM_PROFILE_DIR: join(profile, 'profile'), WEBVIEW2_USER_DATA_FOLDER: join(profile, 'webview'),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` } });
  child.stderr.on('data', data => process.stderr.write(data));
  let target;
  for (let i = 0; i < 200; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page' && t.url.startsWith('http://localhost:1420')); } catch {}
    if (target) break;
    if (child.exitCode !== null) throw Error(`Native host exited ${child.exitCode}`);
    await delay(100);
  }
  assert.ok(target, 'Production WebView2 target available');
  let id = 0; const pending = new Map();
  const connect = async () => {
    socket?.close();
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((done, reject) => { socket.onopen = done; socket.onerror = reject; });
    socket.onmessage = event => { const r = JSON.parse(event.data), p = pending.get(r.id);
      if(r.method === 'Runtime.exceptionThrown') console.error(JSON.stringify(r.params)); if (!p) return;
      pending.delete(r.id); clearTimeout(p.timer); r.error ? p.reject(Error(JSON.stringify(r.error))) : p.done(r.result); };
  };
  await connect();
  const cdp = (method, params = {}) => new Promise((done, reject) => { const key = ++id;
    const timer = setTimeout(() => { pending.delete(key); reject(Error('Timed out: '+method)); }, 10000);
    pending.set(key, { done, reject, timer }); socket.send(JSON.stringify({ id: key, method, params })); });
  const evaluate = async expression => { const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
  await cdp('Runtime.enable');
  for (let i=0;i<100 && !await evaluate('!!window.pamMicrophone');i++) await delay(100);
  assert.ok(await evaluate('!!window.pamMicrophone'), 'Fixture mounted');
  console.log(JSON.stringify({ ready: true, native: true, profile, host, runtime: await cdp('Browser.getVersion') }));
  input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of input) {
    if (!line.trim()) continue;
    try {
      const { command, note } = JSON.parse(line);
      if (command === 'quit') break;
      // Sleep can leave the debugger socket stale. Reconnect without navigating.
      await connect();
      if (command === 'check-ui') {
        const available = await evaluate(`(() => { const button=document.querySelector('.microphone-panel button'); button.focus(); return !button.disabled && document.activeElement === button && button.textContent.includes('Tester le microphone'); })()`);
        assert.ok(available, 'Microphone test is keyboard-focusable without an application or engine');
        await cdp('Accessibility.enable'); const ax = await cdp('Accessibility.getFullAXTree');
        assert.ok(ax.nodes.some(node => !node.ignored && node.role?.value === 'region' && node.name?.value === 'Votre microphone'));
        checks.push('Real microphone panel: named region, enabled and focusable test before app/engine configuration');
        console.log(JSON.stringify({ check: checks.at(-1), passed: true }));
      } else if (command === 'screenshot') {
        assert.ok(process.env.PAM_MICROPHONE_SCREENSHOT, 'Set screenshot output path');
        await writeFile(process.env.PAM_MICROPHONE_SCREENSHOT, Buffer.from((await cdp('Page.captureScreenshot')).data, 'base64'));
      } else if (command === 'start') await evaluate('void window.pamMicrophone.audio.startRecording()');
      else if (command === 'test') await evaluate('void window.pamMicrophone.audio.testMicrophone()');
      else if (command === 'finish') await evaluate('window.pamMicrophone.audio.finishRecording()');
      else if (command === 'cancel') await evaluate('window.pamMicrophone.audio.cancelRecording()');
      else if (['hide','close','suspend'].includes(command)) await evaluate(`window.pamMicrophone.${command}()`);
      else assert.equal(command, 'state', 'Unknown command');
      await delay(200);
      const state = await evaluate('window.pamMicrophone.state()');
      const entry = { atUtc: new Date().toISOString(), command, note, state, nativeVisible: await evaluate('window.pamMicrophone.nativeVisible()') };
      observations.push(entry); console.log(JSON.stringify(entry));
      await save();
    } catch(error) { failures.push(String(error)); console.log(JSON.stringify({ error: String(error) })); await save(); }
  }
} finally {
  input?.close(); socket?.close();
  if (child && child.exitCode === null) { child.kill(); await new Promise(done => child.once('exit', done)); }
  if (server.listening) await new Promise((done, reject) => server.close(error => error ? reject(error) : done()));
  assert.ok(dirname(resolve(profile)) === resolve(tmpdir()) && basename(profile).startsWith('pam-microphone-'), 'Cleanup target must be this disposable test profile');
  for (let i=0;i<20;i++) { try { await rm(profile, { recursive: true, force: true }); break; } catch(error) { if(i===19) throw error; await delay(200); } }
  await save(true);
  if (failures.length) process.exitCode = 1;
}
