const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

test('le sidecar garde un seul processus, corrige les demandes et s’arrête à la fermeture du pipe', { skip: process.platform !== 'win32', timeout: 20_000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pam-protocol-'));
  const root = path.resolve(__dirname, '..');
  const child = spawn(process.execPath, [path.join(__dirname, 'main.cjs'), path.join(root, 'src-tauri/runtime'), directory], {
    windowsHide: true, env: { ...process.env, PATH: '', NODE_PATH: '', NODE_OPTIONS: '' }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const closed = new Promise(resolve => child.once('close', resolve));
  t.after(async () => {
    if (child.exitCode === null) child.kill(); await closed;
    assert.equal(path.dirname(directory), os.tmpdir()); await fs.rm(directory, { recursive: true, force: true });
  });
  const pending = new Map(); let serial = 0;
  const reader = createInterface({ input: child.stdout });
  reader.on('line', line => {
    const reply = JSON.parse(line); const waiter = pending.get(reply.id);
    if (waiter) { pending.delete(reply.id); waiter(reply); }
  });
  const request = (method, payload = {}) => new Promise(resolve => {
    const id = ++serial; pending.set(id, resolve); child.stdin.write(JSON.stringify({ id, method, payload }) + '\n');
  });
  const first = await request('status');
  assert.equal(first.ok, true); assert.equal(first.result.engine.loaded, true); assert.equal(first.result.engine.pid, child.pid);
  const saved = await request('save_application', { name: 'Deezer', description: 'Écouter de la musique.', aliases: [], executable: process.execPath, arguments: [], enabled: true });
  assert.equal(saved.ok, true);
  await request('settings', { language: 'fr', autoExecute: false, confidenceThreshold: 0.7 });
  const original = await request('process_text', { text: 'Deezer' });
  assert.equal(original.result.status, 'pending');
  const corrected = await request('correct_request', { id: original.result.id, text: 'Diseur', applicationId: saved.result.applications[0].id, saveAlias: true, alias: 'Diseur' });
  assert.equal(corrected.ok, true); assert.equal(corrected.result.status, 'pending');
  assert.equal((await request('confirm', { id: original.result.id })).ok, false);
  const second = await request('status');
  assert.deepEqual(second.result.engine, first.result.engine);
  assert.deepEqual(second.result.config.applications[0].aliases, ['Diseur']);
  const restarted = await request('restart_engine');
  assert.equal(restarted.result.loaded, true); assert.equal(restarted.result.pid, child.pid); assert.equal(restarted.result.generation, 2);
  const after = await request('process_text', { text: 'Diseur' });
  assert.equal(after.result.calls[0].applicationName, 'Deezer');
  await request('discard', { id: corrected.result.id }); await request('discard', { id: after.result.id });
  child.stdin.end(); assert.equal(await closed, 0);
});
