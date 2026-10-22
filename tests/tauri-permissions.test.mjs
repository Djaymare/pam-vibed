import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [build, library, capability, config] = await Promise.all([
  read('src-tauri/build.rs'),
  read('src-tauri/src/lib.rs'),
  read('src-tauri/capabilities/default.json').then(JSON.parse),
  read('src-tauri/tauri.conf.json').then(JSON.parse),
]);

function validate(buildSource, handlerSource, grant, configuration) {
  const manifest = buildSource.match(/AppManifest::new\(\)\.commands\(&\[([^\]]+)\]\)/);
  assert.ok(manifest, 'Application commands must use an explicit Tauri AppManifest');
  const declared = [...manifest[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  const handlers = [...handlerSource.matchAll(/tauri::generate_handler!\[([^\]]+)\]/g)];
  assert.equal(handlers.length, 1, 'Keep one reviewed production command registration');
  const registered = handlers[0][1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  assert.deepEqual(
    registered.sort(),
    declared.sort(),
    'Every new command needs an explicit permission review',
  );
  assert.deepEqual(declared, ['assistant_request']);
  assert.deepEqual(configuration.app.security.capabilities, ['default']);
  assert.deepEqual(grant.windows, []);
  assert.deepEqual(grant.webviews, ['main']);
  assert.equal(grant.local, true);
  assert.equal(grant.remote, undefined);
  assert.deepEqual(
    [...grant.permissions].sort(),
    [
      'allow-assistant-request',
      'core:event:allow-listen',
      'core:event:allow-unlisten',
      'dialog:allow-open',
    ].sort(),
  );
  assert.match(configuration.app.security.csp, /default-src 'self'; script-src 'self'/);
  assert.match(handlerSource, /host::authorize_window\(window.label\(\)\)\?;/);
}

test('production IPC is declared and limited to the local main webview', () => {
  validate(build, library, capability, config);
});

test('new unreviewed commands and broader window/origin/plugin grants fail the policy gate', () => {
  const validBuild = 'AppManifest::new().commands(&["assistant_request"])';
  const validLibrary =
    'tauri::generate_handler![assistant_request,]; host::authorize_window(window.label())?;';
  const validGrant = {
    windows: [],
    webviews: ['main'],
    local: true,
    permissions: [
      'allow-assistant-request',
      'core:event:allow-listen',
      'core:event:allow-unlisten',
      'dialog:allow-open',
    ],
  };
  const validConfig = {
    app: { security: { capabilities: ['default'], csp: "default-src 'self'; script-src 'self'" } },
  };
  validate(validBuild, validLibrary, validGrant, validConfig);
  assert.throws(
    () =>
      validate(
        validBuild,
        validLibrary.replace('assistant_request,', 'assistant_request, dangerous_command,'),
        validGrant,
        validConfig,
      ),
    /permission review/,
  );
  for (const change of [
    { windows: ['*'] },
    { windows: ['main'] },
    { webviews: ['*'] },
    { remote: { urls: ['https://*'] } },
    { permissions: [...validGrant.permissions, 'core:default'] },
    { permissions: [...validGrant.permissions, 'global-shortcut:allow-register'] },
  ])
    assert.throws(() =>
      validate(validBuild, validLibrary, { ...validGrant, ...change }, validConfig),
    );
});
