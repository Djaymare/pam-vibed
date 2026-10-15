import test from 'node:test';
import assert from 'node:assert/strict';
import { validateResult, matches } from '../src/contract-runtime.js';

test('WebView2 native fixtures conform to the live IPC contract, including errors and edits', async t => {
  const previousLocation = globalThis.location, previousWindow = globalThis.window;
  globalThis.location = { search: '' }; globalThis.window = {};
  t.after(() => { if (previousLocation === undefined) delete globalThis.location; else globalThis.location = previousLocation; if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; });
  const fixture = await import('./fixtures/modal-native.js');
  let id = 0;
  const call = async (method, payload = {}) => {
    const request = { version: 1, id: ++id, requestId: '11111111-1111-4111-8111-111111111111', method, payload };
    const reply = await fixture.invoke('assistant_request', { request });
    assert.equal(reply.id, id); assert.equal(reply.method, method); assert.equal(reply.requestId, request.requestId);
    if (reply.ok) assert.ok(validateResult(method, reply.result), method);
    else assert.ok(matches(reply.error, 'PamError'), method + ' error');
    return reply;
  };
  assert.equal((await call('status')).result.config.applications.length, 1);
  assert.equal((await call('discover_applications')).result.length, 1);
  await call('media_sessions'); await call('desktop_action', { action: 'hide' });
  const draft = { name: 'Clavier', description: 'Test', executable: 'C:\\fixture.exe', aliases: [], arguments: [], enabled: true };
  assert.equal((await call('save_application', draft)).ok, false);
  assert.equal((await call('save_application', draft)).ok, true);
  const turn = (await call('process_text', { text: 'demande' })).result;
  assert.equal((await call('correct_request', { id: turn.id, text: 'correction' })).ok, false);
  assert.equal((await call('correct_request', { id: turn.id, text: 'correction' })).ok, true);
});
