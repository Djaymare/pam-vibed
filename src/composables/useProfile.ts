import { computed, ref, onMounted, onBeforeUnmount } from 'vue';
import type { Application, CommandAlias, Config, RuntimeStatus } from '../types';
import type { Method, Methods } from '../contracts.generated';
import { isTauri } from '@tauri-apps/api/core';
import { describeError } from '../errors';
import type { RequestFunction } from '../ipc';
import { useAsyncScope, type OperationToken } from './useAsyncScope';

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
  const recoveryChoice = ref<RuntimeStatus['profileBackup']>();
  scope.onInvalidate(() => {
    recoveryOpen.value = false;
    diagnosticExport.value = '';
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
      onStatus(next);
    } catch (caught) {
      if (token.current() && (!parent || parent.current())) {
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
      if (token.current()) config.value = next;
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
  const deleteApplication = (application: Application) =>
    changeConfig('delete_application', { id: application.id });
  const saveSettings = () =>
    changeConfig('settings', {
      language: config.value.language,
      autoExecute: config.value.autoExecute,
      confidenceThreshold: Number(config.value.confidenceThreshold),
    });
  const saveCommandAlias = (alias: Omit<CommandAlias, 'id'> & { id?: string }) =>
    changeConfig('save_command_alias', alias, true);
  const deleteCommandAlias = (id: string) => changeConfig('delete_command_alias', { id }, true);
  const activeApps = computed(() => config.value.applications.filter((app) => app.enabled));
  function unavailable(application: Application) {
    return status.value?.applicationAvailability?.[application.id]?.available === false;
  }
  let healthTimer: number | undefined;
  onMounted(async () => {
    await refresh();
    if (scope.alive())
      healthTimer = window.setInterval(() => {
        void updateHealth();
      }, 15000);
  });
  onBeforeUnmount(() => window.clearInterval(healthTimer));
  return {
    request,
    scope,
    mutation,
    beginMutation,
    isLocked,
    health,
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
    saveSettings,
    saveCommandAlias,
    deleteCommandAlias,
    activeApps,
    unavailable,
  };
}
export type Profile = ReturnType<typeof useProfile>;
