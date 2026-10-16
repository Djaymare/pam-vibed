<script setup lang="ts">
import { vField } from '../composables/fieldAccessibility';
import { computed, nextTick, ref, watch, toRefs, type UnwrapNestedRefs } from 'vue';
import Icon from '../components/Icon.vue';
import type { Profile } from '../composables/useProfile';
import type { Audio } from '../composables/useAudio';
import type { Requests } from '../composables/useRequests';
import type { Proposals } from '../composables/useProposals';
import MediaControls from '../components/MediaControls.vue';
import TurnCard from '../components/TurnCard.vue';
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
const { turns, editTurn, resolveTurn, revealedId } = toRefs(props.proposals);
const revealedTurn = computed(() =>
  config.value.applications.some((app) => app.enabled && app.media)
    ? turns.value.find((turn) => turn.id === revealedId.value)
    : undefined,
);
const historyTurns = computed(() =>
  turns.value.filter((turn) => turn.id !== revealedTurn.value?.id),
);
const revealedCard = ref<InstanceType<typeof TurnCard>>();
watch(revealedId, async () => {
  await nextTick();
  const element = revealedCard.value?.$el;
  element?.scrollIntoView?.({ block: 'nearest', behavior: 'instant' });
  element?.focus?.({ preventScroll: true });
});
const emit = defineEmits<{ applications: [add: boolean] }>();
const { canRequest } = toRefs(props);
</script>
<template>
  <div class="page-intro">
    <div class="eyebrow">UN MOT, UNE ACTION</div>
    <h1 tabindex="-1">Qu’est-ce qu’on fait ?</h1>
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
    <label class="sr-only" for="written-request">Demande écrite</label>
    <input
      v-field
      id="written-request"
      aria-describedby="written-request-help"
      v-model="text"
      :readonly="locked"
      maxlength="2000"
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
  <p id="written-request-help" class="sr-only">
    Entrez votre demande, puis utilisez Envoyer la demande pour préparer une action à vérifier.
  </p>
  <p class="muted">
    Les propositions sont valables dix minutes et sont retirées au redémarrage de PAM. Reformulez
    pour préparer une nouvelle action.
  </p>
  <MediaControls
    :applications="config.applications"
    :locked="locked || !profile.runtimeReady"
    @action="prepareMediaAction"
  >
    <TurnCard
      v-if="revealedTurn"
      ref="revealedCard"
      :turn="revealedTurn"
      :config="config"
      :locked="locked"
      :runtime-ready="profile.runtimeReady"
      @resolve="resolveTurn"
      @correct="editTurn"
    />
  </MediaControls>
  <section class="connected">
    <div class="section-heading">
      <h2>
        Vos applications<span>{{ activeApps.length }}</span>
      </h2>
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
    <TurnCard
      v-for="turn in historyTurns"
      :key="turn.id"
      :turn="turn"
      :config="config"
      :locked="locked"
      :runtime-ready="profile.runtimeReady"
      @resolve="resolveTurn"
      @correct="editTurn"
    />
  </section>
</template>
