const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { createEngine } = require('./engine.cjs');
const { createAssistant, DEFAULT_CONFIG } = require('./assistant.cjs');

test('une panne du worker laisse le moteur disponible pour une reprise', async t => {
  let workers = 0;
  const engine = createEngine('.', { workerFactory: () => {
    const worker = new EventEmitter(); const index = ++workers;
    worker.terminate = async () => 0;
    worker.postMessage = request => queueMicrotask(() => {
      if (index === 1) worker.emit('error', new Error('Crash du worker'));
      else worker.emit('message', { id: request.id, ok: true, result: { loaded: true } });
    });
    return worker;
  } });
  t.after(() => engine.close());
  await assert.rejects(engine.warm(), /Crash/);
  assert.equal(engine.status().loaded, false);
  await engine.warm();
  assert.equal(engine.status().generation, 2); assert.equal(engine.status().loaded, true);
});

test('un rechargement explicite recrée le worker puis le réutilise', async t => {
  let workers = 0;
  const engine = createEngine('.', { workerFactory: () => {
    workers++;
    const worker = new EventEmitter(); worker.terminate = async () => 0;
    worker.postMessage = request => queueMicrotask(() => worker.emit('message', { id: request.id, ok: true, result: { loaded: true } }));
    return worker;
  } });
  t.after(() => engine.close());
  await engine.warm(); await engine.warm(); assert.equal(workers, 1);
  await engine.close(); await engine.warm(); assert.equal(workers, 2);
  assert.equal(engine.status().loaded, true);
});

test('la bibliothèque Windows conserve ses modèles et transporte les demandes Unicode', { skip: process.platform !== 'win32' }, async t => {
  const runtime = path.resolve(__dirname, '../src-tauri/runtime');
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
