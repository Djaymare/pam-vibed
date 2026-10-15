import { computed, ref, reactive, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import type { RuntimeStatus, Turn } from '../types';

import { retainTurns, reconcileTurns } from '../proposals';
import { commandActions, choiceArguments } from '../actions';
import { describeError } from '../errors';
import type { Profile } from './useProfile';
/** useProposals owns its state and releases its subscriptions at component unmount. */
export function useProposals(
  profile: Profile,
  isLocked: () => boolean,
  rememberDialogTrigger: () => void,
) {
  const { request, error, config, status, activeApps, updateHealth, beginMutation, scope } =
    profile;
  const turns = ref<Turn[]>([]);
  const correction = ref<Turn>();
  const correctionError = ref('');
  scope.onInvalidate(() => {
    correction.value = undefined;
    correctionError.value = '';
  });
  const correctionForm = reactive({
    text: '',
    applicationId: '',
    action: '',
    input: '',
    arguments: {} as Record<string, string>,
    saveAlias: false,
    alias: '',
    saveCommandAlias: false,
    commandPhrase: '',
  });
  const correctionApp = computed(() =>
    activeApps.value.find((app) => app.id === correctionForm.applicationId),
  );
  const correctionActions = computed(() => commandActions(correctionApp.value));
  const correctionChoice = computed(() =>
    correctionActions.value.find((choice) => choice.key === correctionForm.action),
  );
  const correctionInput = computed(
    () =>
      (!correctionForm.action || correctionForm.action === 'open') &&
      correctionApp.value?.arguments.some((arg) => arg.includes('{input}')),
  );
  function editTurn(turn: Turn) {
    if (isLocked()) return;
    rememberDialogTrigger();
    correction.value = turn;
    correctionError.value = '';
    Object.assign(correctionForm, {
      text: turn.transcript,
      applicationId: turn.calls[0]?.applicationId || '',
      action: '',
      input: turn.calls[0]?.arguments.input || '',
      saveAlias: false,
      saveCommandAlias: false,
      commandPhrase: turn.transcript,
      arguments: { ...turn.calls[0]?.arguments },
      alias: turn.transcript
        .replace(
          /^(?:ouvre|ouvrez|lance|lancez|démarre|open|launch|start)\s+(?:l['’]|(?:le|la|the)\s+)?/i,
          '',
        )
        .replace(/[.!?]+$/, '')
        .trim()
        .slice(0, 40),
    });
  }
  async function correctTurn() {
    if (!correction.value || isLocked()) return;
    const original = correction.value;
    let prepared = false;
    const token = beginMutation('correct_request');
    if (!token) return;
    const current = () => token.current() && correction.value === original;
    correctionError.value = '';
    try {
      const turn = await request('correct_request', {
        id: original.id,
        text: correctionForm.text.trim(),
        applicationId: correctionForm.applicationId || undefined,
        input: correctionInput.value ? correctionForm.input : undefined,
        action: correctionChoice.value?.action,
        arguments: correctionChoice.value
          ? choiceArguments(correctionChoice.value, correctionForm.arguments)
          : undefined,
        saveAlias:
          correctionForm.saveAlias &&
          !!correctionApp.value &&
          (!correctionForm.action || correctionForm.action === 'open'),
        alias: correctionForm.alias,
        saveCommandAlias:
          correctionForm.saveCommandAlias && !!correctionApp.value && !!correctionForm.action,
        commandPhrase: correctionForm.commandPhrase,
      });
      if (!current()) return;
      prepared = true;
      try {
        const next = await request('status');
        if (!current()) return;
        status.value = next;
        config.value = next.config;
      } catch (caught) {
        if (current()) error.value = describeError(caught);
      }
      await nextTick();
      if (!current()) return;
      turns.value = retainTurns([
        turn,
        ...turns.value.map((item) =>
          item.id === original.id && item.status === 'pending'
            ? {
                ...item,
                status: 'invalidated' as const,
                message: 'Cette proposition a été remplacée par une correction.',
              }
            : item,
        ),
      ]);
    } catch (caught) {
      if (current()) {
        token.fail();
        correctionError.value = describeError(caught);
      }
    } finally {
      if (prepared && current()) correction.value = undefined;
      token.finish();
      void updateHealth();
    }
  }
  async function resolveTurn(turn: Turn, accept: boolean) {
    if (isLocked()) return;
    turns.value = reconcileTurns(turns.value);
    if (turns.value.find((item) => item.id === turn.id)?.status !== 'pending') return;
    const token = beginMutation(accept ? 'confirm' : 'discard');
    if (!token) return;
    error.value = '';
    try {
      const updated = await request(accept ? 'confirm' : 'discard', { id: turn.id });
      if (!token.current()) return;
      turns.value = turns.value.map((item) =>
        item.id === turn.id ? { ...item, ...updated } : item,
      );
    } catch (caught) {
      if (token.current()) {
        token.fail();
        error.value = describeError(caught);
      }
    } finally {
      token.finish();
      void updateHealth();
    }
  }
  const labels: Record<Turn['status'], string> = {
    executed: 'Terminé',
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
  const outcomeLabels = {
    not_started: 'Non démarrée',
    performed: 'Effectuée',
    failed: 'Échouée',
    unknown: 'Résultat inconnu',
  };
  watch(correctionActions, (values) => {
    if (correctionForm.action && !values.some((choice) => choice.key === correctionForm.action))
      correctionForm.action = '';
  });
  watch(
    () => JSON.stringify([config.value.applications, config.value.commandAliases || []]),
    (next, previous) => {
      if (next === previous) return;
      turns.value = turns.value.map((turn) =>
        turn.status === 'pending'
          ? {
              ...turn,
              status: 'invalidated',
              proposal: {
                createdAt: null,
                expiresAt: null,
                ...turn.proposal,
                state: 'invalidated',
                reason: 'configuration_changed',
              },
              message: 'Les applications ou formulations ont changé. Reformulez votre demande.',
            }
          : turn,
      );
    },
  );
  function reconcile(proposals?: RuntimeStatus['proposals']) {
    turns.value = reconcileTurns(turns.value, proposals);
  }
  function add(turn: Turn) {
    turns.value = retainTurns([turn, ...reconcileTurns(turns.value)]);
  }
  let timer: number | undefined;
  onMounted(() => {
    timer = window.setInterval(() => reconcile(), 1000);
  });
  onBeforeUnmount(() => window.clearInterval(timer));
  return {
    turns,
    correction,
    correctionError,
    correctionForm,
    correctionApp,
    correctionActions,
    correctionChoice,
    correctionInput,
    editTurn,
    correctTurn,
    resolveTurn,
    labels,
    outcomeLabels,
    reconcile,
    add,
  };
}
export type Proposals = ReturnType<typeof useProposals>;
