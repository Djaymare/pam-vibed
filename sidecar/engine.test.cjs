const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createEngine } = require('./engine.cjs');

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
