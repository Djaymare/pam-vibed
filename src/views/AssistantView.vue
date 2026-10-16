<script setup lang="ts">
import { toRefs, type UnwrapNestedRefs } from 'vue';
import Icon from '../components/Icon.vue';
import type { Profile } from '../composables/useProfile';
import type { Audio } from '../composables/useAudio';
import type { Requests } from '../composables/useRequests';
import type { Proposals } from '../composables/useProposals';
import MediaControls from '../components/MediaControls.vue';
const props = defineProps<{
  profile: UnwrapNestedRefs<Profile>;
  audio: UnwrapNestedRefs<Audio>;
  requests: UnwrapNestedRefs<Requests>;
  proposals: UnwrapNestedRefs<Proposals>;
  locked: boolean;
  canRequest: boolean;
  assistantStatus: { label: string; title: string; detail: string };
}>();
const { locked } = toRefs(props);
const { config, activeApps } = toRefs(props.profile);
const {
  recording,
  requestingMic,
  seconds,
  level,
  startRecording,
  finishRecording,
  cancelRecording,
  state: audioState,
} = toRefs(props.audio);
const { text, submitText, prepareMediaAction, processing, sent } = toRefs(props.requests);
const { turns, editTurn, resolveTurn, labels, outcomeLabels } = toRefs(props.proposals);
const emit = defineEmits<{ applications: [add: boolean] }>();
const { canRequest } = toRefs(props);
</script>
<template>
  <div class="page-intro">
    <div class="eyebrow">UN MOT, UNE ACTION</div>
    <h1>Qu’est-ce qu’on fait ?</h1>
    <p>Parlez à PAM. Vos applications prennent le relais.</p>
  </div>
  <section class="voice-card" aria-label="Enregistrement vocal">
    <div class="card-top">
      <span class="subtle-label"
        ><span class="status-dot" :class="{ listening: recording }" />{{
          assistantStatus.label
        }}</span
      ><span class="clip-limit">{{ recording ? `${seconds} / 30 s` : '30 s maximum' }}</span>
    </div>
    <div class="voice-center">
      <div class="mic-orbit" :class="{ recording }" :style="{ '--level': level }">
        <button
          class="mic-button"
          :class="{ recording }"
          :disabled="!recording && !canRequest"
          :aria-label="recording ? 'Arrêter et traiter la demande' : 'Commencer l’enregistrement'"
          @click="recording ? finishRecording() : startRecording()"
        >
          <Icon :name="recording ? 'stop' : 'mic'" :size="34" />
        </button>
      </div>
      <h2>{{ assistantStatus.title }}</h2>
      <p>{{ assistantStatus.detail }}</p>
      <button
        v-if="recording || requestingMic || (audioState === 'finishing' && !sent)"
        class="text-button"
        @click="cancelRecording"
      >
        Annuler avant l’envoi
      </button>
      <button
        v-else-if="!activeApps.length"
        class="text-button"
        @click="emit('applications', true)"
      >
        Ajouter ma première application <Icon name="arrow" :size="15" />
      </button>
    </div>
    <div class="pipeline">
      <span><Icon name="mic" :size="15" />Voix</span><Icon name="chevron" :size="12" /><span
        >Whistle<small>transcrit</small></span
      ><Icon name="chevron" :size="12" /><span>Needle<small>comprend</small></span
      ><Icon name="chevron" :size="12" /><span><Icon name="apps" :size="15" />Application</span>
    </div>
  </section>
  <form class="text-request" @submit.prevent="submitText">
    <input
      v-model="text"
      :readonly="locked"
      maxlength="2000"
      aria-label="Demande écrite"
      placeholder="Vous préférez écrire ? Entrez votre demande…"
    /><button
      class="send-button"
      :disabled="!canRequest || !text.trim()"
      :aria-label="processing ? 'Traitement de la demande' : 'Envoyer la demande'"
      :aria-busy="processing"
    >
      <Icon name="arrow" :size="20" />
    </button>
  </form>
  <p class="muted">
    Les propositions sont valables dix minutes et sont retirées au redémarrage de PAM. Reformulez
    pour préparer une nouvelle action.
  </p>
  <MediaControls
    :applications="config.applications"
    :locked="locked || !profile.runtimeReady"
    @action="prepareMediaAction"
  />
  <section class="connected">
    <div class="section-heading">
      <h3>
        Vos applications<span>{{ activeApps.length }}</span>
      </h3>
      <button class="text-button" :disabled="locked" @click="emit('applications', false)">
        Gérer <Icon name="arrow" :size="14" />
      </button>
    </div>
    <div v-if="activeApps.length" class="app-chips">
      <span v-for="app in activeApps" :key="app.id"
        ><span class="app-initial">{{ app.name.slice(0, 1).toUpperCase() }}</span
        >{{ app.name }}<i
      /></span>
    </div>
    <p v-else class="empty-inline">Aucune application connectée pour le moment.</p>
  </section>
  <section class="history">
    <div class="section-heading">
      <h3>Activité récente</h3>
      <span class="muted">Cette session uniquement</span>
    </div>
    <div v-if="!turns.length" class="history-empty">
      <Icon name="clock" :size="22" />
      <p>Votre première demande apparaîtra ici.</p>
    </div>
    <article v-for="turn in turns" :key="turn.id" class="turn-card">
      <div class="turn-head">
        <span class="turn-badge" :class="turn.status"
          ><Icon :name="turn.status === 'executed' ? 'check' : 'info'" :size="14" />{{
            labels[turn.status]
          }}</span
        ><span
          class="turn-metrics"
          title="Score du choix effectué par Needle. La précision de la transcription vocale est indépendante."
          >{{ (turn.durationMs / 1000).toFixed(2) }} s<span v-if="turn.confidence !== null">
            · confiance Needle {{ Math.round(turn.confidence * 100) }} %</span
          ></span
        >
      </div>
      <p class="transcript">{{ turn.transcript || 'Le microphone n’a capté aucune parole.' }}</p>
      <div v-if="turn.calls.length" class="call-list">
        <div v-for="(call, index) in turn.calls" :key="index">
          <Icon name="arrow" :size="14" /><strong
            >{{ call.actionLabel || 'Ouvrir' }} {{ call.applicationName }}</strong
          ><code
            v-if="(!call.action || call.action === 'open') && Object.keys(call.arguments).length"
            >{{
              Object.entries(call.arguments)
                .map(([key, value]) => `${key} : ${value}`)
                .join(' · ')
            }}</code
          >
        </div>
      </div>
      <p v-if="turn.status === 'unsupported'" class="muted">
        {{
          turn.message ||
          'Cette demande ne correspond à aucune action actuellement disponible. Consultez les sessions et les capacités de votre lecteur.'
        }}
      </p>
      <p
        v-if="['partial', 'expired', 'invalidated', 'consumed'].includes(turn.status)"
        class="result-error"
      >
        {{ turn.message }}
      </p>
      <p
        v-for="(result, index) in turn.results"
        :key="index"
        :class="result.success ? 'result-success' : 'result-error'"
      >
        {{
          result.outcome
            ? outcomeLabels[result.outcome] + ' · ' + result.applicationName + ' : '
            : ''
        }}{{ result.message
        }}<small v-if="result.error">
          · {{ result.error.code }} · {{ result.error.stage }} · {{ result.error.requestId }}</small
        >
      </p>
      <small v-if="turn.error"
        >{{ turn.error.code }} · {{ turn.error.stage }} · {{ turn.error.requestId }}</small
      >
      <div v-if="turn.status === 'pending'" class="approval">
        <p>
          Vérifiez les actions proposées avant de les lancer.<span v-if="turn.proposal?.expiresAt">
            À valider avant {{ new Date(turn.proposal.expiresAt).toLocaleTimeString() }}.</span
          >
        </p>
        <button
          class="primary small"
          :disabled="locked || !profile.runtimeReady"
          @click="resolveTurn(turn, true)"
        >
          <Icon name="check" :size="16" />Exécuter</button
        ><button class="secondary small" :disabled="locked" @click="resolveTurn(turn, false)">
          Annuler
        </button>
      </div>
      <div class="turn-correction">
        <span v-if="turn.commandAliasId" class="muted">Formulation personnelle appliquée</span
        ><span v-if="turn.correctedFrom" class="muted">Demande corrigée · validation requise</span
        ><button class="text-button" :disabled="locked" @click="editTurn(turn)">
          <Icon name="edit" :size="14" />Corriger la demande
        </button>
      </div>
      <details v-if="turn.reasoning">
        <summary>
          {{ turn.confidence === null ? 'Détail de la demande' : 'Raisonnement Needle' }}
        </summary>
        <p>{{ turn.reasoning }}</p>
      </details>
    </article>
  </section>
</template>
