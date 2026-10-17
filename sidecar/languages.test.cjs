const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const corpus = require('../tests/fixtures/language-corpus.json');
const { languages, LANGUAGES, strings, executable } = require('./languages.cjs');
const { createAssistant, DEFAULT_CONFIG } = require('./assistant.cjs');
const { requestIssue } = require('./needle-tools.cjs');
const first = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Test',
  aliases: [],
  description: 'Application de test',
  executable: 'C:\\fixture.exe',
  arguments: [],
  enabled: true,
};
const second = { ...first, id: '22222222-2222-4222-8222-222222222222', name: 'Autre' };
function wav() {
  const b = Buffer.alloc(44 + 3200);
  b.write('RIFF');
  b.writeUInt32LE(b.length - 8, 4);
  b.write('WAVE', 8);
  b.write('fmt ', 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24);
  b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(3200, 40);
  return Array.from(b);
}
async function fixture(t, language, speech) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pam-languages-'));
  t.after(async () => {
    assert.equal(path.dirname(directory), os.tmpdir());
    assert.ok(path.basename(directory).startsWith('pam-languages-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  await fs.writeFile(
    path.join(directory, 'applications.json'),
    JSON.stringify({ ...DEFAULT_CONFIG, autoExecute: true, language, applications: [first, second] }),
  );
  let inferences = 0,
    effects = 0,
    transcriptions = 0;
  const handle = createAssistant({
    configDirectory: directory,
    runtimeDirectory: directory,
    runEngine: async (_file, args) => {
      if (!args.includes('--tools')) {
        transcriptions++;
        return { stdout: JSON.stringify(speech) };
      }
      inferences++;
      const tools = JSON.parse(await fs.readFile(args[args.indexOf('--tools') + 1]));
      return {
        stdout: JSON.stringify({
          confidence: 0.99,
          function_calls: [{ name: tools[0].name, arguments: {} }],
          audio_language: 'es',
        }),
      };
    },
    launchApplication: async () => {
      effects++;
      return { success: true, message: 'Fixture' };
    },
  });
  return {
    handle,
    get counts() {
      return { inferences, effects, transcriptions };
    },
  };
}
test('language catalogue and deterministic corpus cover every offered concrete language', () => {
  assert.deepEqual([...LANGUAGES], ['auto', 'fr', 'en', 'de', 'es', 'it', 'nl', 'pl']);
  assert.deepEqual(
    corpus.map((c) => c.language),
    languages.filter((l) => l.id !== 'auto').map((l) => l.id),
  );
  for (const item of languages)
    assert.ok(
      item.option.includes(
        item.execution
          ? 'transcription et commandes'
          : item.id === 'auto'
            ? 'détecté'
            : 'transcription uniquement',
      ),
    );
});
for (const item of corpus)
  test(`PAM-28 ${item.language}: opening, negation, ambiguity and explicit correction`, async (t) => {
    const f = await fixture(t, item.language);
    const open = await f.handle('process_text', { text: item.open });
    assert.equal(open.status, executable(item.language) ? 'executed' : 'unsupported');
    assert.equal(open.language, item.language, 'Needle cannot relabel the transcription language');
    const before = f.counts.effects;
    for (const text of [item.negative, item.ambiguous]) {
      const result = await f.handle('process_text', { text });
      assert.equal(result.status, 'unsupported', text);
      assert.deepEqual(result.calls, []);
      assert.equal(f.counts.effects, before);
    }
    const corrected = await f.handle('correct_request', {
      id: open.id,
      text: item.correction,
      applicationId: second.id,
      action: 'open',
    });
    assert.equal(corrected.status, 'pending');
    assert.equal(corrected.calls[0].applicationId, second.id);
    assert.equal(f.counts.effects, before);
    await f.handle('confirm', { id: corrected.id });
    assert.equal(f.counts.effects, before + 1);
    if (!executable(item.language)) {
      assert.equal(f.counts.inferences, 0);
      assert.equal(open.message, strings.transcriptionOnly);
    }
  });
test('FR/EN launch guards refuse negatives, quoted requests and shared-name ambiguity', () => {
  const config = { ...DEFAULT_CONFIG, applications: [first, second] };
  const calls = [{ applicationId: first.id, action: 'open' }];
  for (const text of [
    'Ne lance pas Test',
    "Don't open Test",
    'Never launch Test',
    'Ouvre Test et ne lance pas Autre',
    'Open Test but do not open Autre',
    'Elle a dit : « Ouvre Test »',
    'He said "Open Test"',
  ])
    assert.ok(requestIssue(text, config, calls), text);
  for (const text of ['Open Test', 'Ouvre Test'])
    assert.equal(requestIssue(text, config, calls), null);
  const duplicate = {
    ...config,
    applications: [
      { ...first, aliases: ['éditeur'] },
      { ...second, aliases: ['éditeur'] },
    ],
  };
  assert.equal(requestIssue('Ouvre éditeur', duplicate, calls), strings.ambiguous);
  assert.equal(requestIssue('Open Test or Autre', config, calls), strings.ambiguous);
  assert.equal(
    requestIssue('Open Test and open Autre', config, [
      ...calls,
      { applicationId: second.id, action: 'open' },
    ]),
    null,
  );
});
test('transcription-only mode blocks even an English-looking phrase and a memorized command', async (t) => {
  const f = await fixture(t, 'nl');
  await f.handle('save_command_alias', {
    phrase: 'Open Test',
    applicationId: first.id,
    action: 'open',
  });
  const turn = await f.handle('process_text', { text: 'Open Test' });
  assert.equal(turn.status, 'unsupported');
  assert.deepEqual(f.counts, { inferences: 0, effects: 0, transcriptions: 0 });
});
for (const detected of ['fr', 'en', 'es', 'de', 'it', 'nl', 'pl', undefined, 'xx'])
  test(`automatic audio detection ${detected}: language gate before inference`, async (t) => {
    const f = await fixture(t, 'auto', { text: 'Open Test', language: detected });
    const turn = await f.handle('process_audio', { audio: wav() });
    assert.equal(turn.status, executable(detected) ? 'pending' : 'unsupported');
    assert.equal(f.counts.inferences, executable(detected) ? 1 : 0);
    assert.equal(f.counts.effects, 0);
    assert.equal(f.counts.transcriptions, 1);
  });
test('automatic typed language never guesses from a model or an alias', async (t) => {
  const f = await fixture(t, 'auto');
  const result = await f.handle('process_text', { text: 'Open Test' });
  assert.equal(result.message, strings.unknownDetection);
  assert.equal(f.counts.inferences, 0);
});
for (const item of corpus.filter((item) => !executable(item.language)))
  test(`Whistle ${item.language} is preserved without inference`, async (t) => {
    const f = await fixture(t, item.language, { text: item.open, language: item.language });
    const result = await f.handle('process_audio', { audio: wav() });
    assert.equal(result.transcript, item.open);
    assert.equal(result.language, item.language);
    assert.equal(result.status, 'unsupported');
    assert.deepEqual(f.counts, { transcriptions: 1, inferences: 0, effects: 0 });
  });
