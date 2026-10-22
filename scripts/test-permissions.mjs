import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { mkdtemp, rm, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

assert.equal(process.platform, 'win32', 'This suite requires native Windows WebView2.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const host = resolve(
  process.env.PAM_PERMISSION_TEST_HOST ||
    join(
      process.env.CARGO_TARGET_DIR || 'src-tauri/target',
      'x86_64-pc-windows-msvc/debug/examples/permission-test-host.exe',
    ),
);
await access(host);
const reportDirectory = resolve(
  process.env.PAM_PERMISSION_REPORT_DIR ||
    join(root, 'artifacts/webview-tests/permissions', String(Date.now())),
);
await mkdir(reportDirectory, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'pam-permissions-'));
const server = createServer((_, response) => {
  response.writeHead(200, {
    'Content-Type': 'text/html',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'",
  });
  response.end('<!doctype html><title>PAM untrusted origin fixture</title>');
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const remote = `http://127.0.0.1:${server.address().port}/`;
const portServer = createNetServer();
await new Promise((done) => portServer.listen(0, '127.0.0.1', done));
const debugPort = portServer.address().port;
await new Promise((done) => portServer.close(done));
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const sockets = [];
const report = {
  kind: 'Real Tauri IPC/ACL and Windows WebView2; disposable services',
  host,
  profile,
  checks: [],
  cleanup: {},
  outcome: 'running',
  stderr: '',
};
let child, spawnError;

async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  sockets.push(socket);
  await new Promise((done, reject) => {
    socket.onopen = done;
    socket.onerror = reject;
  });
  let sequence = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    message.error
      ? request.reject(Error(JSON.stringify(message.error)))
      : request.resolve(message.result);
  };
  const cdp = (method, params = {}) =>
    new Promise((done, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Error(`Timeout: ${method}`));
      }, 10000);
      pending.set(id, { resolve: done, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await cdp('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const invoke = (command, args = {}) =>
    evaluate(
      `(async () => { try { return { ok:true, value:await window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)},${JSON.stringify(args)}) }; } catch(error) { return { ok:false, error }; } })()`,
    );
  return { evaluate, invoke, cdp };
}
function check(name, condition) {
  assert.ok(condition, name);
  report.checks.push(name);
  console.log(`PASS ${name}`);
}
async function denied(page, command, args, label) {
  const result = await page.invoke(command, args);
  check(
    `${label}: ${command} denied by native ACL`,
    result.ok === false &&
      typeof result.error === 'string' &&
      /not allowed|not permitted/i.test(result.error),
  );
}
const request = (method, payload = {}) => ({
  request: {
    version: 1,
    id: 1,
    requestId: '11111111-1111-4111-8111-111111111111',
    method,
    payload,
  },
});

try {
  child = spawn(host, [], {
    windowsHide: true,
    stdio: 'pipe',
    env: {
      ...process.env,
      PAM_PERMISSION_TEST_PROFILE: profile,
      PAM_PERMISSION_TEST_REMOTE: remote,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort}`,
    },
  });
  report.pid = child.pid;
  child.on('error', (error) => {
    spawnError = error;
  });
  child.stderr.on('data', (bytes) => {
    report.stderr = (report.stderr + bytes).slice(-12000);
  });
  let targets = [];
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      targets = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).filter(
        (t) => t.type === 'page',
      );
    } catch {}
    if (
      targets.length === 3 &&
      targets.every((t) => t.url.includes('__permission_test') || t.url === remote)
    )
      break;
    if (spawnError) throw spawnError;
    assert.equal(child.exitCode, null, `Fixture exited early: ${report.stderr}`);
    await delay(100);
  }
  assert.equal(targets.length, 3, `Three fixture WebViews must load: ${report.stderr}`);
  // Read native metadata because both local views use the same page and origin.
  const localTargets = targets.filter((t) => t.url.includes('__permission_test'));
  assert.equal(localTargets.length, 2);
  const locals = await Promise.all(localTargets.map(connect));
  let main, untrusted;
  for (const page of locals) {
    const label = await page.evaluate('window.__TAURI_INTERNALS__.metadata.currentWebview.label');
    if (label === 'main') main = page;
    if (label === 'untrusted') untrusted = page;
  }
  assert.ok(main && untrusted, 'Native webview labels');
  const localMainUrl = await main.evaluate('location.href');
  const remotePage = await connect(targets.find((t) => t.url === remote));
  report.runtime = await main.evaluate('navigator.userAgent');
  const status = await main.invoke('assistant_request', request('supervisor_status'));
  check(
    'main local: production supervisor_status succeeds without sidecar',
    status.ok && status.value.ok && status.value.method === 'supervisor_status',
  );
  const shortcut = await main.invoke('assistant_request', request('voice_shortcut'));
  check(
    'main local: shortcut preference query succeeds without global registration',
    shortcut.ok && shortcut.value.ok && shortcut.value.result.id === 'ctrl_shift_space',
  );
  for (const action of ['listening', 'idle', 'hide']) {
    const result = await main.invoke('assistant_request', request('desktop_action', { action }));
    check(`main local: authorized desktop ${action}`, result.ok && result.value.ok);
  }
  const invalid = await main.invoke('assistant_request', request('not_a_method'));
  check(
    'main local: contract still rejects unknown methods',
    !invalid.ok && invalid.error.code === 'invalid_request',
  );
  const contract = JSON.parse(await readFile(join(root, 'sidecar/contracts.json'), 'utf8'));
  for (const method of Object.keys(contract.methods)) {
    const result = await main.invoke(
      'assistant_request',
      request(method, { forbiddenFixtureField: true }),
    );
    check(
      `main local/${method}: admitted to production payload validation`,
      !result.ok && result.error.code === 'invalid_request',
    );
  }

  await main.evaluate(
    `window.permissionPulses=0; window.permissionHandler=window.__TAURI_INTERNALS__.transformCallback(()=>window.permissionPulses++);`,
  );
  const handlerId = await main.evaluate('window.permissionHandler');
  const listen = await main.invoke('plugin:event|listen', {
    event: 'pam-toggle-voice',
    target: { kind: 'Any' },
    handler: handlerId,
  });
  check('main local: native event listener allowed', listen.ok && Number.isInteger(listen.value));
  await delay(300);
  check(
    'main local: Rust voice event reaches frontend listener',
    await main.evaluate('window.permissionPulses>0'),
  );
  const unlisten = await main.invoke('plugin:event|unlisten', {
    event: 'pam-toggle-voice',
    eventId: listen.value,
  });
  check('main local: event listener removal allowed', unlisten.ok);
  const pulses = await main.evaluate('window.permissionPulses');
  await delay(250);
  check(
    'main local: removed listener receives no further voice event',
    (await main.evaluate('window.permissionPulses')) === pulses,
  );
  // Invalid dialog input must reach the real plugin's deserializer, never open
  // a system dialog; a native ACL rejection is a distinct failure here.
  const picker = await main.invoke('plugin:dialog|open', {
    options: { multiple: 'invalid-fixture-type' },
  });
  check(
    'main local: file picker admitted to real dialog plugin',
    !picker.ok &&
      /invalid args|invalid type/i.test(String(picker.error)) &&
      !/not allowed/i.test(String(picker.error)),
  );

  for (const page of [main, untrusted, remotePage]) {
    const label = await page.evaluate('window.__TAURI_INTERNALS__.metadata.currentWebview.label');
    await denied(page, 'permission_canary', {}, label);
    await denied(page, 'plugin:event|emit', { event: 'pam-toggle-voice', payload: null }, label);
    await denied(
      page,
      'plugin:event|emit_to',
      { target: { kind: 'Any' }, event: 'pam-toggle-voice', payload: null },
      label,
    );
    await denied(
      page,
      'plugin:webview|create_webview_window',
      { options: { label: 'forbidden' } },
      label,
    );
    await denied(page, 'plugin:global-shortcut|register', {}, label);
    await denied(page, 'plugin:dialog|save', {}, label);
  }
  for (const [label, page] of [
    ['untrusted local', untrusted],
    ['remote HTTP', remotePage],
  ]) {
    for (const method of Object.keys(contract.methods))
      await denied(page, 'assistant_request', request(method), `${label}/${method}`);
    await denied(
      page,
      'plugin:event|listen',
      { event: 'pam-toggle-voice', target: { kind: 'Any' }, handler: 0 },
      label,
    );
    await denied(page, 'plugin:dialog|open', { options: {} }, label);
  }
  // Same trusted label, now at an untrusted origin. The label guard alone would
  // pass; the real Tauri runtime must deny before the production handler.
  await main.cdp('Page.navigate', { url: `${remote}?navigated-main` });
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await main.evaluate('location.href').catch(() => '')) === `${remote}?navigated-main`)
      break;
    await delay(50);
  }
  check(
    'main navigated to HTTP fixture origin',
    (await main.evaluate('location.href')) === `${remote}?navigated-main`,
  );
  await denied(main, 'assistant_request', request('supervisor_status'), 'main remote origin');
  await denied(main, 'permission_canary', {}, 'main remote origin');
  await denied(
    main,
    'plugin:event|listen',
    { event: 'pam-toggle-voice', target: { kind: 'Any' }, handler: 0 },
    'main remote origin',
  );
  await denied(main, 'plugin:dialog|open', { options: {} }, 'main remote origin');
  await main.cdp('Page.navigate', { url: localMainUrl });
  let restored;
  for (let attempt = 0; attempt < 100; attempt++) {
    restored = await main
      .invoke('assistant_request', request('supervisor_status'))
      .catch(() => null);
    if (restored?.ok && restored.value.ok) break;
    await delay(50);
  }
  check(
    'main restored to local origin: production IPC works again',
    restored?.ok && restored.value.ok,
  );
  report.outcome = 'passed';
} catch (error) {
  report.outcome = 'failed';
  report.error = error.stack || String(error);
  throw error;
} finally {
  sockets.forEach((socket) => socket.close());
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    await new Promise((done) => {
      killer.once('exit', done);
      killer.once('error', done);
    });
    for (
      let attempt = 0;
      attempt < 60 && child.exitCode === null && child.signalCode === null;
      attempt++
    )
      await delay(50);
  }
  report.cleanup.hostExited =
    !child || !!spawnError || child.exitCode !== null || child.signalCode !== null;
  await new Promise((done) => server.close(done));
  report.cleanup.serverClosed = true;
  assert.ok(
    dirname(profile) === resolve(tmpdir()) && basename(profile).startsWith('pam-permissions-'),
    'Disposable cleanup target',
  );
  await rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  report.cleanup.profileRemoved = true;
  assert.ok(report.cleanup.hostExited, 'No surviving fixture host');
  await writeFile(join(reportDirectory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(
    `Native authorization: ${report.checks.length} checks; ${report.outcome}; ${join(reportDirectory, 'report.json')}`,
  );
}
