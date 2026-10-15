const { randomUUID } = require('node:crypto');
const catalog = require('./error-catalog.json');
const stages = new Set(['inference','transcription','microphone','target','transport','queue','profile','validation','sidecar','diagnostics','start','write','response','host']);
function requestId(value) { return typeof value === 'string' && /^(?:pam-\d{1,20}-\d{1,10}-\d{1,20}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.test(value) ? value : randomUUID(); }
function envelope(code, id, stage) {
  if (!Object.hasOwn(catalog, code)) code = 'invalid_request';
  return { code, ...catalog[code], requestId: requestId(id), ...(stages.has(stage) ? {stage} : {}), technical: { category: code } };
}
function classify(error, fallback = 'invalid_request') {
  if (error?.diagnostic && Object.hasOwn(catalog, error.diagnostic.code)) return error.diagnostic.code;
  if (error?.code === 'invalid_profile') return 'invalid_profile';
  if (error?.code === 'budget_expired' || error?.outcome === 'unknown' || /timeout|délai|timed out/i.test(error?.message ?? '')) return 'request_timeout';
  if (/hôte natif/i.test(error?.message ?? '')) return 'transport_unavailable';
  if (fallback === 'target_missing' || (fallback === 'action_failure' && error?.code === 'ENOENT') || /introuvable|désinstall|(?:cible|exécutable).*(?:indisponible|disparu)/i.test(error?.message ?? '')) return 'target_missing';
  if (['ENOENT','EACCES','EPERM','ENOSPC','EIO'].includes(error?.code)) return fallback === 'invalid_request' ? 'profile_io' : fallback;
  return fallback;
}
function failure(error, context = {}, fallback = 'invalid_request', stage) {
  const result = envelope(classify(error, fallback), context.requestId, error?.diagnostic?.stage ?? stage);
  // Only this closed schema crosses the diagnostic channel. Never spread errors,
  // payloads, stderr, engine output, profile values or command arguments here.
  context.onDiagnostic?.(result);
  return result;
}
function annotate(error, context, fallback, stage) {
  if (!(error instanceof Error)) error = new Error('Opération locale échouée.');
  error.diagnostic = failure(error, context, fallback, stage);
  return error;
}
function maskMessage(message) {
  return String(message).replace(/(?:[a-zA-Z]:[\\/]|\\\\)[^\r\n"<>]+|\/(?:home|Users|tmp|var)\/[^\r\n"<>]+/g, '[chemin masqué]');
}
module.exports = { catalog, envelope, requestId, failure, annotate, maskMessage };
