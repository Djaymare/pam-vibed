const { createAssistant } = require('./assistant.cjs');

const { createEngine } = require('./engine.cjs');
const [runtimeDirectory, configDirectory] = process.argv.slice(2);
const engine = createEngine(runtimeDirectory);
const handle = createAssistant({ runtimeDirectory, configDirectory, runEngine: engine.runEngine, engine });
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
    if (line.trim()) enqueue(line);
  }
});
process.stdin.on('end', () => {
  if (buffer.trim()) enqueue(buffer);
  void queue.finally(async () => { await engine.close(); });
});
