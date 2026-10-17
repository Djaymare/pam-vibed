import test from 'node:test';
import assert from 'node:assert/strict';
import { metrics, baselineEligible } from '../scripts/execution-metrics.mjs';
import { summarize } from '../scripts/execution-metrics.mjs';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

test('frozen measured reports retain every case, error and independently labelled plan', () => {
  const source = readFileSync('tests/fixtures/execution-corpus.json', 'utf8');
  const corpus = JSON.parse(source);
  const hash = createHash('sha256').update(source.replace(/\r\n/g, '\n')).digest('hex');
  assert.equal(hash, 'f09549a56e240e312a819f868880717d1a2978401fdc885cc71b10eedb6b15ad');
  assert.equal(
    new Set(Object.values(corpus.splits).flatMap((s) => s.cases.map((c) => c[3]))).size,
    60,
  );
  for (const name of ['calibration-baseline', 'calibration-policy', 'heldout-policy']) {
    const report = JSON.parse(readFileSync(`docs/evaluation/execution-${name}.json`));
    assert.equal(report.corpusSha256, hash);
    assert.equal(report.completed, true);
    assert.equal(report.samples.length, 90);
    assert.equal(new Set(report.samples.map((s) => s.key)).size, 90);
    const labels = new Map(
      corpus.splits[report.split].cases.map(([id, language, category, reference, expected]) => [
        id,
        { language, category, reference, expected },
      ]),
    );
    for (const sample of report.samples) {
      const label = labels.get(sample.id);
      for (const key of ['language', 'category', 'reference', 'expected'])
        assert.deepEqual(sample[key], label[key]);
      assert.equal(sample.correct, isDeepStrictEqual(sample.calls, sample.expected));
      if (sample.variant !== 'text') assert.match(sample.audioSha256, /^[a-f0-9]{64}$/);
    }
    assert.deepEqual(summarize(report), report.summary);
    assert.equal(report.summary.total.falseTriggers, 0);
    assert.equal(report.summary.total.wrongAutomaticActions, 0);
  }
});
test('metrics distinguish negative triggers, wrong positive actions, refusals, proposals and WER', () => {
  const sample = {
    expected: [],
    calls: [],
    correct: true,
    status: 'unsupported',
    variant: 'text',
    confidence: 0.9,
    engineReplies: [JSON.stringify({ function_calls: [{}] })],
  };
  const values = [
    { ...sample, calls: [{}], correct: false, status: 'executed' },
    { ...sample, expected: [{}], calls: [{}], correct: false, status: 'executed' },
    {
      ...sample,
      expected: [{}],
      calls: [{}],
      correct: true,
      status: 'pending',
      variant: 'noise',
      wordErrors: 2,
      referenceWords: 4,
    },
    { ...sample, expected: [{}], correct: false },
    sample,
  ];
  const result = metrics(values);
  assert.equal(result.samples, 5);
  assert.equal(result.falseTriggers, 1);
  assert.equal(result.wrongAutomaticActions, 1);
  assert.equal(result.confirmations, 1);
  assert.equal(result.wrongProposals, 2);
  assert.equal(result.positiveRefusals, 1);
  assert.equal(result.wordErrors / result.referenceWords, 0.5);
  assert.equal(baselineEligible({ ...sample, calls: [{}] }, 0.9), true);
  assert.equal(baselineEligible({ ...sample, calls: [{}] }, 1), false);
  for (const response of [
    { function_calls: [], suppressed_calls: [{}] },
    { function_calls: [{}], validation: { ungrounded: ['input'] } },
  ])
    assert.equal(
      baselineEligible({ ...sample, calls: [{}], engineReplies: [JSON.stringify(response)] }, 0.1),
      false,
    );
});
