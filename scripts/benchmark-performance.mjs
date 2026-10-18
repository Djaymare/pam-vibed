// Isolated Windows process per scenario; only synthetic profiles and fake effects.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { fork, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { resolve, join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { distribution } from './performance-metrics.mjs';
const require = createRequire(import.meta.url);
const { createEngine } = require('../sidecar/engine.cjs');
const { createAssistant } = require('../sidecar/assistant.cjs');
const { toolsFor } = require('../sidecar/assistant/intent.cjs');
const { needleTools } = require('../sidecar/needle-tools.cjs');
const { validateConfig } = require('../sidecar/config-schema.cjs');
const { profile, sessions, SYSTEM } = require('./performance-fixtures.cjs');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = join(root, 'src-tauri/runtime');
const cache = join(root, '.runtime-cache');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
assert.equal(process.platform, 'win32');
const cycles = Number(process.env.PAM_BENCH_CYCLES || 3);
const repetitions = Number(process.env.PAM_BENCH_REPETITIONS || 10);
assert.ok(Number.isInteger(cycles) && cycles >= 3 && cycles <= 10);
assert.ok(Number.isInteger(repetitions) && repetitions >= 5 && repetitions <= 100);
const hash = (b) => createHash('sha256').update(b).digest('hex');
if (process.argv[2] === '--child') {
  const count = Number(process.argv[3]),
    kind = process.argv[4],
    audioFile = process.argv[5];
  process.send({ type: 'ready' });
  const config = validateConfig(profile(count, kind));
  const directory = await mkdtemp(join(cache, 'performance-profile-'));
  const records = [],
    memory = [],
    idle = [],
    capacity = [];
  let cycle = 0,
    scenario = 'setup',
    peakRss = 0;
  const record = (e) => records.push({ cycle, scenario, ...e });
  const sampleMemory = (label) => {
    const m = process.memoryUsage();
    memory.push({
      cycle,
      label,
      rssBytes: m.rss,
      heapUsedBytes: m.heapUsed,
      externalBytes: m.external,
    });
  };
  const sampler = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage.rss());
  }, 50);
  const engine = createEngine(runtime);
  const effects = [];
  const media = {
    sessions: async () => sessions(config),
    execute: async (_a, _v, _p, o) => {
      await o.beforeEffect();
      effects.push(1);
      return { success: true, message: 'Synthetic effect' };
    },
  };
  const handle = createAssistant({
    runtimeDirectory: runtime,
    configDirectory: directory,
    runEngine: engine.runEngine,
    engine,
    media,
    onPerformance: record,
    launchApplication: async (_a, _p, o) => {
      await o.beforeEffect();
      effects.push(1);
      return { success: true, message: 'Synthetic effect' };
    },
  });
  try {
    await writeFile(join(directory, 'applications.json'), JSON.stringify(config));
    const audio = Array.from(await readFile(audioFile));
    sampleMemory('beforeWarm');
    for (cycle = 0; cycle < cycles; cycle++) {
      scenario = 'cold';
      const cold = performance.now();
      await handle('status');
      records.push({
        cycle,
        scenario,
        stage: 'statusTotal',
        durationMs: performance.now() - cold,
        success: true,
      });
      sampleMemory('afterWarm');
      scenario = 'warm';
      for (let i = 0; i < repetitions; i++) {
        const start = performance.now();
        await handle('status');
        records.push({
          cycle,
          scenario,
          stage: 'statusTotal',
          durationMs: performance.now() - start,
          success: true,
        });
      }
      scenario = 'capacity';
      const tools = toolsFor(config, sessions(config));
      for (const [selection, chosen] of [
        ['all', tools],
        [
          'explicit',
          tools.filter((t) => t.applicationId === config.applications[0].id && t.action === 'open'),
        ],
      ]) {
        try {
          capacity.push({
            cycle,
            selection,
            ...(await engine.measureCapacity({
              system: SYSTEM,
              tools: needleTools(chosen, config),
              text: 'Ouvre Bloc-notes',
            })),
          });
        } catch (e) {
          capacity.push({
            cycle,
            selection,
            toolCount: chosen.length,
            toolsBytes: Buffer.byteLength(JSON.stringify(needleTools(chosen, config))),
            errorCode: e.code || 'native_error',
            message: e.code?.endsWith('_capacity') ? e.message : 'Native initialization failed',
          });
        }
      }
      for (const type of ['text', 'audio', 'catalogue']) {
        scenario = type;
        for (let i = 0; i < repetitions; i++) {
          const start = performance.now();
          const turn = await handle(
            type === 'audio' ? 'process_audio' : 'process_text',
            type === 'audio'
              ? { audio }
              : {
                  text:
                    type === 'catalogue'
                      ? 'Ouvre mon application pour écrire des notes'
                      : 'Ouvre Bloc-notes',
                },
          );
          records.push({
            cycle,
            scenario,
            stage: 'requestTotal',
            durationMs: performance.now() - start,
            success: true,
            status: turn.status,
            capacityRefusal:
              !!turn.message && /contexte du modèle|plus de 32 outils/.test(turn.message),
          });
          if (turn.status === 'pending') await handle('discard', { id: turn.id });
        }
      }
      scenario = 'effect';
      for (let i = 0; i < repetitions; i++) {
        const t = await handle('prepare_action', {
          applicationId: config.applications[0].id,
          action: 'open',
        });
        const done = await handle('confirm', { id: t.id });
        assert.equal(done.status, 'executed');
      }
      sampleMemory('afterRequests');
      const cpu = process.cpuUsage(),
        start = performance.now();
      await delay(1000);
      const elapsed = performance.now() - start,
        used = process.cpuUsage(cpu);
      idle.push({
        cycle,
        elapsedMs: elapsed,
        cpuMs: (used.user + used.system) / 1000,
        cpuPercentOneCore: ((used.user + used.system) / 1000 / elapsed) * 100,
        rssBytes: process.memoryUsage.rss(),
      });
      await engine.close();
      sampleMemory('afterClose');
      process.send({
        type: 'progress',
        count,
        kind,
        cycle,
        records: records.length,
        rssBytes: process.memoryUsage.rss(),
      });
    }
    const groups = {};
    for (const r of records) {
      const k = `${r.scenario}/${r.stage}`;
      (groups[k] ??= []).push(r.durationMs);
    }
    process.send({
      type: 'result',
      result: {
        count,
        kind,
        cycles,
        repetitions,
        records,
        memory,
        idle,
        peakRssBytes: peakRss,
        capacity,
        simulatedEffects: effects.length,
        distributions: Object.fromEntries(
          Object.entries(groups).map(([k, v]) => [k, distribution(v)]),
        ),
      },
    });
  } finally {
    clearInterval(sampler);
    await engine.close();
    assert.equal(dirname(resolve(directory)), cache);
    assert.ok(resolve(directory).startsWith(cache + sep + 'performance-profile-'));
    await rm(directory, { recursive: true, force: true });
  }
} else {
  await mkdir(cache, { recursive: true });
  const temporary = await mkdtemp(join(cache, 'performance-audio-'));
  const report = {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    machine: {
      platform: process.platform,
      release: os.release(),
      arch: os.arch(),
      cpu: os.cpus()[0]?.model,
      logicalCpus: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
    },
    node: process.version,
    runtime: JSON.parse(await readFile(join(runtime, 'manifest.json'))),
    cycles,
    repetitions,
    voice: 'Microsoft Hortense Desktop',
    sourceHashes: {},
    scenarios: [],
    nativeDiscovery: [],
  };
  const files = [
    'sidecar/config-schema.cjs',
    'sidecar/action-registry.json',
    'scripts/performance-metrics.mjs',
    'scripts/synthesize-execution-corpus.ps1',
    'src-tauri/src/applications.rs',
    'src-tauri/src/applications/native.rs',
    'src-tauri/examples/discovery.rs',
    'src-tauri/Cargo.toml',
    'src-tauri/Cargo.lock',
    'sidecar/engine.cjs',
    'sidecar/engine-worker.cjs',
    'sidecar/assistant.cjs',
    'sidecar/assistant/planner.cjs',
    'sidecar/assistant/intent.cjs',
    'sidecar/assistant/executor.cjs',
    'sidecar/assistant/context-capacity.cjs',
    'sidecar/assistant/performance.cjs',
    'sidecar/needle-tools.cjs',
    'scripts/benchmark-performance.mjs',
    'scripts/performance-fixtures.cjs',
  ];
  for (const f of files) report.sourceHashes[f] = hash(await readFile(join(root, f)));
  try {
    const manifest = join(temporary, 'manifest.json');
    await writeFile(
      manifest,
      JSON.stringify([{ id: 'request', text: 'Ouvre Bloc-notes', voice: report.voice, rate: 0 }]),
    );
    const synthesize = await readFile(
      join(root, 'scripts/synthesize-execution-corpus.ps1'),
      'utf8',
    );
    const quote = (s) => `'${s.replaceAll("'", "''")}'`;
    await promisify(execFile)(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `& { ${synthesize} } -Manifest ${quote(manifest)} -OutputDirectory ${quote(temporary)}`,
      ],
      { windowsHide: true },
    );
    // Normalize SAPI RIFF metadata to the application's canonical PCM header.
    const wav = await readFile(join(temporary, 'request.wav'));
    let pcm;
    for (let o = 12; o + 8 <= wav.length;) {
      const n = wav.readUInt32LE(o + 4);
      if (wav.toString('ascii', o, o + 4) === 'data') {
        pcm = wav.subarray(o + 8, o + 8 + n);
        break;
      }
      o += 8 + n + (n % 2);
    }
    assert.ok(pcm);
    const { encodeWav } = await import('../src/audio/wav.ts');
    await writeFile(
      join(temporary, 'canonical.wav'),
      encodeWav(
        Float32Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2) / 32768),
      ),
    );
    report.audioSha256 = hash(await readFile(join(temporary, 'canonical.wav')));
    const discovery = resolve(
      process.env.PAM_BENCH_DISCOVERY ||
        join(
          root,
          'artifacts/pam34/windows/src-tauri/target/x86_64-pc-windows-msvc/debug/examples/discovery.exe',
        ),
    );
    report.discoveryBinarySha256 = hash(await readFile(discovery));
    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      const { stdout } = await promisify(execFile)(discovery, [], {
        windowsHide: true,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        timeout: 20000,
      });
      const entries = JSON.parse(stdout);
      report.nativeDiscovery.push({ durationMs: performance.now() - start, count: entries.length });
    }
    for (const count of [1, 8, 32])
      for (const kind of ['plain', 'rich']) {
        console.log(`Benchmark ${count} applications, ${kind}`);
        const start = performance.now();
        let readyMs, result;
        await new Promise((resolve, reject) => {
          const child = fork(
            fileURLToPath(import.meta.url),
            ['--child', String(count), kind, join(temporary, 'canonical.wav')],
            { silent: true, windowsHide: true },
          );
          let stderr = '';
          child.stderr.on('data', (b) => {
            stderr += b.toString();
          });
          child.on('message', (m) => {
            if (m.type === 'ready') readyMs = performance.now() - start;
            if (m.type === 'progress') console.log(JSON.stringify(m));
            if (m.type === 'result') result = m.result;
          });
          child.on('error', reject);
          child.on('exit', (code) =>
            code === 0 && result
              ? resolve()
              : reject(Error(`Benchmark failed (${code}): ${stderr.slice(-3000)}`)),
          );
        });
        report.scenarios.push({
          ...result,
          processReadyMs: readyMs,
          totalMs: performance.now() - start,
        });
        console.log(
          JSON.stringify({
            count,
            kind,
            peakMiB: result.peakRssBytes / 2 ** 20,
            distributions: result.distributions,
          }),
        );
      }
    report.nativeDiscoveryDistribution = distribution(
      report.nativeDiscovery.map((s) => s.durationMs),
    );
    report.completedAt = new Date().toISOString();
    report.completed = true;
    const output = resolve(process.argv[2] || 'artifacts/performance.json');
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2) + '\n');
    console.log(`Report: ${output}`);
  } finally {
    assert.equal(dirname(resolve(temporary)), cache);
    assert.ok(resolve(temporary).startsWith(cache + sep + 'performance-audio-'));
    await rm(temporary, { recursive: true, force: true });
  }
}
