<script setup lang="ts">
import { computed } from 'vue';
import type { Config, Turn } from '../types';
import {
  callPresentation,
  confirmationReason,
  observedState,
  resultLabel,
  turnLabel,
} from '../presentation';
const props = defineProps<{ turn: Turn; config: Config; locked: boolean; runtimeReady: boolean }>();
const emit = defineEmits<{ resolve: [turn: Turn, accept: boolean]; correct: [turn: Turn] }>();
const calls = computed(() => props.turn.calls.map(callPresentation));
const pending = computed(
  () =>
    props.turn.status === 'pending' &&
    (!props.turn.proposal ||
      (props.turn.proposal.state === 'pending' &&
        props.turn.proposal.expiresAt !== null &&
        props.turn.proposal.expiresAt > Date.now())),
);
</script>
<template>
  <article
    class="turn-card"
    :data-turn-id="turn.id"
    tabindex="-1"
    :aria-label="`${turnLabel(turn)} : ${turn.transcript}`"
  >
    <div class="turn-head">
      <strong class="turn-badge" :class="turn.status">{{ turnLabel(turn) }}</strong
      ><span class="turn-metrics"
        >{{ (turn.durationMs / 1000).toFixed(2) }} s<span v-if="turn.confidence !== null">
          · confiance Needle {{ Math.round(turn.confidence * 100) }} %</span
        ></span
      >
    </div>
    <p class="transcript">{{ turn.transcript || 'Le microphone n’a capté aucune parole.' }}</p>
    <p v-if="pending" class="confirmation-reason">
      <strong>Pourquoi valider ?</strong> {{ confirmationReason(turn, config) }}
    </p>
    <ol v-if="calls.length" class="plan-steps" aria-label="Étapes de la demande">
      <li v-for="(call, index) in calls" :key="index">
        <strong>{{ call.label }}</strong>
        <dl class="action-summary">
          <dt>Cible</dt>
          <dd>{{ call.target }}</dd>
          <template v-for="parameter in call.parameters" :key="parameter.key"
            ><dt>{{ parameter.label }}</dt>
            <dd>{{ parameter.value }}</dd></template
          ><template v-if="!call.parameters.length"
            ><dt>Paramètres</dt>
            <dd>Aucun paramètre supplémentaire</dd></template
          >
          <dt>Effet attendu</dt>
          <dd>{{ call.effect }}</dd>
        </dl>
      </li>
    </ol>
    <p
      v-if="turn.message && turn.status !== 'executed'"
      :class="turn.status === 'partial' ? 'result-error' : 'muted'"
    >
      {{ turn.message }}
    </p>
    <ol v-if="turn.results.length" class="plan-results" aria-label="Résultat de chaque étape">
      <li
        v-for="(result, index) in turn.results"
        :key="index"
        :class="result.success ? 'result-success' : 'result-error'"
      >
        <strong
          >Étape {{ (result.index ?? index) + 1 }} · {{ result.applicationName }} ·
          {{ resultLabel(result) }}</strong
        >
        <p>{{ result.message }}</p>
        <p v-if="result.success">
          {{
            observedState(result) ||
            'Effet non observé par PAM. Vérifiez l’application avant toute nouvelle demande.'
          }}
        </p>
        <small v-if="result.error"
          >{{ result.error.code }} · {{ result.error.stage }} · {{ result.error.requestId }}</small
        >
      </li>
    </ol>
    <p v-if="turn.status === 'partial'" class="notice">
      Ce plan ne peut pas être relancé. Vérifiez les étapes effectuées ou inconnues, puis préparez
      une nouvelle demande limitée aux actions restantes.
    </p>
    <small v-if="turn.error"
      >{{ turn.error.code }} · {{ turn.error.stage }} · {{ turn.error.requestId }}</small
    >
    <div v-if="pending" class="approval">
      <p>
        Vérifiez la cible, les paramètres et l’effet attendu.<span v-if="turn.proposal?.expiresAt">
          À valider avant {{ new Date(turn.proposal.expiresAt).toLocaleTimeString() }}.</span
        >
      </p>
      <button
        class="primary small"
        :disabled="locked || !runtimeReady"
        @click="emit('resolve', turn, true)"
      >
        Exécuter</button
      ><button class="secondary small" :disabled="locked" @click="emit('resolve', turn, false)">
        Annuler
      </button>
    </div>
    <div class="turn-correction">
      <span v-if="turn.commandAliasId" class="muted">Formulation personnelle appliquée</span
      ><span v-if="turn.correctedFrom" class="muted">Demande corrigée · validation requise</span
      ><button class="text-button" :disabled="locked" @click="emit('correct', turn)">
        Corriger la demande
      </button>
    </div>
    <details v-if="turn.reasoning">
      <summary>
        {{ turn.confidence === null ? 'Détail de la demande' : 'Raisonnement Needle' }}
      </summary>
      <p>{{ turn.reasoning }}</p>
    </details>
  </article>
</template>
