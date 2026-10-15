const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createAssistant } = require('./assistant.cjs');

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pam-availability-'));
  t.after(async () => {
    assert.equal(path.dirname(directory), os.tmpdir());
    assert.ok(path.basename(directory).startsWith('pam-availability-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const executable = path.join(directory, 'fixture.exe');
  await fs.copyFile(process.execPath, executable);
  const handle = createAssistant({ runtimeDirectory: directory, configDirectory: directory,
    runEngine: async () => { throw Error('Inference is not needed by this test'); } });
  const app = (await handle('save_application', { name:'Fixture', description:'Exécutable jetable', executable,
    arguments:['--version'], aliases:['Mon test'], enabled:true })).applications[0];
  await handle('save_command_alias', { phrase:'Lance mon test', applicationId:app.id, action:'open' });
  return { handle, app, executable, directory, read:async () => JSON.parse(await fs.readFile(path.join(directory,'applications.json'),'utf8')) };
}

test('exécutable supprimé : désactivation dédiée sans stat, identifiant/arguments/formulations conservés', async t => {
  const f = await fixture(t), before = await f.read();
  await fs.unlink(f.executable);
  assert.equal((await f.handle('status')).applicationAvailability[f.app.id].available, false);
  const stat = t.mock.method(fs, 'stat', async () => { throw Error('No stat during disable'); });
  const disabled = await f.handle('set_application_enabled', { id:f.app.id, enabled:false, arguments:[], aliases:[] });
  assert.equal(stat.mock.callCount(), 0);
  assert.deepEqual(disabled.applications[0], { ...f.app, enabled:false });
  assert.deepEqual(disabled.commandAliases, before.commandAliases);
  const saved = await f.handle('save_application', { ...f.app, enabled:false });
  assert.equal(stat.mock.callCount(), 0);
  assert.deepEqual(saved, disabled);
});

test('réactivation refusée avant réparation ; réparation conserve les formulations et réactive', async t => {
  const f = await fixture(t), aliases = (await f.read()).commandAliases;
  await fs.unlink(f.executable);
  await f.handle('set_application_enabled', { id:f.app.id, enabled:false });
  await assert.rejects(f.handle('set_application_enabled', { id:f.app.id, enabled:true }), /indisponible/);
  await assert.rejects(f.handle('save_application', { ...f.app, enabled:true }), /indisponible/);
  assert.equal((await f.read()).applications[0].enabled, false);
  const repairedPath = path.join(f.directory,'repaired.exe');
  await fs.copyFile(process.execPath, repairedPath);
  const repaired = await f.handle('save_application', { ...f.app, executable:repairedPath, enabled:false });
  assert.deepEqual(repaired.commandAliases, aliases);
  const enabled = await f.handle('set_application_enabled', { id:f.app.id, enabled:true });
  assert.deepEqual(enabled.applications[0], { ...f.app, executable:repairedPath });
  assert.deepEqual(enabled.commandAliases, aliases);
  assert.equal((await f.handle('status')).applicationAvailability[f.app.id].available, true);
});

test('contournement UI : test et confirmation refusent la cible supprimée avant tout spawn', async t => {
  const f = await fixture(t);
  const turn = await f.handle('prepare_action', { applicationId:f.app.id, action:'open', arguments:{} });
  await fs.unlink(f.executable);
  await assert.rejects(f.handle('test_application', f.app), /indisponible/);
  const confirmed = await f.handle('confirm', { id:turn.id });
  assert.equal(confirmed.results[0].success, false);
  assert.equal(confirmed.results[0].error.code, 'target_missing');
  assert.match(confirmed.results[0].message, /Réparez ou désactivez/);
  assert.doesNotMatch(confirmed.results[0].message, /ENOENT|[A-Z]:\\/);
  assert.equal(confirmed.status, 'failed');
  assert.equal((await f.handle('confirm', { id:turn.id })).status, 'consumed');
  assert.equal((await f.read()).applications[0].enabled, true);
});

test('état ciblé : ID inconnu et enabled non booléen refusés, profil inchangé', async t => {
  const f = await fixture(t), before = await f.read();
  await assert.rejects(f.handle('set_application_enabled', { id:'missing', enabled:false }), /introuvable/);
  await assert.rejects(f.handle('set_application_enabled', { id:f.app.id, enabled:'false' }), /invalide/);
  assert.deepEqual(await f.read(), before);
});

test('le lanceur Node sans hôte refuse une cible Windows même si explorer.exe existe', async t => {
  const f = await fixture(t);
  const explorer = path.join(f.directory,'explorer.exe'); await fs.copyFile(process.execPath,explorer);
  const appId = 'PAM.MissingFixture!App';
  const missing = {...f.app,executable:explorer,arguments:[`shell:AppsFolder\\${appId}`],windowsApp:{appId,kind:'store',icon:null}};
  const result = await f.handle('test_application',missing);
  assert.equal(result.success,false); assert.equal(result.error.code,'transport_unavailable');
  assert.match(result.message,/Rechargez les moteurs/);
  assert.deepEqual((await f.read()).applications[0],f.app);
});
