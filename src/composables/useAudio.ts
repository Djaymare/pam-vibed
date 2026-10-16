import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { isTauri } from '@tauri-apps/api/core';
import { desktopAction } from '../ipc';
import { VoiceRecorder } from '../audio/recorder';
import { describeError, microphoneCode } from '../errors';
import type { Profile } from './useProfile';
import type { Requests } from './useRequests';

export function useAudio(
  profile: Profile,
  requests: Requests,
  canRequest: () => boolean,
  canTest: () => boolean = canRequest,
) {
  const { request, error, scope, beginMutation } = profile;
  const capture = scope.operation('latest'),
    discovery = scope.operation('latest');
  const state = ref<'idle' | 'permission' | 'recording' | 'testing' | 'finishing' | 'cancelling'>(
    'idle',
  );
  const recording = computed(() => state.value === 'recording'),
    requestingMic = computed(() => state.value === 'permission');
  const testing = ref(false),
    testResult = ref(''),
    microphoneError = ref('');
  const devices = ref<{ deviceId: string; label: string }[]>([]),
    selectedDeviceId = ref(''),
    deviceError = ref('');
  const seconds = ref(0),
    level = ref(0);
  let recorder: VoiceRecorder | undefined, cancellation: Promise<void> | undefined;
  let interval: number | undefined,
    limitTimer: number | undefined,
    lastTick = 0,
    peak = 0;
  let serial = 0;
  const media = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
  const lifecycleDocument = document;
  function selectDevice(deviceId: string) {
    if (state.value !== 'idle' || !scope.alive() || !canTest()) return;
    if (deviceId && !devices.value.some((device) => device.deviceId === deviceId)) return;
    selectedDeviceId.value = deviceId;
    deviceError.value = '';
  }
  function clearTimers() {
    window.clearInterval(interval);
    window.clearTimeout(limitTimer);
    interval = undefined;
    limitTimer = undefined;
  }
  async function refreshDevices() {
    if (!media?.enumerateDevices || !scope.alive()) return;
    const token = discovery.begin('microphones');
    if (!token) return;
    try {
      const entries = await media.enumerateDevices();
      if (!token.current()) return;
      devices.value = entries
        .filter((device) => device.kind === 'audioinput' && device.deviceId !== 'communications')
        .filter(
          (device, index, all) =>
            all.findIndex((other) => other.deviceId === device.deviceId) === index,
        )
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || 'Microphone ' + (index + 1),
        }));
      deviceError.value =
        selectedDeviceId.value &&
        !devices.value.some((device) => device.deviceId === selectedDeviceId.value)
          ? 'Le microphone choisi n’est plus disponible. Rebranchez-le ou choisissez une autre entrée.'
          : '';
    } catch {
      if (token.current())
        deviceError.value =
          'Impossible de lister les entrées. Vérifiez le branchement puis actualisez les microphones.';
    } finally {
      token.finish();
    }
  }
  async function failCapture(current: VoiceRecorder, message: string) {
    if (recorder !== current) return;
    const epoch = serial;
    await cancelRecording();
    if (scope.alive() && epoch === serial && !recorder) {
      microphoneError.value = message;
      error.value = message;
      testResult.value = '';
    }
  }
  function staleClock() {
    return Date.now() - lastTick > 2500;
  }
  async function startCapture(test: boolean) {
    if (!(test ? canTest() : canRequest()) || state.value !== 'idle' || !scope.alive()) return;
    if (
      selectedDeviceId.value &&
      !devices.value.some((device) => device.deviceId === selectedDeviceId.value)
    ) {
      microphoneError.value =
        'Le microphone choisi est indisponible. Actualisez les entrées ou choisissez un autre microphone.';
      return;
    }
    const token = capture.begin('permission');
    if (!token) return;
    const epoch = ++serial;
    state.value = 'permission';
    testing.value = test;
    error.value = '';
    microphoneError.value = '';
    testResult.value = '';
    seconds.value = 0;
    level.value = 0;
    peak = 0;
    const currentRecorder = new VoiceRecorder();
    recorder = currentRecorder;
    const stopAtLimit = () => {
      if (!token.current()) return;
      if (staleClock()) {
        void failCapture(
          currentRecorder,
          'L’écoute a été interrompue après une veille ou une pause. Testez le microphone puis recommencez.',
        );
        return;
      }
      if (test) {
        const detected = peak > 0.01;
        void cancelRecording().then(() => {
          if (scope.alive() && serial === epoch && !recorder)
            testResult.value = detected
              ? 'Signal détecté. Test terminé, microphone coupé. Vous pouvez commencer une demande.'
              : 'Aucun son détecté. Microphone coupé. Vérifiez le branchement, le bouton muet et l’entrée sélectionnée puis réessayez.';
        });
      } else void finishRecording();
    };
    try {
      const started = await currentRecorder.start(
        (value) => {
          if (token.current()) {
            level.value = value;
            peak = Math.max(peak, value);
          }
        },
        stopAtLimit,
        {
          deviceId: selectedDeviceId.value,
          collect: !test,
          onInterrupted: (caught) => {
            if (token.current()) void failCapture(currentRecorder, describeError(caught));
          },
        },
      );
      if (started === false || !token.current() || recorder !== currentRecorder) {
        await currentRecorder.dispose();
        return;
      }
      state.value = test ? 'testing' : 'recording';
      lastTick = Date.now();
      void refreshDevices();
      interval = window.setInterval(() => {
        if (!token.current()) return;
        if (staleClock()) {
          void failCapture(
            currentRecorder,
            'L’écoute a été interrompue après une veille ou une pause. Testez le microphone puis recommencez.',
          );
          return;
        }
        lastTick = Date.now();
        seconds.value++;
      }, 1000);
      limitTimer = window.setTimeout(stopAtLimit, test ? 5000 : 29_500);
    } catch (caught) {
      if (!token.current()) return;
      token.fail();
      await currentRecorder.dispose();
      if (!token.current() || recorder !== currentRecorder) return;
      recorder = undefined;
      state.value = 'idle';
      testing.value = false;
      level.value = 0;
      microphoneError.value = describeError(caught);
      error.value = microphoneError.value;
      const code = microphoneCode(caught);
      if (code && isTauri()) {
        try {
          const diagnostic = await request('diagnostic_event', { code });
          if (token.current()) error.value = describeError(diagnostic);
        } catch {
          /* Keep the recovery message if the journal is unavailable. */
        }
      }
      token.finish();
    }
  }
  const startRecording = () => startCapture(false),
    testMicrophone = () => startCapture(true);
  async function finishRecording() {
    if (state.value !== 'recording' || !recorder) return;
    if (staleClock()) {
      await failCapture(
        recorder,
        'L’écoute a été interrompue après une veille ou une pause. Testez le microphone puis recommencez.',
      );
      return;
    }
    const token = beginMutation('process_audio');
    if (!token) return;
    const currentRecorder = recorder;
    state.value = 'finishing';
    clearTimers();
    try {
      const audio = await currentRecorder.finish();
      if (token.current() && recorder === currentRecorder)
        await requests.process('process_audio', { audio: Array.from(audio) }, token);
    } catch (caught) {
      if (token.current()) {
        token.fail();
        error.value = describeError(caught);
        microphoneError.value = error.value;
      }
    } finally {
      token.finish();
      if (recorder === currentRecorder) {
        recorder = undefined;
        state.value = 'idle';
        level.value = 0;
        capture.cancel();
      }
    }
  }
  function cancelRecording(): Promise<void> {
    if (cancellation) return cancellation;
    if (state.value === 'idle' && !recorder) return Promise.resolve();
    // Dispatched effects cannot be undone. The recorder already released hardware.
    if (state.value === 'finishing' && requests.sent.value) return Promise.resolve();
    if (state.value === 'finishing') profile.mutation.cancel();
    capture.cancel();
    clearTimers();
    const currentRecorder = recorder;
    recorder = undefined;
    state.value = 'cancelling';
    level.value = 0;
    testing.value = false;
    cancellation = (async () => {
      try {
        await currentRecorder?.dispose();
      } catch (caught) {
        if (scope.alive()) error.value = describeError(caught);
      } finally {
        if (!recorder) state.value = 'idle';
        cancellation = undefined;
      }
    })();
    return cancellation;
  }
  function pause() {
    if (recorder)
      void failCapture(
        recorder,
        'L’écoute a été interrompue. Testez le microphone puis recommencez ; aucune capture ne reprend automatiquement.',
      );
  }
  const changed = () => {
    void refreshDevices();
  };
  const visibility = () => {
    if (lifecycleDocument.visibilityState === 'hidden') pause();
    else changed();
  };
  onMounted(() => {
    changed();
    media?.addEventListener?.('devicechange', changed);
    window.addEventListener('pagehide', pause);
    lifecycleDocument.addEventListener('visibilitychange', visibility);
    lifecycleDocument.addEventListener('freeze', pause);
    lifecycleDocument.addEventListener('resume', changed);
  });
  scope.onInvalidate(() => {
    serial++;
    void cancelRecording();
  });
  watch(
    () => recording.value || state.value === 'testing',
    (value) => {
      if (isTauri()) void desktopAction(value ? 'listening' : 'idle').catch(() => {});
    },
  );
  onBeforeUnmount(() => {
    void cancelRecording();
    media?.removeEventListener?.('devicechange', changed);
    window.removeEventListener('pagehide', pause);
    lifecycleDocument.removeEventListener('visibilitychange', visibility);
    lifecycleDocument.removeEventListener('freeze', pause);
    lifecycleDocument.removeEventListener('resume', changed);
  });
  return {
    state,
    recording,
    requestingMic,
    seconds,
    level,
    testing,
    testResult,
    microphoneError,
    devices,
    selectedDeviceId,
    selectDevice,
    deviceError,
    refreshingDevices: discovery.pending,
    refreshDevices,
    startRecording,
    finishRecording,
    cancelRecording,
    testMicrophone,
  };
}
export type Audio = ReturnType<typeof useAudio>;
