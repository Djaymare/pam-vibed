<script setup lang="ts">
import { vField } from '../composables/fieldAccessibility';
import { computed, ref, watch, useId } from 'vue';
import { useMediaSessions } from '../composables/useMediaSessions';
import type { Application, CommandAction } from '../types';
import {
  deezerPages as pages,
  deezerContent,
  deezerMixes,
  deezerModes,
  mediaActions,
  actionParameters,
  validActionField,
} from '../actions';
const props = defineProps<{ applications: Application[]; locked: boolean }>();
const emit = defineEmits<{
  action: [
    applicationId: string,
    action: CommandAction,
    args: Record<string, string>,
    label: string,
  ];
}>();
const availabilityId = useId();
const selected = ref('');
const query = ref('');
const kind = ref('track');
const contentId = ref('');
const page = ref('home');
const selectionId = ref('');
const selectionMode = ref('display');
const searchFields = actionParameters('deezer_search');
const contentFields = actionParameters('deezer_content');
const selectionFields = actionParameters('deezer_smarttracklist');
const mediaApps = computed(() => props.applications.filter((app) => app.enabled && app.media));
const app = computed(() => mediaApps.value.find((app) => app.id === selected.value));
let selectionInitialized = false;
watch(
  mediaApps,
  (players) => {
    if (!selectionInitialized && players.length) {
      selected.value = players[0].id;
      selectionInitialized = true;
    } else if (!players.some((player) => player.id === selected.value)) selected.value = '';
  },
  { immediate: true },
);
const { sessions, error, loading, refresh } = useMediaSessions(
  () => (app.value ? `${app.value.id}:${app.value.media?.sourceAppId}` : ''),
  () => props.locked,
);
const matching = computed(() =>
  sessions.value.filter(
    (s) => s.sourceAppId.toLowerCase() === app.value?.media?.sourceAppId.toLowerCase(),
  ),
);
const session = computed(() => (matching.value.length === 1 ? matching.value[0] : undefined));
function unavailable(capability: string, label: string) {
  if (props.locked) return 'Une opération est en cours ou le moteur est indisponible.';
  if (loading.value) return 'Actualisation des sessions en cours.';
  if (error.value) return 'Les sessions Windows sont indisponibles. Réessayez l’actualisation.';
  if (!app.value) return 'Choisissez un lecteur.';
  if (!matching.value.length) return `Aucune session Windows compatible pour ${app.value.name}.`;
  if (matching.value.length > 1) return 'Plusieurs sessions de ce lecteur : cible ambiguë.';
  if (session.value?.error) return session.value.error;
  const capabilities: Partial<Record<string, boolean>> = session.value?.capabilities || {};
  if (capabilities[capability] === undefined)
    return `La capacité « ${label} » du lecteur est inconnue.`;
  if (!capabilities[capability]) return `Le lecteur ne propose pas « ${label} » actuellement.`;
  return '';
}
const availability = computed(() =>
  mediaActions.map((action) => ({
    ...action,
    reason: unavailable(action.capability, action.label),
  })),
);
function prepare(action: CommandAction, args: Record<string, string>, label: string) {
  const media = availability.value.find((item) => item.action === action);
  if (media?.reason) return;
  if (app.value && !props.locked)
    emit('action', app.value.id, action, args, `${label} dans ${app.value.name}`);
}
</script>
<template>
  <section
    v-if="mediaApps.length"
    class="settings-card media-controls"
    aria-label="Lecteurs multimédias"
  >
    <div class="section-heading">
      <h2>Lecteurs multimédias</h2>
      <button class="text-button" :disabled="locked || loading" @click="refresh">
        {{ loading ? 'Lecture des sessions…' : 'Actualiser les sessions' }}
      </button>
    </div>
    <label
      >Lecteur<select v-field v-model="selected" :disabled="locked">
        <option value="" disabled>Choisir un lecteur</option>
        <option v-for="player in mediaApps" :key="player.id" :value="player.id">
          {{ player.name }}
        </option>
      </select></label
    >
    <p v-if="error" class="result-error" role="alert">{{ error }}</p>
    <template v-else-if="app">
      <p v-if="!matching.length" class="muted">
        Aucune session Windows compatible pour {{ app.name }}. Ouvrez un média dans ce lecteur puis
        attendez l’actualisation automatique.
      </p>
      <p v-else-if="matching.length > 1" class="result-error">
        Plusieurs sessions de ce lecteur : fermez les médias supplémentaires pour choisir sans
        ambiguïté.
      </p>
      <p v-else-if="session?.error" class="result-error">{{ session.error }}</p>
      <p v-else class="muted">
        {{ session?.title || 'Média sans titre'
        }}<span v-if="session?.artist"> · {{ session.artist }}</span> ·
        {{ session?.playbackStatus || 'État de lecture inconnu' }}
      </p>
      <div class="media-buttons">
        <button
          v-for="action in availability"
          :key="action.action"
          class="secondary small"
          :disabled="!!action.reason"
          :title="action.reason || undefined"
          :aria-describedby="action.reason ? `${availabilityId}-${action.action}` : undefined"
          @click="prepare(action.action, {}, action.label)"
        >
          {{ action.label }}
        </button>
      </div>
      <ul v-if="availability.some((action) => action.reason)" class="muted">
        <template v-for="action in availability" :key="action.action">
          <li v-if="action.reason" :id="`${availabilityId}-${action.action}`">
            {{ action.label }} : {{ action.reason }}
          </li>
        </template>
      </ul>
      <slot v-if="!app.media?.deezer" />
      <p class="muted">
        Les boutons disponibles correspondent aux capacités actuelles du lecteur. « Piste suivante »
        passe au prochain élément déjà présent dans la file.
      </p>
      <div v-if="app.media?.deezer" class="deezer-controls">
        <h3>Deezer Music</h3>
        <form @submit.prevent="prepare('deezer_search', { query }, 'Rechercher ' + query)">
          <label
            >Rechercher une chanson ou un artiste<input
              v-field
              v-model="query"
              :maxlength="searchFields.query.maxLength"
              placeholder="Titre et artiste"
              :disabled="locked" /></label
          ><button class="secondary small" :disabled="locked || !query.trim()">
            Afficher les résultats
          </button>
        </form>
        <form
          @submit.prevent="
            prepare('deezer_content', { kind, id: contentId }, 'Afficher ' + kind + ' ' + contentId)
          "
        >
          <label
            >Contenu<select v-field v-model="kind" :disabled="locked">
              <option v-for="(label, value) in deezerContent" :key="value" :value="value">
                {{ label }}
              </option>
            </select></label
          ><label
            >Identifiant Deezer<input
              v-field
              v-model="contentId"
              inputmode="numeric"
              :pattern="contentFields.id.pattern"
              :maxlength="contentFields.id.maxLength"
              placeholder="Ex. : 3135556"
              :disabled="locked" /></label
          ><button
            class="secondary small"
            :disabled="locked || !validActionField('deezer_content', 'id', contentId)"
          >
            Afficher le contenu
          </button>
        </form>
        <p class="muted">
          Ces liens affichent le contenu ; ils ne démarrent pas une chanson et ne l’insèrent pas en
          prochaine position. Choisissez ces actions dans Deezer.
        </p>
        <div class="media-buttons">
          <button
            v-for="(label, mix) in deezerMixes"
            :key="mix"
            class="secondary small"
            :disabled="locked"
            @click="prepare('deezer_start', { mix }, label)"
          >
            {{ label }}</button
          ><button
            class="text-button"
            :disabled="locked"
            @click="prepare('deezer_reload', {}, 'Recharger Deezer')"
          >
            Recharger Deezer
          </button>
        </div>
        <slot />
        <details>
          <summary>Autres liens Deezer</summary>
          <form
            @submit.prevent="
              prepare('deezer_page', { page }, 'Afficher ' + pages[page as keyof typeof pages])
            "
          >
            <label
              >Page<select v-field v-model="page" :disabled="locked">
                <option v-for="(label, key) in pages" :key="key" :value="key">{{ label }}</option>
              </select></label
            ><button class="secondary small" :disabled="locked">Afficher la page</button>
          </form>
          <form
            @submit.prevent="
              prepare(
                'deezer_smarttracklist',
                { id: selectionId, mode: selectionMode },
                'Ouvrir la sélection ' + selectionId,
              )
            "
          >
            <label
              >Identifiant de sélection smarttracklist<input
                v-field
                v-model="selectionId"
                :maxlength="selectionFields.id.maxLength"
                :pattern="selectionFields.id.pattern"
                :disabled="locked" /></label
            ><label
              >Action<select v-field v-model="selectionMode" :disabled="locked">
                <option v-for="(label, value) in deezerModes" :key="value" :value="value">
                  {{ label }}
                </option>
              </select></label
            ><button
              class="secondary small"
              :disabled="locked || !validActionField('deezer_smarttracklist', 'id', selectionId)"
            >
              Préparer
            </button>
          </form>
          <p class="muted">
            Utilisez un identifiant de sélection fourni par Deezer. Le lien de lecture ne renvoie
            aucune confirmation ; la session Windows est actualisée pour observer le résultat.
          </p>
        </details>
      </div>
    </template>
    <p v-else class="muted">Le lecteur sélectionné a été retiré. Choisissez un lecteur.</p>
    <p class="muted">Chaque bouton affiche ici une action à vérifier avant de l’exécuter.</p>
  </section>
</template>
<style scoped>
.media-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 12px 0;
}
.deezer-controls {
  border-top: 1px solid var(--border);
  margin-top: 20px;
  padding-top: 16px;
}
.deezer-controls form {
  margin: 14px 0;
}
.media-controls label {
  display: block;
  margin: 12px 0;
}
.media-controls select,
.media-controls input {
  width: 100%;
  margin-top: 6px;
}
</style>
