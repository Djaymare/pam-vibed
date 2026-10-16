import { actionDefinitions, actionParameters, actionRegistry } from './actions';
import type { ActionCall, ActionResult, Config, Turn } from './types';

export function confirmationReason(turn: Turn, config: Config): string {
  if (turn.correctedFrom) return 'Une demande corrigée doit être validée à nouveau.';
  if (turn.confidence === null)
    return 'Une action choisie dans les commandes du lecteur nécessite votre validation.';
  if (!config.autoExecute) return 'L’exécution automatique est désactivée dans vos préférences.';
  if (turn.confidence < config.confidenceThreshold)
    return 'La confiance du choix est inférieure au seuil d’exécution automatique.';
  return 'Cette proposition nécessite une vérification avant toute commande à l’application.';
}
export function callPresentation(call: ActionCall) {
  const action = call.action || 'open';
  const definition = actionDefinitions[action];
  const fields = actionParameters(action);
  return {
    label: call.actionLabel || definition.label,
    target: call.applicationName,
    effect: definition.expectedEffect,
    parameters: Object.entries(call.arguments).map(([key, value]) => {
      const field = fields[key];
      const options: Record<string, { label: string }> | undefined = field?.options
        ? actionRegistry.options[field.options]
        : undefined;
      return { key, label: field?.label || key, value: options?.[value]?.label || value };
    }),
  };
}
export function resultLabel(result: ActionResult): string {
  if (result.outcome === 'not_started') return 'Commande non démarrée';
  if (result.outcome === 'unknown') return 'Commande émise · issue inconnue';
  if (result.outcome === 'failed' || !result.success) return 'Échec de la commande';
  return result.details?.accepted === true ? 'Commande acceptée' : 'Commande envoyée';
}
export function observedState(result: ActionResult): string {
  const details = result.details;
  const after = details?.after as
    { sourceAppId?: string; playbackStatus?: string; title?: string; error?: string } | undefined;
  if (
    !details?.accepted ||
    !after ||
    typeof after !== 'object' ||
    after.error ||
    typeof details.sourceAppId !== 'string' ||
    typeof after.sourceAppId !== 'string' ||
    after.sourceAppId.toLowerCase() !== details.sourceAppId.toLowerCase()
  )
    return '';
  const labels: Record<string, string> = {
    Lecture: 'lecture',
    Pause: 'pause',
    Arrêt: 'arrêt',
    Fermée: 'fermé',
    Ouverte: 'ouvert',
    Transition: 'changement en cours',
    Playing: 'lecture',
    Paused: 'pause',
    Stopped: 'arrêt',
    Closed: 'fermé',
    Opened: 'ouvert',
    Changing: 'changement en cours',
  };
  const state = typeof after.playbackStatus === 'string' && labels[after.playbackStatus];
  return state
    ? `État observé dans la session Windows après la commande : ${state}${typeof after.title === 'string' && after.title ? ' · ' + after.title : ''}. Cette observation ne prouve pas que la commande en est la cause ni qu’un son est audible.`
    : '';
}
export function turnLabel(turn: Turn): string {
  const labels: Record<Turn['status'], string> = {
    executed: 'Commandes envoyées',
    pending: 'À valider',
    unsupported: 'Aucune action disponible',
    silence: 'Aucune parole détectée',
    failed: 'Échec de l’action',
    cancelled: 'Annulé',
    partial: 'Exécution interrompue',
    expired: 'Proposition expirée',
    invalidated: 'Proposition retirée',
    consumed: 'Confirmation consommée',
  };
  return labels[turn.status];
}
