const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createAssistant, DEFAULT_CONFIG, toolName } = require('./assistant.cjs');

const draft = () => ({ name: 'Deezer', description: 'Écouter de la musique.', executable: 'C:\\Windows\\explorer.exe',
  arguments: ['shell:AppsFolder\\Deezer.Package_family!Music'], aliases: ['Diseur'], enabled: true,
  windowsApp: { appId: 'Deezer.Package_family!Music', kind: 'store', icon: null } });
async function fixture(t, failing = false) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pam-applications-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('pam-applications-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  await fs.writeFile(path.join(directory, 'applications.json'), JSON.stringify(DEFAULT_CONFIG));
  const stat = fs.stat;
  t.mock.method(fs, 'stat', async (file, ...args) => file === draft().executable || file === 'C:\\Portable\\Editor.exe' ? { isFile: () => true } : stat(file, ...args));
  const launched = [];
  const handle = createAssistant({ runtimeDirectory: directory, configDirectory: directory,
    runEngine: async () => { throw new Error('Le test de lancement ne doit pas charger le modèle.'); },
    launchApplication: async (app, args) => {
      launched.push({ app, args });
      if (failing) throw new Error('L’exécutable a disparu.');
      return { applicationName: app.name, success: true, message: 'Lancé' };
    } });
  return { handle, directory, launched, config: async () => JSON.parse(await fs.readFile(path.join(directory, 'applications.json'), 'utf8')) };
}

test('Store : les métadonnées persistent après ajout, relecture et désactivation', async t => {
  const f = await fixture(t);
  let config = await f.handle('save_application', draft());
  const app = config.applications[0];
  assert.deepEqual(app.windowsApp, draft().windowsApp);
  assert.deepEqual((await f.config()).applications[0], app);
  config = await f.handle('save_application', { ...app, enabled: false });
  assert.equal(config.applications[0].enabled, false);
  assert.deepEqual(config.applications[0].windowsApp, app.windowsApp);
  await assert.rejects(f.handle('save_application', { ...draft(), name: 'Autre nom' }), /déjà ajoutée/);
  assert.equal(f.launched.length, 0);
});

test('les anciens exécutables manuels restent compatibles et sans métadonnées Windows', async t => {
  const f = await fixture(t);
  const manual = { ...draft(), executable: 'C:\\Portable\\Editor.exe', arguments: [], windowsApp: undefined };
  const config = await f.handle('save_application', manual);
  assert.equal(config.applications[0].executable, manual.executable);
  assert.equal('windowsApp' in config.applications[0], false);
  assert.ok(toolName(config.applications[0]).startsWith('open_deezer_'));
});

test('test explicite du brouillon : lance la cible exacte sans enregistrer ni appeler Needle', async t => {
  const f = await fixture(t);
  const result = await f.handle('test_application', { ...draft(), description: '' });
  assert.equal(result.success, true);
  assert.match(result.message, /Vérifiez/);
  assert.equal(f.launched.length, 1);
  assert.equal(f.launched[0].app.executable, draft().executable);
  assert.deepEqual(f.launched[0].app.arguments, draft().arguments);
  assert.deepEqual((await f.config()).applications, []);
  await assert.rejects(fs.stat(path.join(f.directory, 'pending')), /ENOENT/);
});

test('test avec {input} : exige une entrée explicite, transmise comme un seul argument', async t => {
  const f = await fixture(t);
  const manual = { ...draft(), executable: 'C:\\Portable\\Editor.exe', arguments: ['--new-window', '{input}'], windowsApp: undefined };
  await assert.rejects(f.handle('test_application', manual), /Renseignez/);
  const input = 'C:\\Un projet\\& $(autre)';
  await f.handle('test_application', { ...manual, input });
  assert.deepEqual(f.launched[0].args, { input });
  await assert.rejects(f.handle('test_application', { ...manual, input: 'x\0y' }), /invalide/);
  assert.equal(f.launched.length, 1);
});

test('une cible Windows incohérente ou une icône active est refusée avant le lancement', async t => {
  const f = await fixture(t);
  for (const invalid of [
    { ...draft(), arguments: ['shell:AppsFolder\\Other!App'] },
    { ...draft(), arguments: [...draft().arguments, '{input}'] },
    { ...draft(), executable: 'C:\\Portable\\Editor.exe' },
    { ...draft(), windowsApp: { ...draft().windowsApp, appId: '{input}' } },
    { ...draft(), windowsApp: { ...draft().windowsApp, icon: 'data:image/svg+xml,<svg onload="evil()"/>' } },
    { ...draft(), windowsApp: { ...draft().windowsApp, icon: 'data:image/png;base64,YmFk' } },
    { ...draft(), executable: '..\\explorer.exe' },
  ]) await assert.rejects(f.handle('test_application', invalid));
  assert.equal(f.launched.length, 0);
});

test('un échec du test est affichable et ne modifie pas la configuration', async t => {
  const f = await fixture(t, true);
  const result = await f.handle('test_application', draft());
  assert.equal(result.success, false);
  assert.equal(result.error.code, 'target_missing');
  assert.match(result.message, /Réparez ou désactivez/);
  assert.deepEqual((await f.config()).applications, []);
});

test('les identifiants Windows avec GUID et les nouveaux raccourcis sont des cibles littérales', async t => {
  const f = await fixture(t);
  const appId = 'Microsoft.AutoGenerated.{12345678-1234-1234-1234-123456789ABC}';
  await f.handle('test_application', { ...draft(), arguments: [`shell:AppsFolder\\${appId}`], windowsApp: { appId, kind: 'desktop', icon: null } });
  const link = 'C:\\Users\\Test\\Start Menu\\Mon éditeur.lnk';
  const windowsApp = { appId: `shortcut:${link}`, kind: 'desktop', icon: null, launchArgument: link };
  const config = await f.handle('save_application', { ...draft(), arguments: [link], windowsApp });
  assert.deepEqual(config.applications[0].windowsApp, windowsApp);
  await f.handle('test_application', { ...draft(), arguments: [link], windowsApp });
  assert.deepEqual(f.launched[1].app.arguments, [link]);
  await assert.rejects(f.handle('test_application', { ...draft(), arguments: [link], windowsApp: { ...windowsApp, launchArgument: 'C:\\Other\\Other.lnk' } }), /invalide/);
  await assert.rejects(f.handle('test_application', { ...draft(), arguments: [link], windowsApp: { ...windowsApp, kind: 'store' } }), /invalide/);
  assert.equal(f.launched.length, 2);
});
