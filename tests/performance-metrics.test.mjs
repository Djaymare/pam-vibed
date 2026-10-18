import test from 'node:test';
import assert from 'node:assert/strict';
import { distribution } from '../scripts/performance-metrics.mjs';
test('p50/p95 use nearest rank, preserve tails and do not mutate raw measurements', () => {
  const values = [100, ...Array.from({ length: 19 }, (_, i) => i + 1)];
  assert.deepEqual(distribution(values), { n: 20, min: 1, p50: 10, p95: 19, max: 100 });
  assert.equal(values[0], 100);
  assert.deepEqual(distribution([]), { n: 0 });
});
