const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {createEngine}=require('../../sidecar/engine.cjs');
const {createAssistant}=require('../../sidecar/assistant.cjs');
const {profile,sessions,SYSTEM}=require('../../scripts/performance-fixtures.cjs');
const {toolsFor}=require('../../sidecar/assistant/intent.cjs');
const {needleTools}=require('../../sidecar/needle-tools.cjs');
assert.equal(process.platform,'win32','Real capacity measurement requires Windows');

test(
  'native capacity is measured for 32 media apps; a precise target still fits and routes after refusal',
  { timeout: 120_000 },
  async (t) => {
    const config = profile(32, 'rich'),
      tools = toolsFor(config, sessions(config));
    const engine = createEngine(path.resolve(__dirname, '../../src-tauri/runtime'));
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
      runtimeDirectory: path.resolve(__dirname, '../../src-tauri/runtime'),
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
