const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const { createTemporaryFiles, atomicJson, LEGACY_RETENTION_MS } = require('./temporary-files.cjs');
const { createAssistant, DEFAULT_CONFIG } = require('./assistant.cjs');

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pam-cleanup-'));
  const config = { ...DEFAULT_CONFIG, applications: [{ id: randomUUID(), name: 'Test', description: 'Fixture',
    executable: process.execPath, arguments: [], aliases: ['Essai'], enabled: true }],
    commandAliases: [{ id: randomUUID(), phrase: 'ouvre mon test', applicationId: '', action: 'open' }] };
  config.commandAliases[0].applicationId = config.applications[0].id;
  await fs.writeFile(path.join(directory, 'applications.json'), JSON.stringify(config));
  t.after(async () => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.match(path.basename(directory), /^pam-cleanup-/);
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { directory, config, store: createTemporaryFiles(directory) };
}
async function turns(directory) { return (await fs.readdir(directory)).filter(name => name.startsWith('turn-')); }
async function old(file) { const date = new Date(Date.now() - LEGACY_RETENTION_MS - 1000); await fs.utimes(file, date, date); }
function child(t, directory, mode) {
  const process = fork(path.join(__dirname, 'fixtures/abandoned-audio.cjs'), [directory, mode], { silent: true });
  const exited = once(process, 'exit');
  const timer = setTimeout(() => process.kill(), 10_000);
  t.after(async () => { clearTimeout(timer); if (process.exitCode === null && process.signalCode === null) process.kill(); await exited; });
  return { process, exited };
}
async function assertAudio(directory) {
  const names = await turns(directory); assert.equal(names.length, 1);
  for (const name of ['clip.wav', 'keywords.txt', '.pam-owner.json']) assert.ok((await fs.stat(path.join(directory, names[0], name))).isFile());
}

