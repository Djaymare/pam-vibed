import { ref, watch, onBeforeUnmount } from 'vue';

import { isTauri } from '@tauri-apps/api/core';
import { desktopAction } from '../ipc';
import { VoiceRecorder } from '../audio/recorder';
import { describeError, microphoneCode } from '../errors';
import type { Profile } from './useProfile';
import type { Requests } from './useRequests';
/** useAudio owns its state and releases its subscriptions at component unmount. */
export function useAudio(profile: Profile, requests: Requests, canRequest: () => boolean) {
  const { request, busy, error } = profile;
  const { process } = requests;
  const recording = ref(false);
  const requestingMic = ref(false);
  const seconds = ref(0);
  const level = ref(0);
  let recorder: VoiceRecorder | undefined;
  let interval: number | undefined;
  let limitTimer: number | undefined;
  function clearTimers() {
    window.clearInterval(interval);
    window.clearTimeout(limitTimer);
  }
  async function startRecording() {
    if (!canRequest()) return;
    requestingMic.value = true;
    error.value = '';
    seconds.value = 0;
    const currentRecorder = new VoiceRecorder();
    recorder = currentRecorder;
    try {
      await currentRecorder.start(
        (value) => {
          level.value = value;
        },
        () => {
          void finishRecording();
        },
      );
      if (recorder !== currentRecorder || !requestingMic.value) {
        await currentRecorder.dispose();
        return;
      }
      recording.value = true;
      interval = window.setInterval(() => {
        seconds.value += 1;
      }, 1000);
      limitTimer = window.setTimeout(() => {
        void finishRecording();
      }, 29_500);
    } catch (caught) {
      if (recorder === currentRecorder) {
        error.value = describeError(caught);
        recorder = undefined;
        const code = microphoneCode(caught);
        if (code && isTauri()) {
          try {
            const diagnostic = await request('diagnostic_event', { code });
            error.value = describeError(diagnostic);
          } catch {
            /* The microphone message remains useful if the journal is unavailable. */
          }
        }
      }
    } finally {
      if (recorder === currentRecorder || !recorder) requestingMic.value = false;
    }
  }
  async function finishRecording() {
    if (!recording.value || !recorder) return;
    recording.value = false;
    busy.value = true;
    clearTimers();
    try {
      const audio = await recorder.finish();
      await process('process_audio', { audio: Array.from(audio) });
    } catch (caught) {
      error.value = describeError(caught);
    } finally {
      recorder = undefined;
      busy.value = false;
      level.value = 0;
    }
  }
  async function cancelRecording() {
    requestingMic.value = false;
    recording.value = false;
    clearTimers();
    await recorder?.dispose();
    recorder = undefined;
    level.value = 0;
  }
  watch(recording, (value) => {
    if (isTauri()) void desktopAction(value ? 'listening' : 'idle').catch(() => {});
  });
  onBeforeUnmount(() => {
    void cancelRecording();
  });
  return {
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
