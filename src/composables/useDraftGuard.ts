import { ref } from 'vue';

/** Keeps the destructive continuation private until the user explicitly chooses it. */
export function useDraftGuard() {
  const pending = ref(false);
  let continuation: (() => void) | undefined;
  function run(dirty: boolean, action: () => void) {
    if (pending.value) return;
    if (!dirty) action();
    else {
      continuation = action;
      pending.value = true;
    }
  }
  function keep() {
    continuation = undefined;
    pending.value = false;
  }
  function discard() {
    const action = continuation;
    keep();
    action?.();
  }
  return { pending, run, keep, discard };
}
