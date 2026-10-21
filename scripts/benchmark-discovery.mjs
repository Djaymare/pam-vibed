// Alternate isolated before/after processes; save counts and timing, never names.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { distribution } from './performance-metrics.mjs';
const [before, after, output] = process.argv.slice(2);
assert.ok(before && after && output, 'Pass before-helper after-helper output.json');
assert.equal(process.platform, 'win32');
const binaries = { before: resolve(before), after: resolve(after) };
const report = {
  schemaVersion: 1,
  machine: {
    platform: process.platform,
    release: os.release(),
    cpu: os.cpus()[0]?.model,
    totalMemoryBytes: os.totalmem(),
  },
  node: process.version,
  startedAt: new Date().toISOString(),
  binarySha256: {},
  trials: [],
  distributions: {},
};
for (const [key, file] of Object.entries(binaries))
  report.binarySha256[key] = createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
for (let i = 0; i < 10; i++) {
  for (const mode of ['all', 'status', 'target']) {
    for (const key of i % 2 ? ['after', 'before'] : ['before', 'after']) {
      const start = performance.now();
      const result = await promisify(execFile)(binaries[key], [mode], {
        windowsHide: true,
        shell: false,
        timeout: 20000,
        maxBuffer: 16384,
      });
      const row = JSON.parse(result.stdout);
      assert.equal(row.metadataUnchanged, true);
      assert.equal(row.registeredCount, 32);
      if (key === 'after' && mode === 'status') assert.equal(row.iconCount, 0);
      if (key === 'after' && mode === 'target') assert.ok(row.iconCount <= 1);
      report.trials.push({ revision: key, trial: i, ...row, processMs: performance.now() - start });
    }
  }
  console.log(`Native discovery trial ${i + 1}/10`);
}
for (const key of ['before', 'after'])
  for (const mode of ['all', 'status', 'target']) {
    const rows = report.trials.filter((r) => r.revision === key && r.mode === mode);
    report.distributions[`${key}/${mode}`] = Object.fromEntries(
      ['durationMs', 'processMs', 'peakWorkingSetBytes', 'workingSetBytes'].map((field) => [
        field,
        distribution(rows.map((r) => r[field])),
      ]),
    );
  }
report.completedAt = new Date().toISOString();
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.distributions));
