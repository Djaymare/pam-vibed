const path = require('node:path');
const fs = require('node:fs/promises');
const { Worker } = require('node:worker_threads');

function createEngine(runtimeDirectory, { workerFactory = data => new Worker(path.join(__dirname, 'engine-worker.cjs'), { workerData: data }) } = {}) {
  let worker;
  let serial = 0;
  let generation = 0;
  let loaded = false;
  const pending = new Map();
  function start() {
    const current = workerFactory({ runtimeDirectory });
    worker = current; generation++; loaded = false;
    current.on('message', reply => {
      const request = pending.get(reply.id);
      if (!request) return;
      clearTimeout(request.timer); pending.delete(reply.id);
      if (reply.ok) { loaded = true; request.resolve(reply.result); }
      else request.reject(new Error(reply.error));
    });
    function failed(error) {
      if (worker !== current) return;
      worker = undefined; loaded = false;
      for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); }
      pending.clear();
      void current.terminate();
    }
    current.on('error', failed);
    current.on('exit', code => failed(new Error(`Le moteur local s’est arrêté (code ${code}).`)));
  }
  async function send(operation, payload, timeout) {
    if (!worker) start();
    const id = ++serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // A hung native call cannot be interrupted safely inside its thread.
        // Rust restarts the sidecar; no application launch has taken place yet.
        process.exit(70);
      }, timeout);
      pending.set(id, { resolve, reject, timer });
      worker.postMessage({ id, operation, payload });
    });
  }
  const runEngine = async (_file, args, { timeout }) => {
    const value = flag => args[args.indexOf(flag) + 1];
    const started = Date.now();
    const operation = args.includes('--tools') ? 'complete' : 'transcribe';
    const payload = operation === 'complete'
      ? { text: value('--prompt'), tools: JSON.parse(await fs.readFile(value('--tools'), 'utf8')), system: await fs.readFile(value('--system'), 'utf8') }
      : { audioPath: value('--audio'), language: args.includes('--audio-language') ? value('--audio-language') : null,
        keywords: await fs.readFile(value('--audio-keywords'), 'utf8') };
    try { return { stdout: JSON.stringify(await send(operation, payload, timeout)) }; }
    catch (error) {
      if (worker || Date.now() - started >= timeout) throw error;
      return { stdout: JSON.stringify(await send(operation, payload, timeout - (Date.now() - started))) };
    }
  };
  runEngine.unicode = true;
  return {
    runEngine,
    warm: () => send('warm', {}, 40_000),
    status: () => ({ loaded, generation, pid: process.pid }),
    async close() {
      const current = worker; worker = undefined; loaded = false;
      for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Moteur arrêté.')); }
      pending.clear();
      if (current) await current.terminate();
    },
  };
}
module.exports = { createEngine };
