<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps<{
  labelledby: string;
  returnFocus?: HTMLElement | null;
  fallbackFocus?: string;
  closeDisabled?: boolean;
}>();
const emit = defineEmits<{ close: [reason: 'escape' | 'outside' | 'explicit'] }>();
const dialog = ref<HTMLDialogElement>();
let opener: HTMLElement | null = null;
let observer: MutationObserver | undefined;

function available(element: HTMLElement) {
  // Chromium may report a box for descendants of collapsed <details>, though
  // they cannot receive focus. Only that details element's summary is usable.
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (
      parent.matches('details:not([open])') &&
      !parent.querySelector(':scope > summary')?.contains(element)
    )
      return false;
  }
  return (
    !element.matches(':disabled') &&
    !element.closest('[inert]') &&
    element.getClientRects().length > 0 &&
    getComputedStyle(element).visibility !== 'hidden'
  );
}
function tabbable() {
  return [
    ...(dialog.value?.querySelectorAll<HTMLElement>(
      'button, input, textarea, select, a[href], summary, [tabindex], [contenteditable="true"]',
    ) || []),
  ].filter((element) => element.tabIndex >= 0 && available(element));
}
function focusInside() {
  const initial = dialog.value?.querySelector<HTMLElement>('[data-dialog-initial-focus]');
  (initial && available(initial) ? initial : tabbable()[0] || dialog.value)?.focus();
}
function keepFocus() {
  const opened = document.querySelectorAll('dialog[open]');
  if (opened[opened.length - 1] !== dialog.value) return;
  if (
    dialog.value?.open &&
    (!dialog.value.contains(document.activeElement) ||
      (document.activeElement instanceof HTMLElement && !available(document.activeElement)))
  )
    focusInside();
}
function keydown(event: KeyboardEvent) {
  if (event.key !== 'Tab') return;
  const elements = tabbable();
  const index = elements.indexOf(document.activeElement as HTMLElement);
  event.preventDefault();
  const next =
    index < 0
      ? event.shiftKey
        ? elements.length - 1
        : 0
      : (index + (event.shiftKey ? -1 : 1) + elements.length) % elements.length;
  (elements.length ? elements[next] : dialog.value)?.focus();
}
// Closing is a request: the parent may retain a busy form or intercept drafts.
function requestClose(reason: 'escape' | 'outside' | 'explicit' = 'explicit') {
  if (!props.closeDisabled) emit('close', reason);
}
function outside(event: MouseEvent) {
  if (event.target !== dialog.value) return;
  const bounds = dialog.value.getBoundingClientRect();
  if (
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom
  )
    requestClose('outside');
}
onMounted(() => {
  opener =
    props.returnFocus ||
    (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  dialog.value?.showModal(); // Native top layer makes the rest of the document inert.
  focusInside();
  document.addEventListener('focusin', keepFocus);
  observer = new MutationObserver(keepFocus);
  if (dialog.value)
    observer.observe(dialog.value, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['disabled', 'hidden', 'open', 'style', 'class'],
    });
});
watch(
  () => props.closeDisabled,
  () => {
    void nextTick(keepFocus);
  },
);
onBeforeUnmount(() => {
  observer?.disconnect();
  document.removeEventListener('focusin', keepFocus);
  dialog.value?.close();
  // Wait for replacement dialogs and disabled triggers to finish their update.
  void nextTick(() => {
    const opened = document.querySelectorAll('dialog[open]');
    const remaining = opened[opened.length - 1];
    if (remaining && !remaining.contains(opener)) return;
    const fallback = props.fallbackFocus
      ? document.querySelector<HTMLElement>(props.fallbackFocus)
      : null;
    const target = opener?.isConnected && available(opener) ? opener : fallback;
    if (target && available(target)) target.focus();
  });
});
</script>

<template>
  <dialog
    ref="dialog"
    class="modal"
    :aria-labelledby="labelledby"
    aria-modal="true"
    tabindex="-1"
    @keydown="keydown"
    @cancel.prevent="requestClose('escape')"
    @click="outside"
  >
    <slot :request-close="requestClose" />
  </dialog>
</template>
