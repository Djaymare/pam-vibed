// Real local Needle inference. Every launch is an injected fixture effect.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { createAssistant, DEFAULT_CONFIG } = require('../sidecar/assistant.cjs');
const { createEngine } = require('../sidecar/engine.cjs');
const { executable } = require('../sidecar/languages.cjs');
const corpus = require('../tests/fixtures/language-corpus.json');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
assert.equal(process.platform, 'win32');
const cache = join(root, '.runtime-cache');
await mkdir(cache, { recursive: true });
const profile = await mkdtemp(join(cache, 'smoke-languages-'));
const runtime = join(root, 'src-tauri/runtime'),
  engine = createEngine(runtime);
const first = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Test',
  aliases: [],
  description: 'Test application',
  executable: 'C:\\fixture.exe',
  arguments: [],
  enabled: true,
};
const second = { ...first, id: '22222222-2222-4222-8222-222222222222', name: 'Autre' };
const report = {
  date: new Date().toISOString(),
  checks: [],
  realActionsExecuted: 0,
  needleInvocations: 0,
};
try {
  for (const item of corpus) {
    const directory = join(profile, item.language);
    await mkdir(directory);
    await writeFile(
      join(directory, 'applications.json'),
      JSON.stringify({
        ...DEFAULT_CONFIG,
        language: item.language,
        applications: [first, second],
        autoExecute: false,
      }),
    );
    let effects = 0;
    const run = async (...args) => {
      report.needleInvocations++;
      return engine.runEngine(...args);
    };
    run.unicode = engine.runEngine.unicode;
    const handle = createAssistant({
      configDirectory: directory,
      runtimeDirectory: runtime,
      runEngine: run,
      engine,
      launchApplication: async () => {
        effects++;
        return { success: true, message: 'Fixture' };
      },
    });
    for (const kind of ['open', 'negative', 'ambiguous']) {
      const turn = await handle('process_text', { text: item[kind] });
      const supported = kind === 'open' && executable(item.language);
      assert.equal(
        turn.status,
        supported ? 'pending' : 'unsupported',
        item.language + ' ' + kind + ' ' + JSON.stringify(turn),
      );
      assert.equal(turn.calls.length, supported ? 1 : 0);
      if (supported) {
        assert.equal(turn.calls[0].applicationId, first.id);
        await handle('discard', { id: turn.id });
      }
      assert.equal(effects, 0);
      report.checks.push({
        language: item.language,
        kind,
        status: turn.status,
        confidence: turn.confidence,
      });
    }
    // A textual correction in an execution language traverses real inference.
    if (executable(item.language)) {
      const corrected = await handle('correct_request', {
        id: crypto.randomUUID(),
        text: item.correction,
        applicationId: second.id,
      });
      assert.equal(corrected.status, 'pending');
      assert.equal(corrected.calls[0].applicationId, second.id);
      await handle('discard', { id: corrected.id });
      report.checks.push({
        language: item.language,
        kind: 'inferred correction',
        status: corrected.status,
      });
    }
    const manual = await handle('correct_request', {
      id: crypto.randomUUID(),
      text: item.correction,
      applicationId: second.id,
      action: 'open',
    });
    assert.equal(manual.status, 'pending');
    assert.equal(effects, 0);
    assert.equal((await handle('confirm', { id: manual.id })).status, 'executed');
    assert.equal(effects, 1);
    report.checks.push({
      language: item.language,
      kind: 'manual correction confirmed',
      status: 'executed fixture',
    });
    console.log(item.language + ' corpus passed');
  }
  report.passed = true;
  await mkdir(join(root, 'artifacts'), { recursive: true });
  await writeFile(join(root, 'artifacts/language-results.json'), JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      checks: report.checks.length,
      needleInvocations: report.needleInvocations,
      realActionsExecuted: 0,
    }),
  );
} finally {
  await engine.close();
  assert.equal(dirname(profile), cache);
  assert.ok(profile.startsWith(join(cache, 'smoke-languages-')));
  await rm(profile, { recursive: true, force: true });
}
