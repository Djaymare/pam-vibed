import { computed, ref, onMounted, onBeforeUnmount } from 'vue';
import type { Application, CommandAlias, Config, RuntimeStatus } from '../types';
import type { Method, Methods } from '../contracts.generated';
import { isTauri } from '@tauri-apps/api/core';
import { describeError } from '../errors';
import type { RequestFunction } from '../ipc';
/** useProfile owns its state and releases its subscriptions at component unmount. */
export function useProfile(
  request: RequestFunction,
  isLocked: () => boolean,
  onStatus: (value: RuntimeStatus) => void,
) {
  const status = ref<RuntimeStatus>();
  const config = ref<Config>({
    version: 2,
    applications: [],
    commandAliases: [],
    language: 'fr',
    autoExecute: true,
    confidenceThreshold: 0.7,
  });
  const error = ref('');
  const diagnosticExport = ref('');
  async function exportDiagnostics() {
    busy.value = true;
    error.value = '';
    diagnosticExport.value = '';
    try {
      diagnosticExport.value = JSON.stringify(await request('export_diagnostics'), null, 2);
    } catch (caught) {
      error.value = describeError(caught);
    } finally {
      busy.value = false;
    }
  }
  const recoveryOpen = ref(false);
  const recoveryBackup = ref('');
  const recoveryChoice = ref<RuntimeStatus['profileBackup']>();
  function beginRecovery() {
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
    busy.value = true;
    try {
      const result = await request(method, payload);
      if (method === 'import_config') {
        config.value = (result as { config: Config }).config;
        recoveryOpen.value = false;
        await refresh();
      }
      return result;
    } finally {
      busy.value = false;
    }
  }
  const busy = ref(false);
  const loading = ref(true);
  async function refresh() {
    loading.value = true;
    error.value = '';
    try {
      status.value = await request('status');
      config.value = status.value.config;
      onStatus(status.value);
    } catch (caught) {
      error.value = describeError(caught);
    } finally {
      loading.value = false;
    }
  }
  async function updateHealth() {
    if (isLocked() || !isTauri()) return;
    try {
      const next = await request('status');
      if (next.configError || status.value?.configError) config.value = next.config;
      status.value = next;
      onStatus(next);
    } catch (caught) {
      error.value = describeError(caught);
    }
  }
  async function recoverProfile(restoreBackup = false) {
    const fingerprint = recoveryChoice.value?.fingerprint;
    if (!fingerprint || isLocked()) return;
    busy.value = true;
    error.value = '';
    try {
      const result = await request('recover_config', {
        confirmed: true,
        fingerprint,
        ...(restoreBackup
          ? { restoreBackup: true, backupFingerprint: recoveryChoice.value?.backupFingerprint }
          : {}),
      });
      config.value = result.config;
      recoveryBackup.value = result.backupPath;
      recoveryOpen.value = false;
      await refresh();
    } catch (caught) {
      const message = describeError(caught);
      recoveryOpen.value = false;
      await refresh();
      error.value = message;
    } finally {
      busy.value = false;
    }
  }
  async function restartEngine() {
    busy.value = true;
    error.value = '';
    try {
      await request('restart_engine');
      status.value = await request('status');
    } catch (caught) {
      error.value = describeError(caught);
    } finally {
      busy.value = false;
    }
  }
  async function toggleApplication(application: Application) {
    busy.value = true;
    error.value = '';
    try {
      config.value = await request('set_application_enabled', {
        id: application.id,
        enabled: !application.enabled,
      });
    } catch (caught) {
      error.value = describeError(caught);
    } finally {
      busy.value = false;
      void updateHealth();
    }
  }
  async function deleteApplication(application: Application) {
    busy.value = true;
    error.value = '';
    try {
      config.value = await request('delete_application', { id: application.id });
    } catch (caught) {
      error.value = describeError(caught);
    } finally {
      busy.value = false;
    }
  }
  async function saveSettings() {
    busy.value = true;
    error.value = '';
    try {
      config.value = await request('settings', {
        language: config.value.language,
        autoExecute: config.value.autoExecute,
        confidenceThreshold: Number(config.value.confidenceThreshold),
      });
    } catch (caught) {
      const message = describeError(caught);
      await refresh();
      error.value = message;
    } finally {
      busy.value = false;
    }
  }
  async function saveCommandAlias(alias: Omit<CommandAlias, 'id'> & { id?: string }) {
    busy.value = true;
    try {
      config.value = await request('save_command_alias', alias);
    } finally {
      busy.value = false;
    }
  }
  async function deleteCommandAlias(id: string) {
    busy.value = true;
    try {
      config.value = await request('delete_command_alias', { id });
    } finally {
      busy.value = false;
    }
  }
  const activeApps = computed(() => config.value.applications.filter((app) => app.enabled));
  function unavailable(application: Application) {
    return status.value?.applicationAvailability?.[application.id]?.available === false;
  }
  let disposed = false;
  let healthTimer: number | undefined;
  onMounted(async () => {
    await refresh();
    if (!disposed)
      healthTimer = window.setInterval(() => {
        void updateHealth();
      }, 15000);
  });
  onBeforeUnmount(() => {
    disposed = true;
    window.clearInterval(healthTimer);
  });
  return {
    request,
    status,
    config,
    error,
    diagnosticExport,
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
