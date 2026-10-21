import test from 'node:test';
import assert from 'node:assert/strict';
import { checkConfidenceBaseline } from '../scripts/confidence-baseline.mjs';
const call = { name: 'legacy_play', arguments: {} };

test('confidence baseline measures an emitted call without changing its score', () => {
  assert.deepEqual(checkConfidenceBaseline({ function_calls: [call], confidence: 0.2346 }, call.name),
    { confidence: 0.2346, correct: true, withheld: false });
});

test('confidence baseline also measures a withheld call without promoting it to execution', () => {
  const response = { function_calls: [], suppressed_calls: [call], confidence: 0.08 };
  const original = structuredClone(response);
  assert.deepEqual(checkConfidenceBaseline(response, call.name), { confidence: 0.08, correct: true, withheld: true });
  assert.deepEqual(response, original);
});

test('confidence baseline still rejects refusal, wrong actions, extra calls and invented arguments', () => {
  for (const calls of [[], [{ ...call, name: 'other' }], [call, call], [{ ...call, arguments: { input: 'invented' } }]]) {
    for (const withheld of [false, true]) {
      const response = { function_calls: withheld ? [] : calls, confidence: 0.08,
        ...(withheld ? { suppressed_calls: calls } : {}) };
      assert.throws(() => checkConfidenceBaseline(response, call.name));
    }
  }
});

test('confidence baseline rejects absent, non-finite or out-of-range raw scores', () => {
  for (const confidence of [undefined, null, NaN, Infinity, -0.1, 1.1])
    assert.throws(() => checkConfidenceBaseline({ function_calls: [call], confidence }, call.name));
});
