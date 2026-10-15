const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createInterface } = require('node:readline');
const { createConfigStore } = require('./config-store.cjs');
const { migrateConfig } = require('./config-migrations.cjs');
const { DEFAULT_CONFIG, validateConfig } = require('./config-schema.cjs');
const { createTemporaryFiles } = require('./temporary-files.cjs');
const { createAssistant } = require('./assistant.cjs');

async function fixture(t, options) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pam-persistence-'));
  t.after(async () => {
    assert.equal(path.dirname(directory), os.tmpdir()); assert.ok(path.basename(directory).startsWith('pam-persistence-'));
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const store = createConfigStore(directory, options), file = path.join(directory, 'applications.json'), backup = path.join(directory, 'applications.backup.json');
  return { directory, store, file, backup };
}
async function validProfile() {
  const value = JSON.parse(await fs.readFile(path.join(__dirname, 'fixtures/profiles/valid.json'), 'utf8'));
  value.applications[0].media = { sourceAppId: 'fixture.exe', deezer: false };
  value.commandAliases = [{ id: '11111111-1111-4111-8111-111111111111', phrase: 'Pause mon éditeur', applicationId: value.applications[0].id, action: 'media_pause' }];
  return value;
}
const bytes = file => fs.readFile(file, 'utf8');
const parsed = async file => migrateConfig(JSON.parse(await bytes(file)));
test('migration 1 → 2 déterministe, sans réécriture à la lecture ; original exact sauvegardé avant modification', async t => {
  const old = await validProfile(), original = JSON.stringify(old, null, 4), f = await fixture(t);
  await fs.writeFile(f.file, original);
  const migrated = migrateConfig(old);
  assert.equal(old.version, 1); assert.equal(migrated.version, 2);
  assert.deepEqual(migrateConfig(old), migrated); assert.deepEqual(migrateConfig(migrated), migrated);
  assert.deepEqual(await f.store.read(), migrated); assert.equal(await bytes(f.file), original);
  await f.store.write({ ...migrated, language: 'en' });
  assert.equal(await bytes(f.backup), original);
  assert.equal((await f.store.read()).language, 'en');
});
test('migration en échec et version future : original et sauvegarde préservés, marche à suivre disponible', async t => {
  const f = await fixture(t), old = await validProfile(), original = JSON.stringify(old);
  await fs.writeFile(f.file, original); await fs.writeFile(f.backup, JSON.stringify(DEFAULT_CONFIG));
  const store = createConfigStore(f.directory, { migrations: { 1: () => { throw Error('fixture migration failed'); } } });
  await assert.rejects(store.read(), error => error.code === 'invalid_profile' && /Migration 1 → 2 échouée.*restaurez une sauvegarde/.test(error.message));
  assert.equal(await bytes(f.file), original); assert.deepEqual(await parsed(f.backup), DEFAULT_CONFIG);
  assert.throws(() => migrateConfig(old, { 1: x => ({ ...x, version: 2, commandAliases: [{ id: 'broken' }] }) }), /Migration.*échouée/);
  await fs.writeFile(f.file, JSON.stringify({ ...old, version: 999 }));
  await assert.rejects(f.store.read(), /Version.*compatible.*sauvegarde/);
  assert.equal(JSON.parse(await bytes(f.file)).version, 999);
});
test('export/import complet et remplacement avec identifiants conservés, sans fusion ni exécution', async t => {
  const from = await fixture(t), to = await fixture(t), expected = migrateConfig(await validProfile());
  await from.store.write(expected);
  const content = await from.store.exportConfig();
  await to.store.write({ ...DEFAULT_CONFIG, language: 'de' });
  const before = await bytes(to.file), preview = await to.store.previewImport(content);
  assert.deepEqual(preview.summary.applications, expected.applications.map(a => a.name));
  assert.equal(preview.summary.formulations, 1);
  assert.equal(await bytes(to.file), before);
  await assert.rejects(to.store.importConfig({ ...preview, content }), /Confirmez/);
  const result = await to.store.importConfig({ ...preview, content, confirmed: true });
  assert.deepEqual(await to.store.read(), expected); assert.equal(await bytes(result.backupPath), before);
  assert.equal(await bytes(to.backup), before);
  const second = await to.store.previewImport(content);
  await to.store.importConfig({ ...second, content, confirmed: true });
  assert.deepEqual(await to.store.read(), expected);
  for (const mutate of [v => v.applications.push(v.applications[0]), v => v.commandAliases[0].applicationId = 'unknown', v => v.commandAliases.push(v.commandAliases[0])]) {
    const invalid = structuredClone(expected); mutate(invalid);
    await assert.rejects(to.store.previewImport(JSON.stringify(invalid)), /doublon|inconnue/);
  }
});
test('aperçu périmé, JSON/UTF-8/taille invalides : aucun remplacement', async t => {
  const f = await fixture(t); await f.store.write(DEFAULT_CONFIG);
  const content = JSON.stringify(await validProfile()), preview = await f.store.previewImport(content);
  await assert.rejects(f.store.importConfig({ ...preview, content: content + ' ', confirmed: true }), /changé/);
  await f.store.write({ ...DEFAULT_CONFIG, language: 'en' });
  await assert.rejects(f.store.importConfig({ ...preview, content, confirmed: true }), /changé/);
  const original = await bytes(f.file);
  for (const content of ['{bad', ' '.repeat(2 * 1024 * 1024 + 1), JSON.stringify({ version: 900 })]) await assert.rejects(f.store.previewImport(content));
  assert.equal(await bytes(f.file), original);
  await fs.writeFile(f.file, Buffer.from([0xff]));
  await assert.rejects(f.store.read(), /UTF-8/);
});
test('corruption partielle et fichier absent : restauration confirmée de la dernière copie, preuve intacte', async t => {
  const f = await fixture(t), expected = migrateConfig(await validProfile());
  await f.store.write(expected); await f.store.write({ ...expected, language: 'en' });
  const backup = await bytes(f.backup), corrupt = '{"applications": [';
  await fs.writeFile(f.file, corrupt);
  let error; try { await f.store.read(); } catch (caught) { error = caught; }
  assert.equal(error.details.backupSummary.formulations, 1);
  await assert.rejects(f.store.recover({ ...error.details, restoreBackup: true }), /Confirmez/);
  await assert.rejects(f.store.recover({ ...error.details, restoreBackup: true, confirmed: true, backupFingerprint: 'stale' }), /sauvegarde a changé/);
  const result = await f.store.recover({ ...error.details, restoreBackup: true, confirmed: true });
  assert.equal(await bytes(result.backupPath), corrupt); assert.equal(await bytes(f.backup), backup);
  assert.deepEqual(await f.store.read(), expected);
  await fs.unlink(f.file);
  await assert.rejects(f.store.read(), /Profil courant absent/);
  const info = await f.store.recoveryInfo(); assert.equal(info.fingerprint, 'missing');
  await f.store.recover({ ...info, restoreBackup: true, confirmed: true });
  assert.deepEqual(await f.store.read(), expected);
});
test('restauration volontaire d’un profil valide et import sur corruption préservent les originaux', async t => {
  const f = await fixture(t), expected = migrateConfig(await validProfile());
  await f.store.write(expected); await f.store.write({ ...expected, language: 'en' });
  const before = await bytes(f.file), info = await f.store.recoveryInfo();
  const restored = await f.store.recover({ ...info, restoreBackup: true, confirmed: true });
  assert.equal(await bytes(restored.backupPath), before); assert.deepEqual(restored.config, expected);
  const corrupt = 'broken'; await fs.writeFile(f.file, corrupt);
  const content = JSON.stringify(expected), preview = await f.store.previewImport(content);
  const imported = await f.store.importConfig({ ...preview, content, confirmed: true });
  assert.equal(await bytes(imported.backupPath), corrupt); assert.deepEqual(imported.config, expected);
  assert.deepEqual(await parsed(f.backup), expected);
});

for (const target of ['applications.backup.json', 'applications.json']) {
  for (const fault of ['open', 'partial_write', 'sync', 'rename']) test(`faute E/S ${fault} sur ${target} : copie valide et temporaire nettoyé`, async t => {
    const f = await fixture(t), expected = migrateConfig(await validProfile()); await f.store.write(expected);
    const original = await bytes(f.file), saved = await bytes(f.backup);
    const io = { ...fs, open: async (file, flags, ...args) => {
      const match = flags === 'wx' && path.basename(file).startsWith(target + '.');
      if (match && fault === 'open') throw Object.assign(Error('EACCES fixture'), { code: 'EACCES' });
      const handle = await fs.open(file, flags, ...args);
      if (!match) return handle;
      return new Proxy(handle, { get(object, property) {
        if (property === 'writeFile' && fault === 'partial_write') return async buffer => { await object.writeFile(buffer.subarray(0, 7)); throw Object.assign(Error('ENOSPC fixture'), { code: 'ENOSPC' }); };
        if (property === 'sync' && fault === 'sync') return async () => { throw Object.assign(Error('EIO fixture'), { code: 'EIO' }); };
        const value = object[property]; return typeof value === 'function' ? value.bind(object) : value;
      } });
    }, rename: async (source, destination) => {
      if (path.basename(destination) === target && fault === 'rename') throw Object.assign(Error('EBUSY fixture'), { code: 'EBUSY' });
      return fs.rename(source, destination);
    } };
    await assert.rejects(createConfigStore(f.directory, { io }).write({ ...expected, language: 'en' }), /fixture/);
    assert.equal(await bytes(f.file), original); assert.deepEqual(await parsed(f.backup), expected);
    if (target === 'applications.backup.json') assert.equal(await bytes(f.backup), saved);
    assert.deepEqual((await fs.readdir(f.directory)).filter(n => n.endsWith('.tmp')), []);
  });
}
for (const boundary of ['temporary_synced:applications.backup.json', 'replaced:applications.backup.json', 'backup_ready:profile', 'temporary_synced:applications.json', 'replaced:applications.json']) {
  test(`arrêt brutal réel ${boundary} : reprise et collecte des temporaires`, async t => {
    const f = await fixture(t), expected = migrateConfig(await validProfile()); await f.store.write(expected);
    const child = spawn(process.execPath, [path.join(__dirname, 'fixtures/profile-crash.cjs'), f.directory, boundary], { shell: false, windowsHide: true, stdio: 'pipe' });
    const [code] = await once(child, 'exit'); assert.equal(code, 86);
    assert.deepEqual(await parsed(f.backup), expected);
    validateConfig(JSON.parse(await bytes(f.file)));
    const report = await createTemporaryFiles(f.directory).collect(); assert.equal(report.failed, 0);
    assert.deepEqual((await fs.readdir(f.directory)).filter(n => n.endsWith('.tmp')), []);
    await f.store.recover({ ...await f.store.recoveryInfo(), confirmed: true, restoreBackup: true });
    assert.deepEqual(await f.store.read(), expected);
  });
}
test('première écriture interrompue : sauvegarde récupérable même sans fichier courant', async t => {
  const f = await fixture(t, { checkpoint: async stage => { if (stage === 'backup_ready') throw Error('power cut fixture'); } });
  const expected = migrateConfig(await validProfile());
  await assert.rejects(f.store.write(expected), /power cut/);
  assert.deepEqual(await parsed(f.backup), expected); await assert.rejects(fs.stat(f.file), { code: 'ENOENT' });
  const normal = createConfigStore(f.directory);
  await normal.recover({ ...await normal.recoveryInfo(), confirmed: true, restoreBackup: true });
  assert.deepEqual(await normal.read(), expected);
});
test('profil modifié pendant sauvegarde : conflit refusé sans écraser la nouvelle source', async t => {
  const f = await fixture(t); await f.store.write(DEFAULT_CONFIG);
  const replacement = JSON.stringify({ ...DEFAULT_CONFIG, language: 'de' });
  const store = createConfigStore(f.directory, { checkpoint: async stage => { if (stage === 'backup_ready') await fs.writeFile(f.file, replacement); } });
  await assert.rejects(store.write({ ...DEFAULT_CONFIG, language: 'en' }), /changé/);
  assert.equal(await bytes(f.file), replacement); assert.deepEqual(await parsed(f.backup), DEFAULT_CONFIG);
});
test('échec du retrait des permissions avant remplacement : profil et copie restent récupérables', async t => {
  const f = await fixture(t); await f.store.write(DEFAULT_CONFIG);
  const before = await bytes(f.file), content = JSON.stringify(await validProfile());
  const preview = await f.store.previewImport(content);
  await assert.rejects(f.store.importConfig({ ...preview, content, confirmed: true }, { beforeReplace: async () => {
    assert.equal(await bytes(f.file), before); assert.equal(await bytes(f.backup), before);
    throw Error('permission journal denied fixture');
  } }), /journal denied/);
  assert.equal(await bytes(f.file), before); assert.equal(await bytes(f.backup), before);
});
test('Windows natif : fichier ouvert sans partage de suppression refuse le remplacement puis restauration réelle', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t), expected = migrateConfig(await validProfile()); await f.store.write(expected);
  const script = `$h=[IO.File]::Open('${f.file.replaceAll("'", "''")}',[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read); [Console]::WriteLine('locked'); [Console]::ReadLine() | Out-Null; $h.Dispose()`;
  const child = spawn(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', script], { shell: false, windowsHide: true, stdio: 'pipe' });
  const lines = createInterface({ input: child.stdout });
  const iterator = lines[Symbol.asyncIterator]();
  try {
    const ready = await iterator.next(); assert.equal(ready.value, 'locked');
    await assert.rejects(f.store.write({ ...expected, language: 'en' }), error => ['EPERM', 'EACCES', 'EBUSY'].includes(error.code));
    assert.deepEqual(await f.store.read(), expected); assert.deepEqual(await parsed(f.backup), expected);
  } finally { const exited = once(child, 'exit'); child.stdin.end('\n'); await exited; lines.close(); }
  await f.store.write({ ...expected, language: 'en' });
  await fs.writeFile(f.file, '{partial');
  const restored = await f.store.recover({ ...await f.store.recoveryInfo(), confirmed: true, restoreBackup: true });
  assert.deepEqual(restored.config, expected); assert.equal(await bytes(restored.backupPath), '{partial');
});
test('sidecar : import/restauration retirent les anciennes propositions sans moteur ni effet', async t => {
  const f = await fixture(t); let effects = 0;
  const config = migrateConfig(await validProfile()); await f.store.write(config);
  const handle = createAssistant({ runtimeDirectory: f.directory, configDirectory: f.directory,
    launchApplication: async () => { effects++; }, runEngine: async () => { effects++; throw Error('no inference'); } });
  const proposal = await handle('prepare_action', { applicationId: config.applications[0].id, action: 'open' });
  const content = await handle('export_config'), preview = await handle('preview_import', { content });
  await handle('import_config', { ...preview, content, confirmed: true });
  assert.equal((await handle('confirm', { id: proposal.id })).proposal.state, 'invalidated');
  const next = await handle('prepare_action', { applicationId: config.applications[0].id, action: 'open' });
  await handle('recover_config', { ...(({fingerprint,backupFingerprint})=>({fingerprint,backupFingerprint}))(await f.store.recoveryInfo()), restoreBackup: true, confirmed: true });
  assert.equal((await handle('confirm', { id: next.id })).proposal.state, 'invalidated');
  assert.equal(effects, 0);
});
