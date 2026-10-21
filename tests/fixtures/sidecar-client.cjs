const { createInterface } = require('node:readline');
const { randomUUID } = require('node:crypto');

// Test transport only: consume both pipes and keep failures bounded and attributable.
function createSidecarClient(child, { timeoutMs = 45_000, signal } = {}) {
  const pending = new Map();
  const history = [];
  let serial = 0;
  let stderr = Buffer.alloc(0);
  let terminal;
  const describe = () => `requests=${history.join(',')}; stderr=${stderr.toString('utf8')}`;
  const fail = message => {
    terminal ??= new Error(`${message}; ${describe()}`);
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(terminal);
    }
    pending.clear();
  };
  child.stderr.on('data', chunk => {
    stderr = Buffer.concat([stderr, Buffer.from(chunk)]).subarray(-8192);
  });
  const reader = createInterface({ input: child.stdout });
  reader.on('line', line => {
    let reply;
    try { reply = JSON.parse(line); }
    catch { fail('Invalid JSON from sidecar'); return; }
    if (!reply || typeof reply !== 'object') { fail('Incompatible sidecar frame'); return; }
    if (reply.type === 'diagnostic' || reply.type === 'turn_progress') return;
    const request = pending.get(reply.id);
    if (!request) { fail('Unexpected sidecar reply'); return; }
    if (reply.version !== 1 || reply.requestId !== request.requestId || typeof reply.ok !== 'boolean') {
      fail('Incompatible sidecar reply'); return;
    }
    clearTimeout(request.timer);
    pending.delete(reply.id);
    history.push(`${request.method}:reply`);
    request.resolve(reply);
  });
  child.on('error', error => fail(`Sidecar spawn error: ${error.message}`));
  child.stdin.on('error', error => fail(`Sidecar stdin error: ${error.message}`));
  child.once('close', (code, exitSignal) => {
    fail(`Sidecar closed code=${code} signal=${exitSignal}`);
    signal?.removeEventListener('abort', aborted);
    reader.close();
  });
  const aborted = () => fail('Protocol test aborted');
  signal?.addEventListener('abort', aborted, { once: true });
  if (signal?.aborted) aborted();
  return {
    describe,
    request(method, payload = {}, transport = {}) {
      if (terminal) return Promise.reject(terminal);
      const id = ++serial;
      const requestId = randomUUID();
      history.push(`${method}:sent`);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => fail(`Sidecar request timed out: ${method}`), timeoutMs);
        pending.set(id, { method, requestId, resolve, reject, timer });
        child.stdin.write(JSON.stringify({ version: 1, requestId, id, method, payload, ...transport }) + '\n', error => {
          if (error) fail(`Sidecar write failed: ${error.message}`);
        });
      });
    },
  };
}
module.exports = { createSidecarClient };
