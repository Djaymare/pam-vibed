import { onMounted, ref } from 'vue';
import type { RequestFunction } from '../ipc';
import type { VoiceShortcutId, VoiceShortcutStatus } from '../contracts.generated';
import { useAsyncScope } from './useAsyncScope';
export function useShortcutPreference(request: RequestFunction) {
  const scope = useAsyncScope(),
    operation = scope.operation();
  const status = ref<VoiceShortcutStatus>(),
    selected = ref<VoiceShortcutId>('ctrl_shift_space'),
    error = ref('');
  async function load() {
    const token = operation.begin();
    if (!token) return;
    try {
      const result = await request('voice_shortcut');
      if (token.current()) {
        status.value = result;
        selected.value = result.id;
        error.value = '';
      }
    } catch {
      if (token.current())
        error.value =
          'Le réglage du raccourci est indisponible. Réessayez ; le bouton du microphone reste utilisable.';
    } finally {
      token.finish();
    }
  }
  async function save() {
    const token = operation.begin();
    if (!token) return;
    try {
      const result = await request('voice_shortcut', { shortcut: selected.value });
      if (token.current()) {
        status.value = result;
        error.value = '';
      }
    } catch {
      if (token.current())
        error.value = 'Le changement n’a pas été confirmé. Relisez le réglage avant de réessayer.';
    } finally {
      token.finish();
    }
  }
  onMounted(load);
  return { status, selected, error, pending: operation.pending, load, save };
}
export type ShortcutPreference = ReturnType<typeof useShortcutPreference>;
