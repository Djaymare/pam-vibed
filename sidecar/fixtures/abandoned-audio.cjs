const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createAssistant } = require('../assistant.cjs');
const { createEngine } = require('../engine.cjs');
const [directory, mode] = process.argv.slice(2);
if (mode === 'atomic-exit') {
  // The real writer has completed its .tmp but cannot reach rename/finally.
  const promises = require('node:fs/promises');
  promises.rename = async () => process.exit(70);
  require('../temporary-files.cjs').atomicJson(path.join(directory, 'applications.json'), { partial: true });
  return;
}
const engine = createEngine(directory, { workerFactory: () => {
  const worker = new EventEmitter();
  worker.postMessage = () => {}; // Simulate a native inference that never returns.
  worker.terminate = async () => {};
  return worker;
} });
const runEngine = (file, args, options) => {
  if (!args.includes('--audio')) throw Error('Expected speech inference');
  fs.statSync(args[args.indexOf('--audio') + 1]);
  fs.statSync(args[args.indexOf('--audio-keywords') + 1]);
  if (mode === 'exit') process.exit(70);
  if (mode === 'timeout') return engine.runEngine(file, args, { ...options, timeout: 100 });
  process.send({ ready: true });
  return new Promise(() => { setInterval(() => {}, 1000); });
};
const audio = Buffer.alloc(44 + 32000);
audio.write('RIFF'); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVE', 8); audio.write('fmt ', 12);
audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(16000, 24); audio.writeUInt32LE(32000, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34);
audio.write('data', 36); audio.writeUInt32LE(audio.length - 44, 40);
const handle = createAssistant({ configDirectory: directory, runtimeDirectory: directory, runEngine });
handle('process_audio', { audio: Array.from(audio) }).catch(error => { console.error(error.message); process.exit(1); });
