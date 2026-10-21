import assert from 'node:assert/strict';

// Measure the same single proposed call whether Needle emits it or withholds it.
// Suppression never raises its raw score or authorizes an execution.
export function checkConfidenceBaseline(response, expectedName) {
  assert.ok(Array.isArray(response.function_calls), 'Baseline function_calls missing');
  const withheld = response.function_calls.length === 0 && Array.isArray(response.suppressed_calls)
    && response.suppressed_calls.length > 0;
  const calls = withheld ? response.suppressed_calls : response.function_calls;
  assert.equal(calls.length, 1, 'Baseline must propose exactly one call');
  assert.equal(calls[0].name, expectedName, 'Baseline must propose the expected action');
  assert.deepEqual(calls[0].arguments, {}, 'Baseline must not invent arguments');
  assert.ok(Number.isFinite(response.confidence) && response.confidence >= 0 && response.confidence <= 1,
    'Baseline confidence must be the finite raw model score');
  return { confidence: response.confidence, correct: true, withheld };
}
