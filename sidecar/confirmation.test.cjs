const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { confirmationReason } = require('./assistant/confirmation.cjs');
const { createAssistant, DEFAULT_CONFIG, toolName, toolsFor } = require('./assistant.cjs');
const { registry } = require('./action-registry.cjs');
const app = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Atelier',
  aliases: [],
  description: 'Test target',
  enabled: true,
  executable: 'C:\\fixture.exe',
  arguments: [],
};
test('PAM-29 policy: boundary, literal scope, parameters, audio, corrections and every registered effect', () => {
  assert.equal(DEFAULT_CONFIG.autoExecute, false);
  const config = { ...DEFAULT_CONFIG, autoExecute: true, applications: [app] },
    tools = toolsFor(config);
  const turn = {
    transcript: 'Ouvre Atelier',
    confidence: 0.7,
    calls: [{ applicationId: app.id, arguments: { input: '' } }],
  };
  const reason = (method = 'process_text', value = turn, c = config, flags = {}) =>
    confirmationReason(method, value, c, { suppressed: false, ungrounded: false, tools, ...flags });
  assert.equal(reason(), null);
  assert.ok(reason('process_audio', { ...turn, confidence: 1 }));
  assert.ok(reason('correct_request', { ...turn, confidence: 1 }));
  assert.ok(reason('process_text', turn, { ...config, autoExecute: false }));
  assert.ok(reason('process_text', turn, { ...config, confidenceThreshold: 0.71 }));
  for (const confidence of [null, NaN, 0.6999])
    assert.ok(reason('process_text', { ...turn, confidence }));
  for (const flags of [{ suppressed: true }, { ungrounded: true }])
    assert.ok(reason('process_text', turn, config, flags));
  assert.ok(reason('process_text', { ...turn, calls: [...turn.calls, ...turn.calls] }));
  assert.ok(reason('process_text', { ...turn, transcript: 'Pourquoi ouvrir Atelier ?' }));
  assert.ok(
    reason('process_text', {
      ...turn,
      calls: [{ ...turn.calls[0], arguments: { input: '--send' } }],
    }),
  );
  for (const args of [['--send'], ['{input}'], ['shell:AppsFolder\\fixture']])
    assert.ok(
      reason('process_text', turn, { ...config, applications: [{ ...app, arguments: args }] }),
    );
  for (const action of registry.actions
    .filter((a) => !['open', 'media_play', 'media_pause'].includes(a.id))
    .map((a) => a.id)
    .concat('future_action'))
    assert.ok(
      reason('process_text', {
        ...turn,
        calls: [{ applicationId: app.id, action, arguments: {} }],
      }),
      action,
    );
});
test('PAM-29 high-score voice and free arguments wait for one-shot consent; explicit opt-in text can run', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pam-confirmation-'));
  t.after(async () => {
    assert.equal(path.dirname(dir), os.tmpdir());
    await fs.rm(dir, { recursive: true, force: true });
  });
  let effects = 0,
    input = '',
    text = 'Ouvre Atelier';
  const handle = createAssistant({
    runtimeDirectory: dir,
    configDirectory: dir,
    launchApplication: async () => {
      effects++;
      return { success: true };
    },
    runEngine: async (_file, args) => ({
      stdout: JSON.stringify(
        args.includes('--tools')
          ? {
              confidence: 1,
              function_calls: [{ name: toolName(app), arguments: input ? { input } : {} }],
            }
          : { text, language: 'fr' },
      ),
    }),
  });
  const save = async (value) =>
    fs.writeFile(
      path.join(dir, 'applications.json'),
      JSON.stringify({ ...DEFAULT_CONFIG, applications: [value], autoExecute: true }),
    );
  await save(app);
  assert.equal((await handle('process_text', { text })).status, 'executed');
  assert.equal(effects, 1);
  const b = Buffer.alloc(44 + 3200);
  b.write('RIFF');
  b.writeUInt32LE(b.length - 8, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(3200, 40);
  const voice = await handle('process_audio', { audio: [...b] });
  assert.equal(voice.status, 'pending');
  assert.equal(voice.confidence, 1);
  assert.equal(effects, 1);
  assert.match(voice.message, /transcription/);
  assert.equal((await handle('confirm', { id: voice.id })).status, 'executed');
  assert.equal(effects, 2);
  assert.equal((await handle('confirm', { id: voice.id })).status, 'consumed');
  assert.equal(effects, 2);
  input = 'message privé';
  text = 'Ouvre Atelier avec le texte message privé';
  await save({ ...app, arguments: ['{input}'] });
  const free = await handle('process_text', { text });
  assert.equal(free.status, 'pending');
  assert.equal(effects, 2);
  assert.deepEqual(free.calls[0].arguments, { input });
  assert.equal((await handle('confirm', { id: free.id })).status, 'executed');
  assert.equal(effects, 3);
  assert.equal((await handle('confirm', { id: free.id })).status, 'consumed');
  assert.equal(effects, 3);
});
