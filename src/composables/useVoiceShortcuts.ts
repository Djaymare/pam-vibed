import { onMounted, onBeforeUnmount, ref } from 'vue';
import { isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useAsyncScope } from './useAsyncScope';

/** Registration is atomic as a group; partial or late subscriptions are released. */
export function useVoiceShortcuts(toggle: () => void, cancel: () => void) {
  const scope = useAsyncScope(),
    registration = scope.operation();
  const error = ref('');
  const stops: UnlistenFn[] = [];
  let lastToggle = -Infinity;
  const toggleOnce = () => {
    if (!scope.alive() || Date.now() - lastToggle < 300) return;
    lastToggle = Date.now();
    toggle();
  };
  function release() {
    stops.splice(0).forEach((stop) => stop());
  }
  async function install() {
    if (!isTauri()) return;
    const token = registration.begin('listeners');
    if (!token) return;
    release();
    error.value = '';
    try {
      for (const [event, callback] of [
        ['pam-toggle-voice', toggleOnce],
        [
          'pam-cancel-voice',
          () => {
            if (scope.alive()) cancel();
          },
        ],
      ] as const) {
        const stop = await listen(event, callback);
        if (!token.current()) {
          stop();
          return;
        }
        stops.push(stop);
      }
    } catch {
      release();
      if (token.current()) {
        token.fail();
        error.value =
          'Les raccourcis vocaux sont indisponibles. Réessayez ou utilisez le bouton du microphone.';
      }
    } finally {
      token.finish();
    }
  }
  onMounted(install);
  onBeforeUnmount(release);
  return { error, registration, install };
}
