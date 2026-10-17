export const THRESHOLDS = [0.1, 0.3, 0.5, 0.7, 0.8, 0.9, 1];
export function baselineEligible(sample, threshold) {
  const inference = sample.engineReplies
    .map(JSON.parse)
    .findLast((r) => Array.isArray(r.function_calls));
  return (
    sample.calls.length > 0 &&
    sample.confidence !== null &&
    sample.confidence >= threshold &&
    inference?.function_calls?.length > 0 &&
    !inference.validation?.ungrounded?.length
  );
}
export function metrics(samples, automatic = (s) => s.status === 'executed') {
  const automaticSamples = samples.filter(automatic);
  const audio = samples.filter((s) => s.variant !== 'text');
  return {
    samples: samples.length,
    positiveRequests: samples.filter((s) => s.expected.length).length,
    negativeRequests: samples.filter((s) => !s.expected.length).length,
    automatic: automaticSamples.length,
    falseTriggers: automaticSamples.filter((s) => !s.expected.length).length,
    wrongAutomaticActions: automaticSamples.filter((s) => s.expected.length && !s.correct).length,
    confirmations: samples.filter((s) => s.calls.length && !automatic(s)).length,
    wrongProposals: samples.filter((s) => s.calls.length && !s.correct).length,
    refusals: samples.filter((s) => !s.calls.length).length,
    positiveRefusals: samples.filter((s) => s.expected.length && !s.calls.length).length,
    exactPlans: samples.filter((s) => s.correct).length,
    validationErrors: samples.filter((s) => s.status === 'error').length,
    wordErrors: audio.reduce((sum, s) => sum + s.wordErrors, 0),
    referenceWords: audio.reduce((sum, s) => sum + s.referenceWords, 0),
    transcriptionExact: audio.filter((s) => s.wordErrors === 0).length,
  };
}
export function summarize(report) {
  const { samples } = report;
  const by = (key) =>
    Object.fromEntries(
      [...new Set(samples.map((s) => s[key]))].map((value) => [
        value,
        metrics(samples.filter((s) => s[key] === value)),
      ]),
    );
  return {
    total: metrics(samples),
    byVariant: by('variant'),
    byCategory: by('category'),
    byLanguage: by('language'),
    thresholdSweep: THRESHOLDS.map((threshold) => ({
      threshold,
      ...metrics(samples, (s) => baselineEligible(s, threshold)),
    })),
  };
}
