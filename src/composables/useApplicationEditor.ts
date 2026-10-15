import { computed, ref, reactive, watch } from 'vue';
import type { Application, InstalledApplication, MediaSession, WindowsApplication } from '../types';

import { open } from '@tauri-apps/plugin-dialog';
import { discoverApplications as ipcDiscoverApplications } from '../ipc';
import { describeError } from '../errors';
import type { Profile } from './useProfile';
/** useApplicationEditor owns its state and releases its subscriptions at component unmount. */
export function useApplicationEditor(profile: Profile, rememberDialogTrigger: () => void) {
  const { request, busy, config, status, updateHealth } = profile;
  const editorOpen = ref(false);
  const editingId = ref<string>();
  const form = reactive({
    name: '',
    description: '',
    executable: '',
    aliases: '',
    arguments: '[]',
    enabled: true,
    windowsApp: undefined as WindowsApplication | undefined,
  });
  const mediaSource = ref('');
  const deezerPlugin = ref(false);
  const mediaSessions = ref<MediaSession[]>([]);
  const mediaError = ref('');
  const deezerTarget = computed(
    () => form.windowsApp?.appId === 'Deezer.62021768415AF_q7m17pa7q8kj0!Deezer.Music',
  );
  const formError = ref('');
  const pickerOpen = ref(false);
  const discoveryLoading = ref(false);
  const discoveryError = ref('');
  const installedApplications = ref<InstalledApplication[]>([]);
  const replacingTarget = ref(false);
  const editingAvailability = computed(() =>
    editingId.value ? status.value?.applicationAvailability?.[editingId.value] : undefined,
  );
  const testResult = ref<{ success: boolean; message: string }>();
  const testInput = ref('');
  const testing = ref(false);
  const testNeedsInput = computed(() => !form.windowsApp && form.arguments.includes('{input}'));
  async function refreshMediaSessions() {
    mediaError.value = '';
    try {
      mediaSessions.value = await request('media_sessions');
    } catch (caught) {
      mediaError.value = describeError(caught);
    }
  }
  function editApplication(application?: Application, preserveTrigger = false) {
    if (!preserveTrigger) rememberDialogTrigger();
    editingId.value = application?.id;
    form.windowsApp = application?.windowsApp;
    mediaSource.value = application?.media?.sourceAppId || '';
    deezerPlugin.value = application?.media?.deezer || false;
    void refreshMediaSessions();
    Object.assign(
      form,
      application
        ? {
            ...application,
            aliases: application.aliases.join(', '),
            arguments: JSON.stringify(application.arguments, null, 2),
          }
        : {
            name: '',
            description: '',
            executable: '',
            aliases: '',
            arguments: '[]',
            enabled: true,
          },
    );
    formError.value = '';
    testResult.value = undefined;
    testInput.value = '';
    editorOpen.value = true;
  }
  async function addApplication() {
    replacingTarget.value = false;
    rememberDialogTrigger();
    pickerOpen.value = true;
    if (!installedApplications.value.length) await discoverApplications();
  }
  async function discoverApplications() {
    if (discoveryLoading.value) return;
    discoveryLoading.value = true;
    discoveryError.value = '';
    try {
      installedApplications.value = await ipcDiscoverApplications();
    } catch (caught) {
      discoveryError.value = describeError(caught);
    } finally {
      discoveryLoading.value = false;
    }
  }
  function selectInstalled(application: InstalledApplication) {
    if (replacingTarget.value) {
      pickerOpen.value = false;
      replacingTarget.value = false;
      editorOpen.value = true;
      form.windowsApp = {
        appId: application.appId,
        kind: application.kind,
        icon: application.icon,
        launchArgument: application.launchArgument,
      };
      deezerPlugin.value = deezerPlugin.value && deezerTarget.value;
      testResult.value = undefined;
      return;
    }
    pickerOpen.value = false;
    editApplication(undefined, true);
    form.name = application.name.slice(0, 60);
    form.description = `Ouvrir ${form.name}.`;
    form.windowsApp = {
      appId: application.appId,
      kind: application.kind,
      icon: application.icon,
      launchArgument: application.launchArgument,
    };
    deezerPlugin.value = false;
    mediaSource.value = '';
    if (deezerTarget.value) {
      deezerPlugin.value = true;
      mediaSource.value = 'Deezer.exe';
    }
    // The native bridge supplies the trusted launch target when saving or testing.
  }
  function closePicker() {
    pickerOpen.value = false;
    if (replacingTarget.value) {
      replacingTarget.value = false;
      editorOpen.value = true;
    }
  }
  async function replaceTarget() {
    replacingTarget.value = true;
    editorOpen.value = false;
    pickerOpen.value = true;
    await discoverApplications();
  }
  function manualApplication() {
    if (replacingTarget.value) {
      useExecutable();
      closePicker();
    } else {
      pickerOpen.value = false;
      editApplication(undefined, true);
    }
  }
  function useExecutable() {
    form.windowsApp = undefined;
    form.executable = '';
    form.arguments = '[]';
    testResult.value = undefined;
    deezerPlugin.value = false;
    mediaSource.value = '';
  }
  function applicationPayload() {
    let args: unknown;
    try {
      args = JSON.parse(form.arguments);
    } catch {
      throw new Error(
        'Les arguments doivent être un tableau JSON, par exemple ["--new-window", "{input}"].',
      );
    }
    return {
      ...form,
      media: mediaSource.value
        ? { sourceAppId: mediaSource.value, deezer: deezerPlugin.value && deezerTarget.value }
        : undefined,
      id: editingId.value,
      aliases: form.aliases
        .split(',')
        .map((alias) => alias.trim())
        .filter(Boolean),
      arguments: args as string[],
    };
  }
  async function testLaunch() {
    busy.value = true;
    testing.value = true;
    formError.value = '';
    testResult.value = undefined;
    try {
      testResult.value = await request('test_application', {
        ...applicationPayload(),
        input: testNeedsInput.value ? testInput.value : undefined,
      });
    } catch (caught) {
      formError.value = describeError(caught);
    } finally {
      busy.value = false;
      testing.value = false;
    }
  }
  async function browse() {
    try {
      const selected = await open({
        title: 'Choisir une application Windows',
        multiple: false,
        directory: false,
        filters: [{ name: 'Application Windows', extensions: ['exe'] }],
      });
      if (typeof selected === 'string') form.executable = selected;
    } catch (caught) {
      formError.value = describeError(caught);
    }
  }
  async function saveApplication() {
    busy.value = true;
    formError.value = '';
    try {
      config.value = await request('save_application', applicationPayload());
      editorOpen.value = false;
    } catch (caught) {
      formError.value = describeError(caught);
    } finally {
      busy.value = false;
      void updateHealth();
    }
  }
  watch(
    () => [form.executable, form.arguments, form.windowsApp?.appId, testInput.value],
    () => {
      testResult.value = undefined;
    },
  );
  return {
    editorOpen,
    editingId,
    form,
    mediaSource,
    deezerPlugin,
    mediaSessions,
    mediaError,
    deezerTarget,
    formError,
    pickerOpen,
    discoveryLoading,
    discoveryError,
    installedApplications,
    replacingTarget,
    editingAvailability,
    testResult,
    testInput,
    testing,
    testNeedsInput,
    refreshMediaSessions,
    editApplication,
    addApplication,
    discoverApplications,
    selectInstalled,
    closePicker,
    replaceTarget,
    manualApplication,
    useExecutable,
    testLaunch,
    browse,
    saveApplication,
  };
}
export type ApplicationEditor = ReturnType<typeof useApplicationEditor>;
