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
  const correctionStage = ref<'editing' | 'memorization' | 'inference'>('editing');
  const correctionSaved = ref(false);
  const correctionInitial = ref('');
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
  const correctionDirty = computed(
    () => !!correction.value && JSON.stringify(correctionForm) !== correctionInitial.value,
  );
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
    correctionStage.value = 'editing';
    correctionSaved.value = false;
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
    correctionInitial.value = JSON.stringify(correctionForm);
  }
  async function correctTurn() {
    if (!correction.value || isLocked()) return;
    const original = correction.value;
    let prepared = false;
    const token = beginMutation('correct_request');
    if (!token) return;
    const current = () => token.current() && correction.value === original;
    correctionError.value = '';
    // These are observations of the persisted profile, not an alternative
    // validation or write path. The sidecar retains all correction checks.
    const normalize = (text: string) =>
      text
        .normalize('NFKD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .replace(/’/g, "'")
        .trim()
        .replace(/[.!?]+$/u, '')
        .trim()
        .replace(/\s+/g, ' ');
    const learnAlias =
      correctionForm.saveAlias &&
      !!correctionApp.value &&
      (!correctionForm.action || correctionForm.action === 'open');
    const learnCommand =
      correctionForm.saveCommandAlias && !!correctionApp.value && !!correctionForm.action;
    function observedLearning() {
      const app = config.value.applications.find((app) => app.id === correctionForm.applicationId);
      const alias =
        !!app &&
        [app.name, ...app.aliases].some(
          (value) => normalize(value) === normalize(correctionForm.alias),
        );
      const existing = (config.value.commandAliases || []).find(
        (alias) => normalize(alias.phrase) === normalize(correctionForm.commandPhrase),
      );
      const args = correctionChoice.value?.action.startsWith('deezer_')
        ? choiceArguments(correctionChoice.value, correctionForm.arguments)
        : {};
      const sameArgs = (a: Record<string, string> = {}, b: Record<string, string> = {}) =>
        Object.keys({ ...a, ...b }).every((key) => a[key] === b[key]);
      const command =
        !!existing &&
        existing.applicationId === app?.id &&
        existing.action === correctionChoice.value?.action &&
        sameArgs(existing.arguments, args);
      correctionSaved.value = (learnAlias && alias) || (learnCommand && command);
      return { alias, command };
    }
    async function reconcileLearning() {
      const fresh = await request('status');
      if (!current()) return;
      config.value = fresh.config;
      status.value = fresh;
      return observedLearning();
    }
    try {
      let saveAlias = learnAlias,
        saveCommandAlias = learnCommand;
      if (learnAlias || learnCommand) {
        correctionStage.value = 'memorization';
        const observed = await reconcileLearning();
        if (!observed || !current()) return;
        saveAlias = learnAlias && !observed.alias;
        saveCommandAlias = learnCommand && !observed.command;
      }
      correctionStage.value = saveAlias || saveCommandAlias ? 'memorization' : 'inference';
      const turn = await request('correct_request', {
        id: original.id,
        text: correctionForm.text.trim(),
        applicationId: correctionForm.applicationId || undefined,
        input: correctionInput.value ? correctionForm.input : undefined,
        action: correctionChoice.value?.action,
        arguments: correctionChoice.value
          ? choiceArguments(correctionChoice.value, correctionForm.arguments)
          : undefined,
        saveAlias,
        alias: correctionForm.alias,
        saveCommandAlias,
        commandPhrase: correctionForm.commandPhrase,
      });
      if (!current()) return;
      if (turn.status === 'failed' || turn.status === 'partial')
        throw new Error(
          turn.error ? describeError(turn.error) : turn.message || 'La préparation a échoué.',
        );
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
        if (learnAlias || learnCommand) {
          try {
            await reconcileLearning();
          } catch {
            if (current())
              correctionError.value +=
                ' La mémorisation reste à vérifier ; toute reprise relira le profil avant de poursuivre.';
          }
        }
        if (current()) correctionStage.value = correctionSaved.value ? 'inference' : 'editing';
      }
    } finally {
      if (prepared && current()) correction.value = undefined;
      token.finish();
      void updateHealth();
    }
  }
  async function resolveTurn(turn: Turn, accept: boolean) {
    if (isLocked() || (accept && !profile.runtimeReady.value)) return;
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
    correctionStage,
    correctionSaved,
    correctionDirty,
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
