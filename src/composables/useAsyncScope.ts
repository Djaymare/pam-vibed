import { computed, onBeforeUnmount, ref, watch } from 'vue';

export type OperationState = 'idle' | 'pending' | 'success' | 'error' | 'cancelled';
export interface OperationToken {
  current(): boolean;
  fail(): void;
  finish(): void;
}

/** Cancellation suppresses delivery; native effects are never retried or undone. */
export function useAsyncScope(context?: () => unknown) {
  let generation = 0,
    disposed = false;
  const cancellations = new Set<() => void>(),
    invalidations = new Set<() => void>();
  function invalidate() {
    generation++;
    cancellations.forEach((cancel) => cancel());
    invalidations.forEach((cancel) => cancel());
  }
  function operation(policy: 'exclusive' | 'latest' = 'exclusive') {
    const state = ref<OperationState>('idle'),
      pending = ref(false),
      kind = ref('');
    let serial = 0;
    function cancel() {
      serial++;
      state.value = pending.value ? 'cancelled' : 'idle';
      // Exclusive effects keep their reservation until the actual call settles.
      if (policy === 'latest') pending.value = false;
    }
    cancellations.add(cancel);
    function begin(label = ''): OperationToken | undefined {
      if (disposed || (pending.value && policy === 'exclusive')) return;
      const id = ++serial,
        epoch = generation;
      pending.value = true;
      state.value = 'pending';
      kind.value = label;
      let finished = false;
      const current = () => !disposed && epoch === generation && id === serial && !finished;
      return {
        current,
        fail() {
          if (current()) state.value = 'error';
        },
        finish() {
          if (finished) return;
          if (current() && state.value === 'pending') state.value = 'success';
          finished = true;
          if (policy === 'exclusive' || id === serial) pending.value = false;
        },
      };
    }
    return { state, pending: computed(() => pending.value), kind, begin, cancel };
  }
  if (context) watch(context, invalidate, { flush: 'sync' });
  onBeforeUnmount(() => {
    disposed = true;
    invalidate();
  });
  return {
    operation,
    invalidate,
    alive: () => !disposed,
    onInvalidate(callback: () => void) {
      invalidations.add(callback);
    },
  };
}
