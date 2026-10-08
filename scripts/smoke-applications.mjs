// Windows integration check: a temporary Start Menu shortcut launches only a
// Node marker fixture. User applications and PAM's personal profile are untouched.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
assert.equal(process.platform, 'win32', 'Ce test utilise le catalogue Windows réel.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const run = promisify(execFile);
const require = createRequire(import.meta.url);
const { createAssistant } = require('../sidecar/assistant.cjs');
const helper = resolve(process.argv[2] || join(root, 'src-tauri/target/x86_64-pc-windows-msvc/release/examples/discovery.exe'));
await stat(helper);
const temporary = await mkdtemp(join(tmpdir(), 'pam-discovery-'));
const name = `PAM Discovery Fixture ${randomUUID()}`;
const programs = join(process.env.APPDATA, 'Microsoft/Windows/Start Menu/Programs');
const shortcut = join(programs, `${name}.lnk`);
const marker = join(temporary, 'launched.txt');
const fixture = join(temporary, 'launch.cjs');
const node = join(root, 'src-tauri/binaries/pam-node-x86_64-pc-windows-msvc.exe');
const psString = value => `'${value.replaceAll("'", "''")}'`;
let createdShortcut = false;
try {
  await writeFile(fixture, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'launched');`);
  // PowerShell is used only to create the development fixture, not by PAM.
  await run(join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command',
    `$link = (New-Object -ComObject WScript.Shell).CreateShortcut(${psString(shortcut)}); $link.TargetPath = ${psString(node)}; $link.Arguments = ${psString(`"${fixture}"`)}; $link.WorkingDirectory = ${psString(temporary)}; $link.Save();`]);
  createdShortcut = true;
  let applications;
  let app;
  for (let attempt = 0; attempt < 15; attempt++) {
    const { stdout } = await run(helper, [], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 20_000 });
    applications = JSON.parse(stdout);
    app = applications.find(app => app.name === name);
    if (app) break;
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  assert.ok(app, 'Le raccourci du menu Démarrer doit être découvert.');
  assert.equal(new Set(applications.map(app => app.appId.toLowerCase())).size, applications.length);
  for (const entry of applications) {
    assert.ok(['desktop', 'store'].includes(entry.kind));
    if (!entry.icon) continue;
    assert.ok(entry.icon.startsWith('data:image/png;base64,'));
    assert.ok(entry.icon.length <= 32768);
    const bytes = Buffer.from(entry.icon.split(',')[1], 'base64');
    assert.equal(bytes.toString('ascii', 12, 16), 'IHDR');
    assert.ok(bytes.readUInt32BE(16) <= 64 && bytes.readUInt32BE(20) <= 64);
  }
  console.log(`Catalogue natif : ${applications.length} applications, ${applications.filter(app => app.kind === 'store').length} du Store, ${applications.filter(app => app.icon).length} icônes. Cibles vérifiées par le helper.`);
  const handle = createAssistant({ configDirectory: temporary, runtimeDirectory: join(root, 'src-tauri/runtime') });
  const draft = { name, description: 'Lancer le programme de test.', executable: join(process.env.SystemRoot, 'explorer.exe'),
    arguments: [app.launchArgument], aliases: [], enabled: true,
    windowsApp: { appId: app.appId, kind: app.kind, icon: app.icon, launchArgument: app.launchArgument } };
  const result = await handle('test_application', draft);
  assert.equal(result.success, true, result.message);
  let launched = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { launched = (await readFile(marker, 'utf8')) === 'launched'; if (launched) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(launched, 'AppsFolder doit conserver les arguments du raccourci et lancer le programme de test.');
  console.log('Lancement réel via Windows : arguments du raccourci conservés, marqueur créé.');
  await assert.rejects(stat(join(temporary, 'applications.json')), /ENOENT/);
  console.log('Test du brouillon : aucun enregistrement ni modèle chargé.');
} finally {
  if (createdShortcut) {
    assert.equal(dirname(resolve(shortcut)), resolve(programs));
    assert.ok(shortcut.endsWith(`${name}.lnk`));
    await unlink(shortcut);
  }
  assert.equal(dirname(resolve(temporary)), resolve(tmpdir()));
  assert.ok(temporary.startsWith(join(tmpdir(), 'pam-discovery-')));
  await rm(temporary, { recursive: true, force: true });
}
