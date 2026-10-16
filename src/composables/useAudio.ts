import { computed, ref, watch, onBeforeUnmount } from 'vue';
import { isTauri } from '@tauri-apps/api/core';
import { desktopAction } from '../ipc';
import { VoiceRecorder } from '../audio/recorder';
import { describeError, microphoneCode } from '../errors';
import type { Profile } from './useProfile';
import type { Requests } from './useRequests';

export function useAudio(profile: Profile, requests: Requests, canRequest: () => boolean) {
  const { request, error, scope, beginMutation } = profile;
  const capture = scope.operation('latest');
  const state = ref<'idle' | 'permission' | 'recording' | 'finishing' | 'cancelling'>('idle');
  const recording = computed(() => state.value === 'recording');
  const requestingMic = computed(() => state.value === 'permission');
  const seconds = ref(0),
    level = ref(0);
  let recorder: VoiceRecorder | undefined;
  let interval: number | undefined, limitTimer: number | undefined;
  function clearTimers() {
    window.clearInterval(interval);
    window.clearTimeout(limitTimer);
    interval = undefined;
    limitTimer = undefined;
  }
  async function startRecording() {
    if (!canRequest() || state.value !== 'idle' || !scope.alive()) return;
    const token = capture.begin('permission');
    if (!token) return;
    state.value = 'permission';
    error.value = '';
    seconds.value = 0;
    const currentRecorder = new VoiceRecorder();
    recorder = currentRecorder;
    try {
      await currentRecorder.start(
        (value) => {
          if (token.current()) level.value = value;
        },
        () => {
          if (token.current()) void finishRecording();
        },
      );
      if (!token.current() || recorder !== currentRecorder) {
        await currentRecorder.dispose();
        return;
      }
      state.value = 'recording';
      interval = window.setInterval(() => {
        if (token.current()) seconds.value++;
      }, 1000);
      limitTimer = window.setTimeout(() => {
        if (token.current()) void finishRecording();
      }, 29_500);
    } catch (caught) {
      if (!token.current()) return;
      token.fail();
      error.value = describeError(caught);
      await currentRecorder.dispose();
      if (!token.current()) return;
      recorder = undefined;
      state.value = 'idle';
      const code = microphoneCode(caught);
      if (code && isTauri()) {
        try {
          const diagnostic = await request('diagnostic_event', { code });
          if (token.current()) error.value = describeError(diagnostic);
        } catch {
          /* Keep the useful microphone error if the journal is unavailable. */
        }
      }
    }
  }
  async function finishRecording() {
    if (state.value !== 'recording' || !recorder) return;
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
  async function cancelRecording() {
    if (state.value === 'cancelling') return;
    if (state.value === 'idle' && !recorder) return;
    // Before IPC dispatch the audio can be discarded. After dispatch the native
    // request may already have emitted effects: never pretend to cancel them.
    if (state.value === 'finishing' && requests.sent.value) return;
    if (state.value === 'finishing') profile.mutation.cancel();
    capture.cancel();
    clearTimers();
    const currentRecorder = recorder;
    recorder = undefined;
    state.value = 'cancelling';
    level.value = 0;
    try {
      await currentRecorder?.dispose();
    } catch (caught) {
      if (scope.alive()) error.value = describeError(caught);
    } finally {
      if (!recorder) state.value = 'idle';
    }
  }
  scope.onInvalidate(() => {
    void cancelRecording();
  });
  watch(recording, (value) => {
    if (isTauri()) void desktopAction(value ? 'listening' : 'idle').catch(() => {});
  });
  onBeforeUnmount(() => {
    void cancelRecording();
  });
  return {
    state,
    recording,
    requestingMic,
    seconds,
    level,
    startRecording,
    finishRecording,
    cancelRecording,
  };
}
export type Audio = ReturnType<typeof useAudio>;
