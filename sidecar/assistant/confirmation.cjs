// Score Needle: choix d'un appel, jamais fidélité de la transcription.
// Unknown effects and parameters fail closed to the existing one-shot proposal.
function confirmationReason(method, turn, config, { suppressed, ungrounded, tools }) {
  if (method === 'correct_request') return 'Vérifiez la correction avant de confirmer.';
  if (!config.autoExecute) return 'L’exécution automatique est désactivée.';
  if (method !== 'process_text')
    return 'Vérifiez la transcription et l’action avant de confirmer. Le score Needle ne mesure pas la fidélité de la transcription.';
  if (suppressed || ungrounded)
    return 'Le moteur demande une vérification des paramètres ou du choix.';
  if (!Number.isFinite(turn.confidence) || turn.confidence < config.confidenceThreshold)
    return 'Le score du choix est inférieur au seuil configuré.';
  if (turn.calls.length !== 1) return 'Confirmez ensemble les actions de cette demande composée.';
  const call = turn.calls[0];
  const app = config.applications.find((a) => a.enabled && a.id === call.applicationId);
  const action = call.action || 'open';
  if (!app || !['open', 'media_play', 'media_pause'].includes(action))
    return 'Cette action demande toujours une confirmation.';
  if (action === 'open' && (app.arguments.length || Object.values(call.arguments).some(Boolean)))
    return 'Vérifiez les arguments transmis à l’application avant de confirmer.';
  const literal = tools.find((t) => t.applicationId === app.id && t.action === action);
  if (!literal?.triggers.some((pattern) => new RegExp(pattern, 'iu').test(turn.transcript)))
    return 'Vérifiez cette formulation avant de confirmer son interprétation.';
  return null;
}
module.exports = { confirmationReason };
