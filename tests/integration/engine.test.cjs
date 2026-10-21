const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { createEngine } = require('../../sidecar/engine.cjs');
const { createAssistant, DEFAULT_CONFIG } = require('../../sidecar/assistant.cjs');
assert.equal(process.platform, 'win32', 'Real engines require Windows');

test('la bibliothèque Windows conserve ses modèles et transporte les demandes Unicode', { timeout: 120_000 }, async t => {
  const runtime = path.resolve(__dirname, '../../src-tauri/runtime');
  const engine = createEngine(runtime); t.after(() => engine.close());
  await engine.warm(); const first = engine.status();
  await engine.warm(); assert.deepEqual(engine.status(), first);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pam-engine-test-'));
  t.after(async () => {
    assert.equal(path.dirname(directory), os.tmpdir());
    await fs.rm(directory, { recursive: true, force: true });
  });
  await fs.writeFile(path.join(directory, 'applications.json'), JSON.stringify({ ...DEFAULT_CONFIG, autoExecute: false, applications: [{
    id: '4cd496e0-d621-4f7c-b2c1-4b1bb17f03c9', name: 'Bloc-notes', description: 'Ouvrir le Bloc-notes avec le texte demandé.',
    executable: process.execPath, arguments: ['{input}'], aliases: ['Notepad'], enabled: true,
  }] }));
  const handle = createAssistant({ runtimeDirectory: runtime, configDirectory: directory, runEngine: engine.runEngine, engine });
  const unicode = await handle('process_text', { text: 'Ouvre Bloc-notes avec le texte "été à Paris"' });
  assert.equal(unicode.status, 'pending'); assert.equal(unicode.calls[0].arguments.input, 'été à Paris');
  assert.deepEqual(engine.status(), first);
  const following = await handle('process_text', { text: 'Notepad' });
  assert.equal(following.calls[0].arguments.input, ''); // No text leaks from the preceding session.
  assert.deepEqual(engine.status(), first);
  await engine.close(); await engine.warm();
  assert.equal(engine.status().generation, 2); assert.equal(engine.status().pid, first.pid);
});
