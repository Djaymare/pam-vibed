import { computed } from 'vue';
import type { Profile } from './useProfile';
import type { Audio } from './useAudio';
import type { Requests } from './useRequests';
import type { Proposals } from './useProposals';

/** The same availability predicate controls the invitation and the submit buttons. */
export function useAssistantStatus(
  profile: Profile,
  audio: Audio,
  requests: Requests,
  proposals: Proposals,
  canRequest: () => boolean,
) {
  return computed(() => {
    const state = (label: string, title: string, detail: string) => ({ label, title, detail });
    if (audio.state.value === 'permission')
      return state(
        'AUTORISATION DU MICROPHONE',
        'Autorisez votre microphone',
        'Vous pouvez annuler avant tout enregistrement.',
      );
    if (audio.state.value === 'recording')
      return state(
        'MICROPHONE ACTIF',
        'Je vous écoute…',
        'Arrêtez pour envoyer, ou annulez pour supprimer cet enregistrement sans action.',
      );
    if (audio.state.value === 'cancelling')
      return state('ANNULATION', 'Arrêt du microphone…', 'Aucune nouvelle demande n’est envoyée.');
    if (requests.processing.value) {
      if (!requests.sent.value)
        return state(
          'PRÉPARATION AUDIO',
          'Préparation de l’enregistrement…',
          'Annulez maintenant pour ne pas envoyer cette demande.',
        );
      if (profile.supervisor.value?.activity === 'executing')
        return state(
          'EXÉCUTION',
          'Exécution de la demande…',
          'Une action a déjà été envoyée. Son annulation n’est plus garantie ; attendez le résultat avant de réessayer.',
        );
      return state(
        'TRAITEMENT LOCAL',
        requests.voiceProcessing.value
          ? 'Transcription et préparation de la demande…'
          : 'Préparation de la demande…',
        profile.config.value.autoExecute
          ? 'Demande envoyée. Des actions peuvent être exécutées automatiquement ; attendez le résultat avant de réessayer.'
          : 'Demande envoyée. Vérifiez ensuite la proposition avant de l’exécuter.',
      );
    }
    if (profile.busy.value) {
      const kind = profile.mutation.kind.value;
      if (kind === 'confirm')
        return state(
          'EXÉCUTION',
          'Exécution de la proposition…',
          'La confirmation a été envoyée. Une action peut déjà être effectuée ; attendez le résultat, sans renvoyer la demande.',
        );
      if (kind === 'discard')
        return state(
          'ANNULATION',
          'Retrait de la proposition…',
          'Aucune action n’est autorisée par cette annulation.',
        );
      if (kind === 'restart')
        return state(
          'REPRISE',
          'Rechargement des moteurs…',
          'Patientez avant une nouvelle demande.',
        );
      return state(
        'OPÉRATION EN COURS',
        'Mise à jour du profil…',
        'Une préférence ou une application est en cours de sauvegarde.',
      );
    }
    if (profile.loading.value)
      return state(
        'VÉRIFICATION',
        'Vérification du runtime…',
        'Patientez avant une nouvelle demande.',
      );
    if (!profile.runtimeReady.value)
      return state(
        'RUNTIME NON DISPONIBLE',
        profile.runtimeLabel.value,
        'Les demandes sont désactivées. Vérifiez les préférences ou réessayez après la reprise.',
      );
    if (!profile.activeApps.value.length)
      return state(
        'CONFIGURATION REQUISE',
        'Ajoutez une application',
        'Ajoutez une application pour activer les demandes.',
      );
    if (!canRequest())
      return state('EN ATTENTE', 'Patientez avant de parler', 'Une opération est encore en cours.');
    if (proposals.turns.value.some((turn) => turn.status === 'pending'))
      return state(
        'CONFIRMATION ATTENDUE',
        'Une proposition attend votre choix',
        'Exécutez ou annulez la proposition dans l’activité récente. Une nouvelle demande reste possible.',
      );
    if (profile.error.value)
      return state(
        'ÉCHEC RÉCUPÉRABLE',
        'La dernière demande a échoué',
        'Consultez le message d’erreur. Vérifiez les effets éventuels avant de réessayer.',
      );
    return state(
      'PRÊT À VOUS ÉCOUTER',
      'Appuyez pour parler',
      'Vous pouvez parler ou envoyer une demande écrite.',
    );
  });
}
