<script setup lang="ts">
import { ref, watch } from 'vue';
import type { Turn } from '../types';
const props = defineProps<{ stage: string; turns: Turn[]; error: string }>();
const result = ref(''),
  resultKey = ref(0);
const seen = new Map<string, string>();
const labels: Record<Turn['status'], string> = {
  pending: 'Proposition à valider. Vérifiez les actions puis choisissez Exécuter ou Annuler.',
  executed: 'Demande terminée.',
  partial: 'Exécution interrompue. Vérifiez les actions déjà effectuées.',
  failed: 'Échec de la demande.',
  cancelled: 'Proposition annulée. Aucune action exécutée.',
  unsupported: 'Aucune action disponible.',
  silence: 'Aucune parole détectée.',
  expired: 'Proposition expirée.',
  invalidated: 'Proposition retirée.',
  consumed: 'Confirmation déjà consommée.',
};
watch(
  () => props.turns,
  (turns) => {
    const changes: string[] = [];
    for (const turn of [...turns].reverse()) {
      // Timing, countdown and freshly allocated polling objects are not announcements.
      const message = [
        labels[turn.status],
        turn.transcript,
        ...turn.calls.map((call) => `${call.actionLabel || 'Ouvrir'} ${call.applicationName}`),
        turn.message,
        ...turn.results.map((item) => `${item.applicationName} : ${item.message}`),
      ]
        .filter(Boolean)
        .join(' ');
      if (seen.get(turn.id) !== message) {
        seen.set(turn.id, message);
        changes.push(message);
      }
    }
    for (const id of seen.keys()) if (!turns.some((turn) => turn.id === id)) seen.delete(id);
    if (changes.length) {
      result.value = changes.join(' ');
      resultKey.value++;
    }
  },
  { deep: true },
);
</script>
<template>
  <p class="request-status" role="status" aria-live="polite" aria-atomic="true">{{ stage }}</p>
  <div class="sr-only" role="status" aria-live="polite" aria-atomic="true" data-result-announcement>
    <span :key="resultKey">{{ result }}</span>
  </div>
  <div class="sr-only" role="alert" aria-atomic="true" data-error-announcement>{{ error }}</div>
</template>
