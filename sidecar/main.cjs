const { createAssistant } = require('./assistant.cjs');
const { createHostChannel, hostLauncher, hostNativeRequest } = require('./host.cjs');
const { createMedia } = require('./media.cjs');
const { nativeRequest } = require('./native.cjs');

const { createEngine } = require('./engine.cjs');
const [runtimeDirectory, configDirectory] = process.argv.slice(2);
const engine = createEngine(runtimeDirectory);
const host = createHostChannel(line => process.stdout.write(line));
const useHost = process.env.PAM_LAUNCH_HOST === '1';
const handle = createAssistant({ runtimeDirectory, configDirectory, runEngine: engine.runEngine, engine,
  ...(useHost ? { launchApplication: hostLauncher(host.request),
    media: createMedia(hostNativeRequest(host.request, nativeRequest)) } : {}) });
let buffer = '';
let queue = Promise.resolve();
function enqueue(input) {
  queue = queue.then(async () => {
    let request;
    const timer = setTimeout(() => process.exit(70), 45_000);
    try {
      if (!runtimeDirectory || !configDirectory) throw new Error('Chemins du sidecar manquants.');
      request = JSON.parse(input);
      const result = await handle(request.method, request.payload);
      process.stdout.write(JSON.stringify({ id: request.id, ok: true, result }) + '\n');
    } catch (error) {
      process.stdout.write(JSON.stringify({ id: request?.id, ok: false, error: error.message }) + '\n');
    } finally { clearTimeout(timer); }
  });
}
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  if (buffer.length > 5_000_000) process.exit(65);
  let newline;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
    if (line.trim()) {
      let response;
      try { response = JSON.parse(line); } catch {}
      if (!host.receive(response)) enqueue(line);
    }
  }
});
process.stdin.on('end', () => {
  host.close();
  if (buffer.trim()) enqueue(buffer);
  void queue.finally(async () => { await engine.close(); });
});
