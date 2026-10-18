const fs = require('node:fs');
const path = require('node:path');
const { parentPort, workerData } = require('node:worker_threads');
const { contextBudget, capacityError, requireCapacity, requireToolLimit } = require('./assistant/context-capacity.cjs');
const koffi = require(path.join(workerData.runtimeDirectory, 'ffi/node_modules/koffi'));
const lib = koffi.load(path.join(workerData.runtimeDirectory, 'libneedle3.dll'));
const load = lib.func('int needle_load(const unsigned char *cact, uint64_t n)');
const models = lib.func('int needle_models()');
const lastError = lib.func('const char *needle_last_error()');
const init = lib.func('int needle_init(const char *system, const char *tools, const char *index)');
const reset = lib.func('void needle_reset()');
const complete = lib.func('int needle_complete(const char *input, const float *pcm, int samples, int max, void *out, int capacity)');
const transcribe = lib.func('int needle_transcribe(const float *pcm, int samples, const char *language, const char *keywords, int timestamps, void *out, int capacity)');
let loaded = false;
// Keep the supplied .cact storage alive for the entire native model lifetime.
const modelBytes = [];
function check(code) { if (code < 0) throw new Error(lastError() || `Erreur native Cactus (${code}).`); return code; }
function warm() {
  if (!loaded) {
    for (const file of ['needle3.cact', 'whistle.cact']) {
      const bytes = fs.readFileSync(path.join(workerData.runtimeDirectory, 'models', file));
      check(load(bytes, bytes.length));
      modelBytes.push(bytes);
    }
    if (models() !== 3) throw new Error('Les deux modèles Cactus ne sont pas chargés.');
    loaded = true;
  }
  return { loaded, models: ['Needle 3', 'Whistle'] };
}
parentPort.on('message', ({ id, operation, payload }) => {
  try {
    warm();
    let result;
    if (operation === 'warm') result = warm();
    else {
      const output = Buffer.alloc(1024 * 1024);
      if (operation === 'transcribe') {
        const wav = fs.readFileSync(payload.audioPath);
        const pcm = new Float32Array((wav.length - 44) / 2);
        for (let i = 0; i < pcm.length; i++) pcm[i] = wav.readInt16LE(44 + i * 2) / 32768;
        check(transcribe(pcm, pcm.length, payload.language || null, payload.keywords || null, 0, output, output.length));
      } else if (operation === 'complete' || operation === 'capacity') {
        if (operation === 'complete') requireToolLimit(payload.tools);
        // Refresh the session and tools without reloading the model weights.
        reset();
        const prefix = init(payload.system, JSON.stringify(payload.tools), null);
        if (prefix < 0 && /context|prefix.*(?:long|large|limit|exceed)|token.*(?:limit|exceed|overflow)/i.test(lastError() || '')) {
          throw capacityError(contextBudget(8192, payload.text, payload.tools), true);
        }
        check(prefix);
        const capacity = contextBudget(prefix, payload.text, payload.tools);
        if (operation === 'capacity') {
          parentPort.postMessage({ id, ok: true, result: capacity });
          return;
        }
        requireCapacity(capacity);
        check(complete(payload.text, null, 0, 256, output, output.length));
      } else throw new Error('Opération native inconnue.');
      const end = output.indexOf(0);
      if (end < 0) throw new Error('Réponse native trop volumineuse.');
      result = JSON.parse(output.toString('utf8', 0, end));
    }
    parentPort.postMessage({ id, ok: true, result });
  } catch (error) { parentPort.postMessage({ id, ok: false, error: error.message,
    ...(['catalog_capacity','request_capacity'].includes(error.code) ? {code:error.code} : {}) }); }
});
