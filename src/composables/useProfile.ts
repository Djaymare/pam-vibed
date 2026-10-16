import { computed, ref, reactive, watch, onMounted, onBeforeUnmount } from 'vue';
import type { Application, CommandAlias, Config, RuntimeStatus } from '../types';
import type { Method, Methods, SupervisorStatus } from '../contracts.generated';
import { isTauri } from '@tauri-apps/api/core';
import { describeError } from '../errors';
import type { RequestFunction } from '../ipc';
import { useAsyncScope, type OperationToken } from './useAsyncScope';
import {
  deletionScope,
  deletionFingerprint,
  type DeletionScope,
  type DeletionKind,
} from '../deletion';

export function useProfile(
  request: RequestFunction,
  isLocked: () => boolean,
  onStatus: (value: RuntimeStatus) => void,
  context?: () => unknown,
) {
  const scope = useAsyncScope(context);
  const mutation = scope.operation(),
    health = scope.operation('latest'),
    diagnostics = scope.operation();
  const busy = mutation.pending;
  const loading = computed(() => health.pending.value && health.kind.value === 'refresh');
  const status = ref<RuntimeStatus>();
  const statusAvailable = ref(false);
  const supervisor = ref<SupervisorStatus>();
  const supervision = scope.operation();
  const runtimeReady = computed(
    () => !!status.value?.ready && supervisor.value?.phase === 'ready' && statusAvailable.value,
  );
  const runtimeLabel = computed(() => {
    const phase = supervisor.value?.phase;
    if (phase === 'recovering') return 'Moteurs en reprise';
    if (phase === 'starting' || (!status.value && health.state.value !== 'error'))
      return 'Démarrage des moteurs';
    if (phase === 'stopping') return 'Arrêt des moteurs';
    if (phase === 'stopped') return 'Moteurs arrêtés';
    if (!runtimeReady.value) return 'Runtime indisponible';
    return status.value?.engine?.loaded ? 'Moteurs en mémoire' : 'Moteurs disponibles';
  });
  async function updateSupervisor() {
    const token = supervision.begin();
    if (!token) return;
    try {
      const next = await request('supervisor_status');
      if (token.current()) supervisor.value = next;
    } catch {
      if (token.current()) {
        token.fail();
        supervisor.value = undefined;
      }
    } finally {
      token.finish();
    }
  }
  const config = ref<Config>({
    version: 2,
    applications: [],
    commandAliases: [],
    language: 'fr',
    autoExecute: true,
    confidenceThreshold: 0.7,
  });
  const error = ref(''),
    diagnosticExport = ref(''),
    recoveryOpen = ref(false),
    recoveryBackup = ref('');
  const deletion = ref<DeletionScope>();
  const deletionError = ref('');
  const deletionNotice = ref('');
  const deleting = computed(() => mutation.pending.value && mutation.kind.value === 'delete');
  let deletionSent = false;
  const settingsOf = (value: Config) => ({
    language: value.language,
    autoExecute: value.autoExecute,
    confidenceThreshold: Number(value.confidenceThreshold),
  });
  const settingsDraft = reactive(settingsOf(config.value));
  const settingsInitial = ref(JSON.stringify(settingsDraft));
  const settingsDirty = computed(() => JSON.stringify(settingsDraft) !== settingsInitial.value);
  const settingsError = ref('');
  watch(config, (value) => {
    if (!settingsDirty.value) {
      Object.assign(settingsDraft, settingsOf(value));
      settingsInitial.value = JSON.stringify(settingsDraft);
    }
  });
  const recoveryChoice = ref<RuntimeStatus['profileBackup']>();
  scope.onInvalidate(() => {
    recoveryOpen.value = false;
    diagnosticExport.value = '';
    if (deleting.value && deletionSent)
      deletionNotice.value =
        'La suppression a déjà été envoyée. Son annulation est impossible ; actualisez le profil pour vérifier le résultat.';
    deletion.value = undefined;
  });
  function beginMutation(kind: string) {
    const token = mutation.begin(kind);
    if (token) health.cancel();
    return token;
  }
  async function fetchStatus(mode: 'refresh' | 'health', parent?: OperationToken) {
    if (parent && !parent.current()) return;
    const token = health.begin(mode);
    if (!token) return;
    if (mode === 'refresh') error.value = '';
    try {
      const next = await request('status');
      if (!token.current() || (parent && !parent.current())) return;
      if (mode === 'refresh' || !status.value || next.configError || status.value?.configError)
        config.value = next.config;
      status.value = next;
      statusAvailable.value = true;
      onStatus(next);
    } catch (caught) {
      if (token.current() && (!parent || parent.current())) {
        statusAvailable.value = false;
        token.fail();
        error.value = describeError(caught);
      }
    } finally {
      token.finish();
    }
  }
  const refresh = () => (busy.value ? Promise.resolve() : fetchStatus('refresh'));
  async function updateHealth() {
    if (isLocked() || busy.value || health.pending.value || !isTauri()) return;
    await fetchStatus('health');
  }
  async function exportDiagnostics() {
    const token = diagnostics.begin('export');
    if (!token) return;
    error.value = '';
    diagnosticExport.value = '';
    try {
      const result = await request('export_diagnostics');
      if (token.current()) diagnosticExport.value = JSON.stringify(result, null, 2);
    } catch (caught) {
      if (token.current()) {
        token.fail();
        error.value = describeError(caught);
      }
    } finally {
      token.finish();
    }
  }
  function beginRecovery() {
    if (isLocked()) return;
    const details = status.value?.configError ?? status.value?.profileBackup;
    if (!details?.fingerprint) return;
    recoveryChoice.value = {
      fingerprint: details.fingerprint,
      backupFingerprint: details.backupFingerprint ?? '',
      backupSummary: details.backupSummary ?? {
        applications: [],
        formulations: 0,
        language: 'fr',
        autoExecute: true,
        confidenceThreshold: 0.7,
      },
    };
    recoveryOpen.value = true;
  }
  async function profileRequest<M extends Method>(
    method: M,
    payload?: Methods[M]['payload'],
  ): Promise<Methods[M]['result']> {
    const token = beginMutation(method);
    if (!token) throw new Error('Une opération est déjà en cours.');
    try {
      const result = await request(method, payload);
      if (!token.current()) throw new Error('Opération interrompue après navigation.');
      if (method === 'import_config') {
        config.value = (result as { config: Config }).config;
        recoveryOpen.value = false;
        await fetchStatus('refresh', token);
      }
      return result;
    } catch (caught) {
      token.fail();
      throw caught;
    } finally {
      token.finish();
    }
  }
  async function recoverProfile(restoreBackup = false) {
    const fingerprint = recoveryChoice.value?.fingerprint;
    if (!fingerprint || isLocked()) return;
    const token = beginMutation('recover');
    if (!token) return;
    error.value = '';
    try {
      const result = await request('recover_config', {
        confirmed: true,
        fingerprint,
        ...(restoreBackup
          ? { restoreBackup: true, backupFingerprint: recoveryChoice.value?.backupFingerprint }
          : {}),
      });
      if (!token.current()) return;
      config.value = result.config;
      recoveryBackup.value = result.backupPath;
      recoveryOpen.value = false;
      await fetchStatus('refresh', token);
    } catch (caught) {
      if (!token.current()) return;
      token.fail();
      recoveryOpen.value = false;
      await fetchStatus('refresh', token);
      if (token.current()) error.value = describeError(caught);
    } finally {
      token.finish();
    }
  }
  async function restartEngine() {
    if (isLocked()) return;
    const token = beginMutation('restart');
    if (!token) return;
    error.value = '';
    try {
      await request('restart_engine');
      await fetchStatus('refresh', token);
    } catch (caught) {
      if (token.current()) {
        token.fail();
        error.value = describeError(caught);
      }
    } finally {
      token.finish();
    }
  }
  async function changeConfig<
    M extends
      | 'settings'
      | 'set_application_enabled'
      | 'delete_application'
      | 'save_command_alias'
      | 'delete_command_alias',
  >(method: M, payload: Methods[M]['payload'], propagate = false) {
    if (isLocked()) return;
    const token = beginMutation(method);
    if (!token) return;
    error.value = '';
    try {
      const next = await request(method, payload);
      if (token.current()) {
        config.value = next;
        return true;
      }
    } catch (caught) {
      if (!token.current()) return;
      token.fail();
      if (method === 'settings') await fetchStatus('refresh', token);
      if (token.current()) {
        if (propagate) throw caught;
        error.value = describeError(caught);
      }
    } finally {
      token.finish();
      void updateHealth();
    }
  }
  const toggleApplication = (application: Application) =>
    changeConfig('set_application_enabled', { id: application.id, enabled: !application.enabled });
  function requestDeletion(kind: DeletionKind, id: string) {
    if (isLocked() || busy.value || deletion.value) return;
    try {
      deletion.value = deletionScope(config.value, kind, id);
      deletionError.value = '';
      deletionNotice.value = '';
    } catch (caught) {
      error.value = describeError(caught);
    }
  }
  function cancelDeletion() {
    // Once sent, cancellation cannot roll back a persisted delete.
    if (deleting.value) return;
    deletion.value = undefined;
    deletionError.value = '';
  }
  async function confirmDeletion() {
    const selected = deletion.value;
    if (!selected || isLocked() || busy.value || deletionError.value) return;
    const token = beginMutation('delete');
    if (!token) return;
    deletionSent = false;
    deletionError.value = '';
    try {
      const expectedFingerprint = await deletionFingerprint(selected);
      if (!token.current()) return;
      deletionSent = true;
      const next = await request(
        selected.kind === 'application' ? 'delete_application' : 'delete_command_alias',
        { id: selected.id, expectedFingerprint },
      );
      if (token.current()) {
        config.value = next;
        deletion.value = undefined;
        deletionNotice.value =
          selected.kind === 'application'
            ? `${selected.application.name} et ${selected.aliases.length} formulation(s) supprimées de PAM.`
            : `Formulation « ${selected.aliases[0]?.phrase} » supprimée de PAM.`;
      }
    } catch (caught) {
      if (token.current()) {
        token.fail();
        deletionError.value = `${describeError(caught)} La suppression n’est pas confirmée. Annulez et actualisez le profil avant une nouvelle tentative.`;
      }
    } finally {
      token.finish();
      void updateHealth();
    }
  }
  const deleteApplication = (application: Application) =>
    requestDeletion('application', application.id);
  async function saveSettings() {
    if (isLocked()) return;
    settingsError.value = '';
    const values = {
      ...settingsDraft,
      confidenceThreshold: Number(settingsDraft.confidenceThreshold),
    };
    try {
      if (await changeConfig('settings', values, true))
        settingsInitial.value = JSON.stringify(values);
    } catch (caught) {
      settingsError.value = describeError(caught);
    }
  }
  function discardSettings() {
    Object.assign(settingsDraft, settingsOf(config.value));
    settingsInitial.value = JSON.stringify(settingsDraft);
    settingsError.value = '';
  }
  const saveCommandAlias = async (alias: Omit<CommandAlias, 'id'> & { id?: string }) => {
    if (!(await changeConfig('save_command_alias', alias, true)))
      throw new Error(
        'La réponse a été interrompue. Votre brouillon est conservé ; vérifiez les formulations enregistrées avant de réessayer.',
      );
  };
  const deleteCommandAlias = async (id: string) => {
    requestDeletion('formulation', id);
  };
  const activeApps = computed(() => config.value.applications.filter((app) => app.enabled));
  function unavailable(application: Application) {
    return status.value?.applicationAvailability?.[application.id]?.available === false;
  }
  let healthTimer: number | undefined, supervisorTimer: number | undefined;
  onMounted(async () => {
    void updateSupervisor();
    supervisorTimer = window.setInterval(() => {
      void updateSupervisor();
    }, 1000);
    await refresh();
    if (scope.alive())
      healthTimer = window.setInterval(() => {
        void updateHealth();
      }, 15000);
  });
  onBeforeUnmount(() => {
    window.clearInterval(healthTimer);
    window.clearInterval(supervisorTimer);
  });
  return {
    request,
    scope,
    mutation,
    beginMutation,
    isLocked,
    health,
    supervisor,
    runtimeReady,
    runtimeLabel,
    updateSupervisor,
    status,
    config,
    error,
    diagnosticExport,
    diagnostics,
    exportDiagnostics,
    recoveryOpen,
    recoveryBackup,
    recoveryChoice,
    beginRecovery,
    profileRequest,
    busy,
    loading,
    refresh,
    updateHealth,
    recoverProfile,
    restartEngine,
    toggleApplication,
    deleteApplication,
    deletion,
    deletionError,
    deletionNotice,
    deleting,
    confirmDeletion,
    cancelDeletion,
    saveSettings,
    settingsDraft,
    settingsDirty,
    settingsError,
    discardSettings,
    saveCommandAlias,
    deleteCommandAlias,
    activeApps,
    unavailable,
  };
}
export type Profile = ReturnType<typeof useProfile>;
