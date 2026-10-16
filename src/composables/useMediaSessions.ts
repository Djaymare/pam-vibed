import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { request } from '../ipc';
import { describeError } from '../errors';
import type { MediaSession } from '../types';
import { useAsyncScope } from './useAsyncScope';

/** One bounded read at a time; only the current foreground generation may publish. */
export function useMediaSessions(target: () => string, locked: () => boolean) {
  const sessions = ref<MediaSession[]>([]);
  const error = ref('');
  const foreground = ref(false);
  const scope = useAsyncScope();
  const read = scope.operation();
  const active = computed(() => !!target() && !locked() && foreground.value);
  let timer: number | undefined;
  let queued = false;
  let failures = 0;
  function stopTimer() {
    window.clearTimeout(timer);
    timer = undefined;
  }
  function schedule() {
    stopTimer();
    if (scope.alive() && active.value)
      timer = window.setTimeout(() => void refresh(), Math.min(30000, 5000 * 2 ** failures));
  }
  async function refresh() {
    if (!scope.alive() || !active.value) return;
    const token = read.begin();
    if (!token) return;
    stopTimer();
    try {
      const next = await request('media_sessions');
      if (token.current()) {
        sessions.value = next;
        error.value = '';
        failures = 0;
      }
    } catch (caught) {
      if (token.current()) {
        token.fail();
        sessions.value = [];
        error.value = describeError(caught);
        failures = Math.min(3, failures + 1);
      }
    } finally {
      token.finish();
      if (scope.alive() && queued && active.value) {
        queued = false;
        void refresh();
      } else schedule();
    }
  }
  // Invalidation suppresses delivery but retains the in-flight reservation.
  // Many context changes request at most one fresh read after its completion.
  watch(
    [target, locked, foreground],
    () => {
      stopTimer();
      scope.invalidate();
      sessions.value = [];
      error.value = '';
      failures = 0;
      queued = active.value && read.pending.value;
      if (active.value && !read.pending.value) void refresh();
    },
    { flush: 'sync' },
  );
  function updateForeground() {
    foreground.value = document.visibilityState !== 'hidden' && document.hasFocus();
  }
  function blur() {
    foreground.value = false;
  }
  onMounted(() => {
    window.addEventListener('focus', updateForeground);
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', updateForeground);
    updateForeground();
  });
  onBeforeUnmount(() => {
    stopTimer();
    window.removeEventListener('focus', updateForeground);
    window.removeEventListener('blur', blur);
    document.removeEventListener('visibilitychange', updateForeground);
  });
  return { sessions, error, loading: read.pending, refresh };
}
