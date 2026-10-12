// Run with a Windows Tauri binary built with --features process-tests and a
// fixture compiled from tests/fixtures/process-fixture.rs. No user app is used.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
assert.equal(process.platform, 'win32');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [pam, fixture] = process.argv.slice(2).map(value => resolve(value));
assert.ok(pam && fixture, 'Usage: node scripts/smoke-process-isolation.mjs pam.exe fixture.exe');
await Promise.all([stat(pam), stat(fixture)]);
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const wait = async (check, label) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(r => setTimeout(r, 50)); }
  throw Error(`Timeout: ${label}`);
};
const read = async path => { try { return await readFile(path, 'utf8'); } catch { return null; } };
for (const scenario of ['quit', 'restart_sidecar', 'kill', 'catalogue_quit', 'catalogue_restart_sidecar', 'catalogue_kill']) {
  const action = scenario.replace('catalogue_', '');
  const catalogue = scenario.startsWith('catalogue_');
  const profile = await mkdtemp(join(root, '.runtime-cache/process-'));
  const owned = new Set();
  const name = `PAM Process Fixture ${randomUUID()}`;
  const programs = join(process.env.APPDATA, 'Microsoft/Windows/Start Menu/Programs');
  const shortcut = join(programs, `${name}.lnk`);
  let createdShortcut = false;
  const child = spawn(pam, ['--pam-process-test', join(root, 'src-tauri/binaries/pam-node-x86_64-pc-windows-msvc.exe'),
    join(root, 'tests/fixtures/process-sidecar.cjs'), join(root, 'src-tauri/runtime'), profile],
    { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PAM_PROCESS_FIXTURE: fixture } });
  let stderr = ''; child.stderr.on('data', chunk => stderr += chunk);
  const lines = createInterface({ input: child.stdout });
  const iterator = lines[Symbol.asyncIterator]();
  const request = async (method, payload = {}) => {
    child.stdin.write(JSON.stringify({ method, payload }) + '\n');
    let timer;
    const next = await Promise.race([iterator.next(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error(`Host timeout: ${method}: ${stderr}`)), 55_000);
    })]).finally(() => clearTimeout(timer));
    assert.equal(next.done, false, stderr);
    return JSON.parse(next.value);
  };
  try {
    const status = await request('status');
    assert.equal(status.ok, true, status.error);
    assert.equal(status.result.engine.loaded, true, 'Real Needle engine must be loaded in Node');
    await wait(async () => Boolean(await read(join(profile, 'internal.json'))), 'internal PIDs');
    const internal = JSON.parse(await readFile(join(profile, 'internal.json'), 'utf8'));
    owned.add(internal.node); owned.add(internal.auxiliary);
    assert.equal(status.result.engine.pid, internal.node);
    assert.ok(alive(internal.node) && alive(internal.auxiliary));
    const marker = join(profile, 'user.txt');
    const literal = ['a" b', '& | % ^', 'trailing\\', 'é日本'];
    let draft = { name: 'PAM process fixture', description: 'Inoffensive test process.',
      executable: fixture, arguments: [marker, ...literal], aliases: [], enabled: true };
    if (catalogue) {
      const created = await request('create_fixture_shortcut', { target: fixture, arguments: `"${marker}"`, destination: shortcut });
      assert.equal(created.ok, true, created.error); createdShortcut = true;
      const discovery = await request('discover_applications');
      assert.equal(discovery.ok, true, discovery.error);
      const entry = discovery.result.find(app => app.name === name);
      assert.ok(entry, 'Native catalogue must discover the disposable shortcut');
      draft = { ...draft, executable: join(process.env.SystemRoot, 'explorer.exe'), arguments: [entry.launchArgument],
        windowsApp: { appId: entry.appId, kind: entry.kind, launchArgument: entry.launchArgument, icon: entry.icon } };
    }
    let launched;
    if (!catalogue && action !== 'quit') {
      const saved = await request('save_application', draft);
      assert.equal(saved.ok, true, saved.error);
      const application = saved.result.applications[0];
      const prepared = await request('prepare_action', { applicationId: application.id, action: 'open' });
      assert.equal(prepared.ok, true, prepared.error);
      assert.equal(prepared.result.status, 'pending');
      const confirmed = await request('confirm', { id: prepared.result.id });
      assert.equal(confirmed.ok, true, confirmed.error);
      assert.equal(confirmed.result.status, 'executed');
      launched = { ok: true, result: confirmed.result.results[0] };
      assert.equal((await request('confirm', { id: prepared.result.id })).ok, false, 'Approval cannot launch twice');
    } else {
      launched = await request('test_application', draft);
    }
    assert.equal(launched.ok, true, launched.error);
    assert.equal(launched.result.success, true, launched.result.message);
    if (!catalogue) owned.add(launched.result.details.pid);
    await wait(async () => Boolean(await read(marker)), 'user marker');
    const markerLines = (await readFile(marker, 'utf8')).split('\n');
    const userPid = Number(markerLines[0]); owned.add(userPid);
    assert.ok(Number.isSafeInteger(userPid) && userPid > 0);
    assert.deepEqual(markerLines, [String(userPid), ...(catalogue ? [''] : literal)]);
    assert.ok(alive(userPid));
    const manual = { ...draft, windowsApp: undefined };
    const invalid = await request('test_application', { ...manual, executable: join(profile, 'missing.exe') });
    assert.equal(invalid.ok, false);
    assert.match(invalid.error, /ENOENT|introuvable/);
    // A corrupt but existing .exe reaches Rust and gets a correlated spawn error.
    const { writeFile } = await import('node:fs/promises');
    const corrupt = join(profile, 'invalid.exe'); await writeFile(corrupt, 'not executable');
    const nativeError = await request('test_application', { ...manual, executable: corrupt });
    assert.equal(nativeError.ok, true);
    assert.equal(nativeError.result.success, false);
    assert.match(nativeError.result.message, /Impossible de lancer/);
    if (action === 'quit') {
      const exited = once(child, 'exit'); child.stdin.end(JSON.stringify({ method: 'quit' }) + '\n'); await exited;
    } else if (action === 'kill') {
      const exited = once(child, 'exit'); child.kill(); await exited;
    } else {
      const restarted = await request('restart_sidecar');
      assert.equal(restarted.ok, true, restarted.error);
      assert.equal(restarted.result.engine.loaded, true);
      assert.notEqual(restarted.result.engine.pid, internal.node);
      owned.add(restarted.result.engine.pid);
      await wait(async () => {
        const next = JSON.parse(await read(join(profile, 'internal.json')) || '{}');
        if (next.node !== internal.node && next.auxiliary) { owned.add(next.auxiliary); return true; }
        return false;
      }, 'replacement internal PIDs');
    }
    await wait(() => !alive(internal.node) && !alive(internal.auxiliary), 'job cleanup');
    assert.ok(alive(userPid), `User fixture must survive ${scenario}`);
    console.log(JSON.stringify({ scenario, hostPid: child.pid, userPid, internal, realEngineLoaded: true,
      userSurvives: true, internalStopped: true, literalArguments: !catalogue, shortcutArguments: catalogue, invalidPathsFail: true }));
  } finally {
    if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    for (const pid of owned) if (alive(pid)) process.kill(pid);
    await wait(() => [...owned].every(pid => !alive(pid)), 'fixture cleanup');
    lines.close();
    if (createdShortcut) {
      assert.equal(dirname(resolve(shortcut)), resolve(programs)); assert.equal(shortcut, join(programs, `${name}.lnk`));
      await unlink(shortcut);
    }
    assert.equal(dirname(profile), join(root, '.runtime-cache')); assert.ok(profile.startsWith(join(root, '.runtime-cache/process-')));
    await rm(profile, { recursive: true, force: true });
  }
}
