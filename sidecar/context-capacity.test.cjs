const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {
  contextBudget,
  requireCapacity,
  requireToolLimit,
} = require('./assistant/context-capacity.cjs');
const { measure } = require('./assistant/performance.cjs');
const { createAssistant } = require('./assistant.cjs');
const { createEngine } = require('./engine.cjs');
const { profile, sessions, SYSTEM } = require('../scripts/performance-fixtures.cjs');
const { toolsFor } = require('./assistant/intent.cjs');
const { needleTools } = require('./needle-tools.cjs');
test('context capacity counts the native prefix, Unicode bytes, reply and framing at the boundary', () => {
  const exact = contextBudget(7900, 'abcd');
  assert.equal(exact.fits, true);
  assert.equal(exact.availableRequestTokens, 4);
  assert.equal(contextBudget(7900, 'éé').fits, true);
  assert.throws(
    () => requireCapacity(contextBudget(7900, 'ééx')),
    (e) => e.code === 'request_capacity' && /outils sélectionnés/.test(e.message),
  );
  assert.throws(
    () => requireCapacity(contextBudget(7904, 'a')),
    (e) => e.code === 'catalog_capacity' && /catalogue/.test(e.message),
  );
  assert.equal(contextBudget(7904, '').fits, true);
  assert.throws(() => contextBudget(-1, 'x'), /invalide/);
  assert.doesNotThrow(() => requireToolLimit(Array(32)));
  assert.throws(
    () => requireToolLimit(Array(33)),
    (e) => e.code === 'catalog_capacity' && /32 outils/.test(e.message),
  );
  const many = contextBudget(100, 'x', Array(33));
  assert.equal(many.contextFits, true);
  assert.equal(many.fits, false);
});
test('performance observer emits a closed numeric schema on success and failure without changing outcomes', async () => {
  const events = [],
    context = { onPerformance: (e) => events.push(e) };
  assert.equal(
    await measure(context, 'routing', async () => ({ secret: 'personal' })).then((v) => v.secret),
    'personal',
  );
  const error = Error('personal');
  await assert.rejects(
    measure(context, 'transcription', async () => {
      throw error;
    }),
    (e) => e === error,
  );
  await measure(context, 'personal', async () => 0);
  assert.equal(events.length, 2);
  for (const e of events) {
    assert.deepEqual(Object.keys(e).sort(), ['durationMs', 'stage', 'success']);
    assert.ok(e.durationMs >= 0);
    assert.equal(JSON.stringify(e).includes('personal'), false);
  }
  assert.equal(events[1].success, false);
  assert.equal(
    await measure(
      {
        onPerformance: () => {
          throw error;
        },
      },
      'effect',
      async () => 42,
    ),
    42,
  );
});
test('a full catalogue refusal remains actionable, performs no effect and releases temporary audio/tools', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pam-capacity-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const config = profile(32, 'rich');
  await fs.writeFile(path.join(dir, 'applications.json'), JSON.stringify(config));
  const metrics = [];
  let invocations = 0;
  const runEngine = async (_f, args) => {
    invocations++;
    const tools = JSON.parse(await fs.readFile(args[args.indexOf('--tools') + 1]));
    assert.equal(tools.length, 224);
    const e = Error(
      'Le catalogue d’outils occupe le contexte du modèle. Désactivez des applications.',
    );
    e.code = 'catalog_capacity';
    throw e;
  };
  const h = createAssistant({
    configDirectory: dir,
    runtimeDirectory: dir,
    runEngine,
    media: { sessions: async () => sessions(config) },
    onPerformance: (e) => metrics.push(e),
    launchApplication: () => assert.fail('no effects'),
  });
  const result = await h('process_text', { text: 'Ouvre mon application pour écrire des notes' });
  assert.equal(result.status, 'unsupported');
  assert.deepEqual(result.calls, []);
  assert.match(result.message, /catalogue/);
  assert.equal(invocations, 1);
  assert.ok(metrics.some((e) => e.stage === 'discovery' && e.success));
  assert.ok(metrics.some((e) => e.stage === 'routing' && !e.success));
  const entries = await fs.readdir(dir);
  assert.ok(!entries.some((e) => e.startsWith('turn-')));
});
test(
  'native capacity is measured for 32 media apps; a precise target still fits and routes after refusal',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const config = profile(32, 'rich'),
      tools = toolsFor(config, sessions(config));
    const engine = createEngine(path.resolve(__dirname, '../src-tauri/runtime'));
    t.after(() => engine.close());
    await engine.warm();
    const all = needleTools(tools, config);
    let budget;
    try {
      budget = await engine.measureCapacity({
        system: SYSTEM,
        tools: all,
        text: 'Ouvre mon application',
      });
    } catch (e) {
      assert.equal(e.code, 'catalog_capacity');
    }
    if (budget) assert.equal(budget.fits, false);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pam-capacity-native-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    await fs.writeFile(path.join(dir, 'applications.json'), JSON.stringify(config));
    const h = createAssistant({
      configDirectory: dir,
      runtimeDirectory: path.resolve(__dirname, '../src-tauri/runtime'),
      runEngine: engine.runEngine,
      engine,
      media: { sessions: async () => sessions(config) },
    });
    const refused = await h('process_text', {
      text: 'Ouvre mon application pour écrire des notes',
    });
    assert.equal(refused.status, 'unsupported');
    assert.match(refused.message, /catalogue|outils sélectionnés/);
    assert.doesNotMatch(refused.message, /Rechargez|uniquement/);
    const result = await h('process_text', { text: 'Ouvre Bloc-notes' });
    assert.equal(result.status, 'pending');
    assert.equal(result.calls.length, 1);
    assert.equal(result.calls[0].applicationId, config.applications[0].id);
  },
);
