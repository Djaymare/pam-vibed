// Local synthetic audio and real Whistle/Needle. No personal application is used.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify, isDeepStrictEqual } from 'node:util';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarize } from './execution-metrics.mjs';
const require = createRequire(import.meta.url);
const { createAssistant, DEFAULT_CONFIG } = require('../sidecar/assistant.cjs');
const { createEngine } = require('../sidecar/engine.cjs');
const { DEEZER_APP_ID, DEEZER_SOURCE_IDS } = require('../sidecar/deezer.cjs');
const { validateConfig } = require('../sidecar/config-schema.cjs');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const split = process.argv[2];
assert.ok(['calibration', 'heldout'].includes(split), 'Choose calibration or heldout');
const replayPath = process.argv.find((a) => a.startsWith('--replay='))?.slice(9);
const outputPath =
  process.argv.find((a) => a.startsWith('--output='))?.slice(9) ||
  `artifacts/execution-${split}.json`;
const fixtureBytes = await readFile(join(root, 'tests/fixtures/execution-corpus.json'));
const corpus = JSON.parse(fixtureBytes);
const frozenHash = 'f09549a56e240e312a819f868880717d1a2978401fdc885cc71b10eedb6b15ad';
const hash = (data) => createHash('sha256').update(data).digest('hex');
assert.equal(
  hash(fixtureBytes.toString('utf8').replace(/\r\n/g, '\n')),
  frozenHash,
  'Do not tune the frozen corpus',
);
const replay = replayPath ? JSON.parse(await readFile(replayPath)) : null;
assert.equal(process.platform, 'win32');
const cache = join(root, '.runtime-cache');
await mkdir(cache, { recursive: true });
const profile = await mkdtemp(join(cache, 'execution-evaluation-'));
const runtime = join(root, 'src-tauri/runtime');
const engine = createEngine(runtime);
const data = corpus.splits[split];
const apps = data.names.map((name, i) => ({
  id: `${i + 1}`.repeat(8) + '-1111-4111-8111-111111111111',
  name,
  aliases: [],
  description: 'Synthetic evaluation target',
  enabled: true,
  executable: 'C:\\evaluation-fixture.exe',
  arguments: i === 2 ? ['--message', '{input}'] : [],
  ...(i === 3 ? { media: { sourceAppId: 'evaluation-player.exe', deezer: false } } : {}),
}));
apps.push({
  id: '55555555-1111-4111-8111-111111111111',
  name: 'Deezer',
  aliases: [],
  description: 'Synthetic Deezer target',
  enabled: true,
  executable: 'C:\\Windows\\explorer.exe',
  arguments: [`shell:AppsFolder\\${DEEZER_APP_ID}`],
  windowsApp: { appId: DEEZER_APP_ID, kind: 'store', icon: null },
  media: { sourceAppId: DEEZER_SOURCE_IDS[0], deezer: true },
});
function wavPcm(bytes) {
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const size = bytes.readUInt32LE(offset + 4);
    if (bytes.toString('ascii', offset, offset + 4) === 'data')
      return bytes.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + (size % 2);
  }
  throw Error('Missing PCM data');
}
function audio(pcm, noise = false) {
  let seed = 290018,
    energy = 0;
  for (let i = 0; i < pcm.length; i += 2) energy += pcm.readInt16LE(i) ** 2;
  const rms = Math.sqrt(energy / (pcm.length / 2)),
    amplitude = (rms / 10 ** (8 / 20)) * Math.sqrt(3);
  const payload = Buffer.alloc(pcm.length + 16000); // 250 ms silence before and after
  for (let i = 0; i < payload.length; i += 2) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const sample = i >= 8000 && i < 8000 + pcm.length ? pcm.readInt16LE(i - 8000) : 0;
    payload.writeInt16LE(
      Math.max(
        -32768,
        Math.min(32767, Math.round(sample + (noise ? ((seed / 2 ** 32) * 2 - 1) * amplitude : 0))),
      ),
      i,
    );
  }
  const header = Buffer.alloc(44);
  header.write('RIFF');
  header.writeUInt32LE(36 + payload.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(payload.length, 40);
  return Buffer.concat([header, payload]);
}
function words(text) {
  return text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
}
function editDistance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j++)
      next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + (a[i] === b[j] ? 0 : 1)));
    row = next;
  }
  return row[b.length];
}
function normalized(calls) {
  return calls.map((c) => [
    apps.findIndex((a) => a.id === c.applicationId),
    c.action || 'open',
    !c.action && c.arguments?.input === '' ? {} : c.arguments,
  ]);
}
const manifest = data.cases.map(([id, language, , text], i) => ({
  id,
  text,
  voice:
    language === 'en'
      ? 'Microsoft Zira Desktop'
      : split === 'calibration'
        ? 'Microsoft Hortense Desktop'
        : i % 2
          ? 'Microsoft Paul'
          : 'Microsoft Julie',
  rate: split === 'calibration' ? 0 : 1,
}));
const report = {
  schemaVersion: 1,
  split,
  createdAt: new Date().toISOString(),
  corpusSha256: frozenHash,
  sourceBaseCommit: 'e5beb5587b8d64ef672cc91d3fc8ca1c2b3da32e',
  mode: replay ? 'replayed native responses' : 'native Whistle and Needle',
  node: process.version,
  voices: manifest,
  noise: { kind: 'seeded white noise', snrDb: 8, seed: 290018 },
  samples: [],
  realEffects: 0,
};
report.sourceHashes = Object.fromEntries(
  await Promise.all(
    [
      'sidecar/assistant/confirmation.cjs',
      'sidecar/assistant/planner.cjs',
      'sidecar/config-schema.cjs',
      'sidecar/needle-tools.cjs',
      'sidecar/media-commands.cjs',
      'sidecar/deezer-commands.cjs',
    ].map(async (p) => [p, hash(await readFile(join(root, p)))]),
  ),
);
try {
  if (!replay) {
    await writeFile(join(profile, 'manifest.json'), JSON.stringify(manifest));
    await promisify(execFile)(
      process.env.PAM_EVALUATION_POWERSHELL || 'pwsh.exe',
      [
        '-NoProfile',
        '-File',
        join(root, 'scripts/synthesize-execution-corpus.ps1'),
        '-Manifest',
        join(profile, 'manifest.json'),
        '-OutputDirectory',
        profile,
      ],
      { windowsHide: true, timeout: 60000 },
    );
  }
  for (const [id, language, category, text, expected] of data.cases) {
    for (const variant of ['text', 'clean', 'noise']) {
      const key = id + '-' + variant,
        previous = replay?.samples.find((s) => s.key === key);
      let replies = [],
        replayIndex = 0,
        effects = [];
      const runEngine = async (file, args, options) => {
        let result;
        if (replay) {
          assert.ok(previous, key);
          assert.ok(replayIndex < previous.engineReplies.length, key + ' no extra inference');
          result = { stdout: previous.engineReplies[replayIndex++] };
        } else result = await engine.runEngine(file, args, options);
        replies.push(result.stdout);
        return result;
      };
      runEngine.unicode = true;
      const settings = {
        ...DEFAULT_CONFIG,
        applications: apps,
        language,
        autoExecute: true,
        confidenceThreshold: 0.7,
      };
      validateConfig(settings);
      await writeFile(join(profile, 'applications.json'), JSON.stringify(settings));
      const handle = createAssistant({
        configDirectory: profile,
        runtimeDirectory: runtime,
        runEngine,
        engine,
        launchApplication: async (app, args) => {
          effects.push([apps.findIndex((a) => a.id === app.id), 'open', args]);
          return { success: true, message: 'Simulated evaluation launch' };
        },
        media: {
          sessions: async () =>
            apps
              .filter((a) => a.media)
              .map((a) => ({
                sourceAppId: a.media.sourceAppId,
                capabilities: {
                  play: true,
                  pause: true,
                  next: true,
                  previous: true,
                  stop: true,
                  toggle: true,
                },
              })),
          execute: async (app, action, args) => {
            effects.push([apps.findIndex((a) => a.id === app.id), action, args]);
            return { success: true, message: 'Simulated evaluation media' };
          },
        },
      });
      let bytes, turn, error;
      if (variant !== 'text' && !replay)
        bytes = audio(wavPcm(await readFile(join(profile, id + '.wav'))), variant === 'noise');
      if (variant !== 'text' && replay) bytes = audio(Buffer.alloc(16000));
      try {
        turn = await handle(
          variant === 'text' ? 'process_text' : 'process_audio',
          variant === 'text' ? { text } : { audio: [...bytes] },
        );
      } catch (e) {
        if (e.code === 'invalid_profile' || e.message === 'Requête IPC invalide.') throw e;
        error = { code: e.code || 'error', message: e.message };
      }
      const calls = normalized(turn?.calls || []),
        correct = isDeepStrictEqual(calls, expected);
      if (turn?.status === 'pending') await handle('discard', { id: turn.id });
      if (replay)
        assert.equal(
          replayIndex,
          previous.engineReplies.length,
          key + ' consumed exact inference count',
        );
      const transcription =
        turn?.transcript ?? (replies.length ? JSON.parse(replies[0]).text : null);
      const ref = words(text),
        hyp = words(transcription || '');
      const sample = {
        key,
        id,
        variant,
        language,
        category,
        reference: text,
        expected,
        transcript: transcription,
        wordErrors: variant === 'text' ? null : editDistance(ref, hyp),
        referenceWords: ref.length,
        audioSha256: variant === 'text' ? null : previous?.audioSha256 || hash(bytes),
        confidence: turn?.confidence ?? null,
        status: turn?.status || 'error',
        calls,
        correct,
        effects: effects.length,
        error,
        engineReplies: replies,
      };
      report.samples.push(sample);
      console.log(
        JSON.stringify({
          key,
          status: sample.status,
          confidence: sample.confidence,
          correct,
          transcript: transcription,
          error,
        }),
      );
      await mkdir(dirname(resolve(outputPath)), { recursive: true });
      await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
    }
  }
  report.completed = true;
  report.summary = summarize(report);
  for (const variant of ['text', 'clean', 'noise']) {
    const samples = report.samples.filter((s) => s.variant === variant);
    console.log(
      variant,
      JSON.stringify({
        samples: samples.length,
        wrongAuto: samples.filter((s) => s.status === 'executed' && !s.correct).length,
        auto: samples.filter((s) => s.status === 'executed').length,
        pending: samples.filter((s) => s.status === 'pending').length,
        refused: samples.filter((s) => !s.calls.length).length,
        correct: samples.filter((s) => s.correct).length,
      }),
    );
  }
  await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
  assert.equal(
    report.summary.total.falseTriggers,
    0,
    'No negative request may execute automatically',
  );
  assert.equal(
    report.summary.total.wrongAutomaticActions,
    0,
    'No wrong action may execute automatically',
  );
} finally {
  await engine.close();
  assert.equal(dirname(profile), cache);
  assert.ok(profile.startsWith(join(cache, 'execution-evaluation-')));
  await rm(profile, { recursive: true, force: true });
}
