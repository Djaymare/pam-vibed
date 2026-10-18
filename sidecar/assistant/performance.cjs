const { performance } = require('node:perf_hooks');
const stages = new Set(['discovery', 'warmup', 'transcription', 'routing', 'effect']);
// Opt-in observer only. Payloads, paths, app names, transcripts and native output
// never enter this channel; an observer cannot alter the operation's outcome.
async function measure(context, stage, work) {
  const start = performance.now();
  let success = false;
  try {
    const result = await work();
    success = true;
    return result;
  } finally {
    if (stages.has(stage)) {
      try {
        context?.onPerformance?.({ stage, durationMs: performance.now() - start, success });
      } catch {}
    }
  }
}
module.exports = { measure };
