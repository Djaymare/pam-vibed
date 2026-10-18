// Needle 3's pinned context. Request bytes deliberately upper-bound tokens;
// prefixTokens is the actual count returned by needle_init (system + tools).
const CONTEXT = 8192;
const REPLY = 256;
const FRAMING = 32;
// A measured 56-tool rich catalogue exhausted the 40 s request budget.
// This product bound is separate from token capacity and is not a latency SLA.
const MAX_TOOLS = 32;
function requireToolLimit(tools) {
  if (tools.length <= MAX_TOOLS) return;
  const error = new Error(
    'Le catalogue propose plus de 32 outils pour une demande. Nommez une application et une action précises, ou désactivez des applications. Les 32 applications enregistrées ne garantissent pas que tous leurs outils puissent être proposés ensemble.',
  );
  error.code = 'catalog_capacity';
  throw error;
}
function contextBudget(prefixTokens, text, tools = []) {
  if (!Number.isInteger(prefixTokens) || prefixTokens < 0) throw Error('Préfixe Needle invalide.');
  const requestUpperBound = Buffer.byteLength(text, 'utf8');
  const availableRequestTokens = Math.max(0, CONTEXT - prefixTokens - REPLY - FRAMING);
  return {
    contextTokens: CONTEXT,
    prefixTokens,
    requestUpperBound,
    replyTokens: REPLY,
    framingTokens: FRAMING,
    availableRequestTokens,
    toolCount: tools.length,
    toolsBytes: Buffer.byteLength(JSON.stringify(tools), 'utf8'),
    maxTools: MAX_TOOLS,
    contextFits: prefixTokens + requestUpperBound + REPLY + FRAMING <= CONTEXT,
    fits:
      tools.length <= MAX_TOOLS && prefixTokens + requestUpperBound + REPLY + FRAMING <= CONTEXT,
  };
}
function capacityError(budget, catalog = budget.prefixTokens + REPLY + FRAMING >= CONTEXT) {
  const error = new Error(
    catalog
      ? 'Le catalogue d’outils et ses descriptions occupent le contexte du modèle (8 192 tokens). Nommez une application et une action précises, ou désactivez des applications et raccourcissez leurs descriptions et alias.'
      : 'La demande avec les outils sélectionnés dépasse le contexte du modèle (8 192 tokens). Précisez une application et une action pour réduire les outils proposés, ou raccourcissez la demande.',
  );
  error.code = catalog ? 'catalog_capacity' : 'request_capacity';
  return error;
}
function requireCapacity(budget) {
  requireToolLimit({ length: budget.toolCount });
  if (!budget.fits) throw capacityError(budget);
  return budget;
}
module.exports = {
  CONTEXT,
  REPLY,
  FRAMING,
  MAX_TOOLS,
  contextBudget,
  capacityError,
  requireCapacity,
  requireToolLimit,
};
