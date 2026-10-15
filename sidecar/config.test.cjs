const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createAssistant } = require('./assistant.cjs');
const { validateConfig, MAX_CONFIG_BYTES, DEFAULT_CONFIG } = require('./config-schema.cjs');
const { readConfig, recoverConfig } = require('./config-store.cjs');

async function profile(name) { return JSON.parse(await fs.readFile(path.join(__dirname, 'fixtures', 'profiles', `${name}.json`), 'utf8')); }
async function fixture(t, bytes) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pam-config-test-'));
  t.after(async () => {
    assert.equal(path.dirname(directory), os.tmpdir()); assert.ok(path.basename(directory).startsWith('pam-config-test-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const file = path.join(directory, 'applications.json');
  if (bytes !== undefined) await fs.writeFile(file, bytes);
  let effects = 0;
  const handle = createAssistant({ runtimeDirectory: directory, configDirectory: directory,
    runEngine: async () => { effects++; throw Error('Inference must not run'); },
    launchApplication: async () => { effects++; throw Error('Launch must not run'); } });
  return { directory, file, handle, effects: () => effects };
}
test('fixtures valides et profil v1 sans formulations : validation sans disponibilité du fichier', async t => {
  const valid = await profile('valid');
  assert.deepEqual(validateConfig(valid), valid);
  const legacy = structuredClone(valid); delete legacy.commandAliases;
  assert.deepEqual(validateConfig(legacy).commandAliases, []);
  const f = await fixture(t, JSON.stringify(valid));
  assert.deepEqual(await readConfig(f.directory), { ...valid, version: 2 });
  const updated = await f.handle('save_application', { ...valid.applications[0], enabled: false });
  assert.equal(updated.applications[0].enabled, false);
  assert.equal((await f.handle('status')).configError, undefined);
});
test('types, limites, unicité et références : résultats déterministes', async () => {
  const valid = await profile('valid');
  const mutations = [
    [v => delete v.language, /Préférences/], [v => v.version = 3, /Version/],
    [v => v.applications = {}, /Applications/], [v => v.applications[0].enabled = 'yes', /État/],
    [v => v.applications[0].arguments = [null], /Arguments/], [v => v.applications[0].aliases = null, /Alias/],
    [v => v.applications[0].id = 'broken', /Identifiant/], [v => v.commandAliases = null, /Liste/],
    [v => v.applications.push(structuredClone(v.applications[0])), /doublon/],
    [v => v.applications[0].aliases.push('testpad'), /doublon/],
    [v => v.applications = Array(33).fill(v.applications[0]), /32 maximum/],
    [v => v.applications[0].arguments = Array(21).fill('a'), /Arguments/],
    [v => v.applications[0].media = { sourceAppId: 4, deezer: false }, /Identifiant/],
    [v => v.applications[0].windowsApp = [], /Application Windows/],
    [v => v.applications[0].windowsApp = null, /Application Windows/],
    [v => v.applications[0].media = null, /multimédia/],
    [v => v.applications[0].windowsApp = { appId: 'X', kind: 'store', icon: null }, /lancement/],
    [v => v.commandAliases = [{ id: '11111111-1111-4111-8111-111111111111', phrase: 'Mon éditeur', applicationId: 'unknown', action: 'open' }], /inconnue/],
    [v => v.commandAliases = [{ id: '11111111-1111-4111-8111-111111111111', phrase: 'Mon éditeur', applicationId: v.applications[0].id, action: 'media_pause' }], /capacité/],
    [v => v.unexpected = true, /champ inconnu/],
    [v => v.applications.push({ ...v.applications[0], id: '44444444-4444-4444-8444-444444444444' }), /doublon/],
    [v => v.applications[0].name = 'a'.repeat(61), /Nom/],
    [v => v.applications[0].arguments = ['a'.repeat(2049)], /Arguments/],
    [v => v.applications[0].arguments = ['a\0b'], /Arguments/],
    [v => v.commandAliases = Array(65).fill({}), /64 maximum/],
    [v => { const alias = { id: '11111111-1111-4111-8111-111111111111', phrase: 'mon éditeur', applicationId: v.applications[0].id, action: 'open' }; v.commandAliases = [alias, { ...alias, id: '22222222-2222-4222-8222-222222222222' }]; }, /doublon/],
  ];
  for (const [mutate, expected] of mutations) {
    const bad = structuredClone(valid); mutate(bad);
    for (let i = 0; i < 2; i++) assert.throws(() => validateConfig(bad), expected);
  }
});
test('les écritures utilisent les mêmes limites et préservent les références de formulations', async t => {
  const valid = await profile('valid'), app = valid.applications[0];
  valid.applications[0].media = { sourceAppId: 'editor.exe', deezer: false };
  valid.commandAliases = [{ id: '11111111-1111-4111-8111-111111111111', phrase: 'Pause mon éditeur', applicationId: app.id, action: 'media_pause' }];
  const bytes = JSON.stringify(valid), f = await fixture(t, bytes);
  await assert.rejects(f.handle('save_application', { ...valid.applications[0], arguments: Array(21).fill('a') }), /Arguments/);
  await assert.rejects(f.handle('save_application', { ...valid.applications[0], media: undefined }), /capacité/);
  assert.equal(await fs.readFile(f.file, 'utf8'), bytes);
  await f.handle('delete_application', { id: app.id });
  const deleted = await readConfig(f.directory);
  assert.deepEqual(deleted.applications, []); assert.deepEqual(deleted.commandAliases, []);
});
test('fiche minimale refusée avant normalize, rendu, moteur, lancement et toutes écritures', async t => {
  const bytes = JSON.stringify(await profile('broken'));
  const f = await fixture(t, bytes);
  const status = await f.handle('status');
  assert.equal(status.ready, false); assert.deepEqual(status.config.applications, []);
  assert.match(status.configError.message, /applications\[0\]/);
  assert.doesNotMatch(status.configError.message, /normalize/);
  for (const method of ['process_text', 'settings', 'save_application', 'delete_application', 'save_command_alias', 'confirm']) {
    await assert.rejects(f.handle(method, { text: 'Ouvre broken' }), error=>error.diagnostic?.code===(method==='process_text'?'invalid_profile':'invalid_request'));
    assert.equal(await fs.readFile(f.file, 'utf8'), bytes);
  }
  assert.equal(f.effects(), 0);
});
test('JSON, version future, taille et erreurs de lecture ne réécrivent aucun fichier', async t => {
  const valid = await profile('valid');
  for (const bytes of ['{broken', JSON.stringify({ ...valid, version: 999 }), ' '.repeat(MAX_CONFIG_BYTES + 1), Buffer.from([0xff])]) {
    const f = await fixture(t, bytes);
    const first = await f.handle('status'), second = await f.handle('status');
    assert.deepEqual(first.configError, second.configError);
    await assert.rejects(f.handle('settings', { language: 'en', autoExecute: false, confidenceThreshold: 0.9 }), /Profil invalide/);
    assert.deepEqual(await fs.readFile(f.file), Buffer.from(bytes));
  }
  const f = await fixture(t); await fs.mkdir(f.file);
  assert.equal((await f.handle('status')).configError.recoverable, false);
});
test('récupération confirmée conserve les octets originaux ; refus, changement et copie échouée ne remplacent rien', async t => {
  const bytes = JSON.stringify(await profile('broken'));
  const f = await fixture(t, bytes);
  const status = await f.handle('status'), fingerprint = status.configError.fingerprint;
  await assert.rejects(f.handle('recover_config', { fingerprint }), error=>error.diagnostic?.code==='invalid_request');
  assert.equal(await fs.readFile(f.file, 'utf8'), bytes);
  await fs.appendFile(f.file, ' ');
  await assert.rejects(f.handle('recover_config', { confirmed: true, fingerprint }), /changé/);
  const current = await f.handle('status');
  const copy = fs.copyFile;
  fs.copyFile = async () => { throw new Error('backup denied'); };
  try { await assert.rejects(f.handle('recover_config', { confirmed: true, fingerprint: current.configError.fingerprint }), /backup denied/); }
  finally { fs.copyFile = copy; }
  assert.equal(await fs.readFile(f.file, 'utf8'), bytes + ' ');
  const rename = fs.rename;
  fs.rename = async () => { throw new Error('replacement denied'); };
  try { await assert.rejects(f.handle('recover_config', { confirmed: true, fingerprint: current.configError.fingerprint }), /replacement denied/); }
  finally { fs.rename = rename; }
  assert.equal(await fs.readFile(f.file, 'utf8'), bytes + ' ');
  const result = await f.handle('recover_config', { confirmed: true, fingerprint: current.configError.fingerprint });
  assert.equal(await fs.readFile(result.backupPath, 'utf8'), bytes + ' ');
  assert.deepEqual(await readConfig(f.directory), DEFAULT_CONFIG);
  assert.equal((await f.handle('status')).configError, undefined);
  await assert.rejects(f.handle('recover_config', { confirmed: true, fingerprint: current.configError.fingerprint }), /changé/);
  assert.equal(f.effects(), 0);
});
test('un profil absent est créé uniquement lors d’une écriture explicite', async t => {
  const f = await fixture(t);
  assert.deepEqual(await readConfig(f.directory), DEFAULT_CONFIG);
  await assert.rejects(fs.stat(f.file), { code: 'ENOENT' });
  await f.handle('settings', { language: 'fr', autoExecute: false, confidenceThreshold: 0.6 });
  assert.equal((await readConfig(f.directory)).autoExecute, false);
});
