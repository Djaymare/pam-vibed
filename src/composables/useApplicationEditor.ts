import { computed, ref, reactive, watch } from 'vue';
import type { Application, InstalledApplication, MediaSession, WindowsApplication } from '../types';

import { open } from '@tauri-apps/plugin-dialog';
import { useAsyncScope } from './useAsyncScope';
import { describeError } from '../errors';
import type { Profile } from './useProfile';
import { parseLaunchArguments } from '../launchArguments';
import { applicationGuidance } from '../firstUse';
/** useApplicationEditor owns its state and releases its subscriptions at component unmount. */
export function useApplicationEditor(profile: Profile, rememberDialogTrigger: () => void) {
  const { request, busy, config, status, updateHealth, beginMutation } = profile;
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
  const initial = ref('');
  const snapshot = () =>
    JSON.stringify([form, mediaSource.value, deezerPlugin.value, testInput.value]);
  const dirty = computed(() => editorOpen.value && snapshot() !== initial.value);

  const discoveryError = ref('');
  const installedApplications = ref<InstalledApplication[]>([]);
  const replacingTarget = ref(false);
  const editingAvailability = computed(() =>
    editingId.value ? status.value?.applicationAvailability?.[editingId.value] : undefined,
  );
  const testResult = ref<{ success: boolean; message: string }>();
  const testInput = ref('');

  const scope = useAsyncScope(() =>
    [editorOpen.value, pickerOpen.value, editingId.value].join(':'),
  );
  const discovery = scope.operation('latest'),
    media = scope.operation('latest'),
    browseTask = scope.operation(),
    viewTask = scope.operation('latest');
  const discoveryLoading = discovery.pending;
  const testing = computed(() => busy.value && profile.mutation.kind.value === 'test_application');
  profile.scope.onInvalidate(() => {
    scope.invalidate();
    editorOpen.value = false;
    pickerOpen.value = false;
  });
  const testNeedsInput = computed(() => !form.windowsApp && form.arguments.includes('{input}'));
  const guidance = computed(() =>
    applicationGuidance(
      {
        name: form.name,
        arguments: [],
        media: mediaSource.value
          ? { sourceAppId: mediaSource.value, deezer: deezerPlugin.value && deezerTarget.value }
          : undefined,
      },
      mediaSessions.value,
    ),
  );
  function suggestDescription() {
    form.description = guidance.value.description;
  }
  watch(
    () => guidance.value.description,
    (next, previous) => {
      if (form.description === previous) form.description = next;
    },
  );
  async function refreshMediaSessions() {
    if (!editorOpen.value || media.pending.value) return;
    const token = media.begin();
    if (!token) return;
    mediaError.value = '';
    try {
      const next = await request('media_sessions');
      if (token.current()) mediaSessions.value = next;
    } catch (caught) {
      if (token.current()) {
        token.fail();
        mediaError.value = describeError(caught);
      }
    } finally {
      token.finish();
    }
  }
  function editApplication(application?: Application, preserveTrigger = false) {
    if (profile.isLocked()) return;
    if (!preserveTrigger) rememberDialogTrigger();
    editingId.value = application?.id;
    form.windowsApp = application?.windowsApp;
    mediaSource.value = application?.media?.sourceAppId || '';
    deezerPlugin.value = application?.media?.deezer || false;

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
    initial.value = snapshot();
    void refreshMediaSessions();
  }
  async function addApplication() {
    if (profile.isLocked() || pickerOpen.value) return;
    replacingTarget.value = false;
    rememberDialogTrigger();
    pickerOpen.value = true;
    if (!installedApplications.value.length) await discoverApplications();
  }
  async function discoverApplications() {
    if (!pickerOpen.value || discovery.pending.value) return;
    const token = discovery.begin();
    if (!token) return;
    discoveryError.value = '';
    try {
      const next = await request('discover_applications');
      if (token.current()) installedApplications.value = next;
    } catch (caught) {
      if (token.current()) {
        token.fail();
        discoveryError.value = describeError(caught);
      }
    } finally {
      token.finish();
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
    suggestDescription();
    initial.value = snapshot();
  }
  function closePicker() {
    pickerOpen.value = false;
    if (replacingTarget.value) {
      replacingTarget.value = false;
      editorOpen.value = true;
    }
  }
  async function replaceTarget() {
    if (profile.isLocked() || pickerOpen.value) return;
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
    const args = parseLaunchArguments(form.arguments);
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
      arguments: args,
    };
  }
  async function testLaunch() {
    if (!editorOpen.value || profile.isLocked()) return;
    const token = beginMutation('test_application');
    if (!token) return;
    const view = viewTask.begin();
    if (!view) {
      token.finish();
      return;
    }
    formError.value = '';
    testResult.value = undefined;
    try {
      const result = await request('test_application', {
        ...applicationPayload(),
        input: testNeedsInput.value ? testInput.value : undefined,
      });
      if (token.current() && view.current()) testResult.value = result;
    } catch (caught) {
      if (token.current() && view.current()) {
        token.fail();
        formError.value = describeError(caught);
      }
    } finally {
      view.finish();
      token.finish();
    }
  }
  async function browse() {
    if (!editorOpen.value || profile.isLocked()) return;
    const token = browseTask.begin();
    if (!token) return;
    try {
      const selected = await open({
        title: 'Choisir une application Windows',
        multiple: false,
        directory: false,
        filters: [{ name: 'Application Windows', extensions: ['exe'] }],
      });
      if (token.current() && typeof selected === 'string') form.executable = selected;
    } catch (caught) {
      if (token.current()) {
        token.fail();
        formError.value = describeError(caught);
      }
    } finally {
      token.finish();
    }
  }
  async function saveApplication() {
    if (!editorOpen.value || profile.isLocked()) return;
    const token = beginMutation('save_application');
    if (!token) return;
    const view = viewTask.begin();
    if (!view) {
      token.finish();
      return;
    }
    formError.value = '';
    try {
      const next = await request('save_application', applicationPayload());
      if (token.current() && view.current()) {
        config.value = next;
        editorOpen.value = false;
      }
    } catch (caught) {
      if (token.current() && view.current()) {
        token.fail();
        formError.value = describeError(caught);
      }
    } finally {
      view.finish();
      token.finish();
      void updateHealth();
    }
  }
  watch(
    () => [form.executable, form.arguments, form.windowsApp?.appId, testInput.value],
    () => {
      viewTask.cancel();
      testResult.value = undefined;
    },
  );
  return {
    editorOpen,
    dirty,
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
    guidance,
    suggestDescription,
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