for (const mode of ['exit', 'timeout', 'kill']) {
  test(`reprise après ${mode} : WAV/keywords présents avant, supprimés après, profil intact`, async t => {
    const f = await fixture(t);
    const c = child(t, f.directory, mode);
    if (mode === 'kill') { await once(c.process, 'message'); await assertAudio(f.directory); c.process.kill(); }
    const [code] = await c.exited;
    if (mode !== 'kill') assert.equal(code, 70);
    await assertAudio(f.directory);
    const handle = createAssistant({ configDirectory: f.directory, runtimeDirectory: f.directory });
    const status = await handle('status');
    assert.deepEqual(await turns(f.directory), []);
    assert.deepEqual(status.config, f.config);
    await handle('status'); // Idempotent; no retry loop.
    assert.deepEqual(await turns(f.directory), []);
  });
}
test('un autre processus actif et une demande locale survivent à plusieurs collectes', async t => {
  const f = await fixture(t);
  const c = child(t, f.directory, 'active');
  await once(c.process, 'message'); await assertAudio(f.directory);
  const name = (await turns(f.directory))[0]; await old(path.join(f.directory, name));
  const local = await f.store.createTurn(); await fs.writeFile(path.join(local.directory, 'clip.wav'), 'fixture');
  for (let i = 0; i < 2; i++) { const report = await f.store.collect(); assert.equal(report.failed, 0); assert.equal(report.retained, 2); }
  assert.equal(await fs.readFile(path.join(local.directory, 'clip.wav'), 'utf8'), 'fixture');
  await local.release(); c.process.kill(); await c.exited;
  await f.store.collect(); assert.deepEqual(await turns(f.directory), []);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.directory, 'applications.json'), 'utf8')), f.config);
});
test('rétention des anciens turn et .tmp, uniquement fichiers PAM reconnus', async t => {
  const f = await fixture(t);
  const recent = path.join(f.directory, 'turn-ABC123'); const expired = path.join(f.directory, 'turn-DEF456');
  await fs.mkdir(recent); await fs.mkdir(expired);
  await fs.writeFile(path.join(recent, 'clip.wav'), 'recent'); await fs.writeFile(path.join(expired, 'clip.wav'), 'expired');
  await fs.writeFile(path.join(expired, 'applications.json'), 'must survive'); await old(expired);
  const pending = path.join(f.directory, 'pending'); await fs.mkdir(pending);
  const tmp = path.join(f.directory, `applications.json.${randomUUID()}.tmp`);
  const pendingTmp = path.join(pending, `${randomUUID()}.json.${randomUUID()}.tmp`);
  const unknown = path.join(f.directory, `personal.json.${randomUUID()}.tmp`);
  for (const file of [tmp, pendingTmp, unknown]) { await fs.writeFile(file, 'partial'); await old(file); }
  await f.store.collect();
  assert.equal(await fs.readFile(path.join(recent, 'clip.wav'), 'utf8'), 'recent');
  await assert.rejects(fs.stat(path.join(expired, 'clip.wav')), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(expired, 'applications.json'), 'utf8'), 'must survive');
  for (const file of [tmp, pendingTmp]) await assert.rejects(fs.stat(file), { code: 'ENOENT' });
  assert.equal(await fs.readFile(unknown, 'utf8'), 'partial');
});
test('liens/jonctions vers un autre profil et sous-dossiers inattendus sont préservés', async t => {
  const f = await fixture(t); const outside = await fixture(t);
  await fs.writeFile(path.join(outside.directory, 'clip.wav'), 'outside');
  await fs.symlink(outside.directory, path.join(f.directory, 'turn-LINK01'), process.platform === 'win32' ? 'junction' : 'dir');
  const turn = path.join(f.directory, 'turn-SAFE01'); await fs.mkdir(turn);
  await fs.symlink(outside.directory, path.join(turn, 'child'), process.platform === 'win32' ? 'junction' : 'dir'); await old(turn);
  const report = await f.store.collect(); assert.ok(report.failed > 0);
  assert.equal(await fs.readFile(path.join(outside.directory, 'clip.wav'), 'utf8'), 'outside');
  await fs.symlink(outside.directory, path.join(f.directory, 'pending'), process.platform === 'win32' ? 'junction' : 'dir');
  const outsidePlan = path.join(outside.directory, `${randomUUID()}.json`);
  await fs.writeFile(outsidePlan, 'outside pending plan'); await old(outsidePlan);
  const status = await createAssistant({ configDirectory: f.directory, runtimeDirectory: f.directory })('status');
  assert.ok(status.temporaryCleanup.failed > 0);
  assert.equal(await fs.readFile(outsidePlan, 'utf8'), 'outside pending plan');
  await assert.rejects(atomicJson(path.join(f.directory, 'pending', `${randomUUID()}.json`), {}, f.directory), /non sûr/);
  assert.equal((await fs.readdir(outside.directory)).length, 3);
});
test('les propositions expirées sont collectées, les propositions récentes et fichiers étrangers survivent', async t => {
  const f = await fixture(t); const pending = path.join(f.directory, 'pending'); await fs.mkdir(pending);
  const recent = path.join(pending, `${randomUUID()}.json`); const expired = path.join(pending, `${randomUUID()}.json`);
  await fs.writeFile(recent, 'recent'); await fs.writeFile(expired, 'expired'); await old(expired);
  await fs.writeFile(path.join(pending, 'applications.json'), 'foreign');
  await f.store.collect(); await assert.rejects(fs.stat(expired), { code: 'ENOENT' });
  assert.equal(await fs.readFile(recent, 'utf8'), 'recent');
  assert.equal(await fs.readFile(path.join(pending, 'applications.json'), 'utf8'), 'foreign');
});
test('disque non accessible : résultat borné, aucun retry ni suppression', async t => {
  const f = await fixture(t); const original = fs.lstat; let calls = 0;
  t.mock.method(fs, 'lstat', async file => { if (file === f.directory) { calls++; throw Object.assign(Error('offline'), { code: 'EACCES' }); } return original(file); });
  assert.deepEqual(await f.store.collect(), { removed: 0, retained: 0, failed: 1 }); assert.equal(calls, 1);
  t.mock.restoreAll(); assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.directory, 'applications.json'), 'utf8')), f.config);
});
test('écriture JSON interrompue : propriétaire mort collecté, configuration intacte', async t => {
  const f = await fixture(t); const c = child(t, f.directory, 'atomic-exit');
  assert.equal((await c.exited)[0], 70);
  assert.equal((await fs.readdir(f.directory)).filter(name => name.endsWith('.tmp')).length, 1);
  await f.store.collect();
  assert.deepEqual((await fs.readdir(f.directory)).filter(name => name.endsWith('.tmp')), []);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.directory, 'applications.json'), 'utf8')), f.config);
});
test('écriture active : .tmp préservé jusqu’au renommage', async t => {
  const f = await fixture(t); const original = fs.rename;
  let signalReady, finish;
  const ready = new Promise(resolve => { signalReady = resolve; });
  const gate = new Promise(resolve => { finish = resolve; });
  t.mock.method(fs, 'rename', async (...args) => { signalReady(); await gate; return original(...args); });
  const writing = atomicJson(path.join(f.directory, 'applications.json'), f.config);
  await ready;
  assert.equal((await f.store.collect()).retained, 1);
  assert.equal((await fs.readdir(f.directory)).filter(name => name.endsWith('.tmp')).length, 1);
  finish(); await writing; t.mock.restoreAll();
  assert.deepEqual((await fs.readdir(f.directory)).filter(name => name.endsWith('.tmp')), []);
});
for (const stage of ['writeFile', 'rename']) {
  test(`échec ${stage} : .tmp supprimé, configuration précédente intacte`, async t => {
    const f = await fixture(t); const original = fs[stage];
    t.mock.method(fs, stage, async (...args) => {
      if (args[0].endsWith('.tmp')) {
        if (stage === 'writeFile') await original(...args);
        throw Object.assign(Error('disk error'), { code: 'EIO' });
      }
      return original(...args);
    });
    await assert.rejects(atomicJson(path.join(f.directory, 'applications.json'), { replacement: true }), /disk error/);
    t.mock.restoreAll(); assert.deepEqual((await fs.readdir(f.directory)).filter(name => name.endsWith('.tmp')), []);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.directory, 'applications.json'), 'utf8')), f.config);
  });
}
