<script setup lang="ts">
import { describeError } from '../errors';
import { computed, onMounted, ref, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import type { Application, MediaSession } from '../types';
const props = defineProps<{ applications: Application[]; locked: boolean }>();
const emit = defineEmits<{ action: [applicationId: string, action: string, args: Record<string,string>, label: string] }>();
const sessions = ref<MediaSession[]>([]);
const error = ref('');
const loading = ref(false);
const selected = ref('');
const query = ref('');
const kind = ref('track');
const contentId = ref('');
const page = ref('home');
const selectionId = ref('');
const selectionMode = ref('display');
const pages = {home:'Accueil',podcasts:'Podcasts',explore:'Explorer',charts:'Classements',moods:'Ambiances',radios:'Radios',audio_settings:'Réglages audio',theme:'Apparence'};
const mediaApps = computed(() => props.applications.filter(app => app.enabled && app.media));
const app = computed(() => mediaApps.value.find(app => app.id === selected.value) || mediaApps.value[0]);
watch(mediaApps,players => { if (!players.some(player => player.id === selected.value)) selected.value = players[0]?.id || ''; },{immediate:true});
const matching = computed(() => sessions.value.filter(s => s.sourceAppId.toLowerCase() === app.value?.media?.sourceAppId.toLowerCase()));
const session = computed(() => matching.value.length === 1 ? matching.value[0] : undefined);
const actions = { play:'Lecture', pause:'Pause', next:'Piste suivante', previous:'Piste précédente', stop:'Arrêter', toggle:'Lecture / pause' };
async function refresh() {
  loading.value = true; error.value = '';
  try { sessions.value = await invoke('assistant_request',{method:'media_sessions',payload:{}}); }
  catch (caught) { error.value = describeError(caught); }
  finally { loading.value = false; }
}
function prepare(action:string,args:Record<string,string>,label:string) {
  if (app.value) emit('action',app.value.id,action,args,`${label} dans ${app.value.name}`);
}
onMounted(refresh);
</script>
<template>
  <section v-if="mediaApps.length" class="settings-card media-controls" aria-label="Lecteurs multimédias">
    <div class="section-heading"><h3>Lecteurs multimédias</h3><button class="text-button" :disabled="locked || loading" @click="refresh">{{ loading ? 'Lecture des sessions…' : 'Actualiser les sessions' }}</button></div>
    <label>Lecteur<select v-model="selected" :disabled="locked"><option v-for="player in mediaApps" :key="player.id" :value="player.id">{{ player.name }}</option></select></label>
    <p v-if="error" class="result-error" role="alert">{{ error }}</p>
    <template v-else-if="app">
      <p v-if="!matching.length" class="muted">Aucune session Windows compatible pour {{ app.name }}. Ouvrez un média dans ce lecteur puis actualisez.</p>
      <p v-else-if="matching.length > 1" class="result-error">Plusieurs sessions de ce lecteur : fermez les médias supplémentaires pour choisir sans ambiguïté.</p>
      <p v-else-if="session?.error" class="result-error">{{ session.error }}</p>
      <p v-else class="muted">{{ session?.title || 'Média sans titre' }}<span v-if="session?.artist"> · {{ session.artist }}</span> · {{ session?.playbackStatus }}</p>
      <div class="media-buttons"><button v-for="(label, action) in actions" :key="action" class="secondary small" :disabled="locked || loading || !session?.capabilities?.[action]" @click="prepare('media_' + action, {},label)">{{ label }}</button></div>
      <p class="muted">Les boutons disponibles correspondent aux capacités actuelles du lecteur. « Piste suivante » passe au prochain élément déjà présent dans la file.</p>
      <div v-if="app.media?.deezer" class="deezer-controls">
        <h3>Deezer Music</h3>
        <form @submit.prevent="prepare('deezer_search',{query},'Rechercher ' + query)"><label>Rechercher une chanson ou un artiste<input v-model="query" maxlength="200" placeholder="Titre et artiste" :disabled="locked" /></label><button class="secondary small" :disabled="locked || !query.trim()">Afficher les résultats</button></form>
        <form @submit.prevent="prepare('deezer_content',{kind,id:contentId},'Afficher ' + kind + ' ' + contentId)"><label>Contenu<select v-model="kind" :disabled="locked"><option value="track">Chanson</option><option value="album">Album</option><option value="artist">Artiste</option><option value="playlist">Playlist</option><option value="show">Podcast</option><option value="episode">Épisode</option><option value="profile">Profil</option></select></label><label>Identifiant Deezer<input v-model="contentId" inputmode="numeric" pattern="[1-9][0-9]{0,18}" maxlength="19" placeholder="Ex. : 3135556" :disabled="locked" /></label><button class="secondary small" :disabled="locked || !/^[1-9][0-9]{0,18}$/.test(contentId)">Afficher le contenu</button></form>
        <p class="muted">Ces liens affichent le contenu ; ils ne démarrent pas une chanson et ne l’insèrent pas en prochaine position. Choisissez ces actions dans Deezer.</p>
        <div class="media-buttons"><button class="secondary small" :disabled="locked" @click="prepare('deezer_start',{mix:'flow'},'Démarrer Flow')">Démarrer Flow</button><button class="secondary small" :disabled="locked" @click="prepare('deezer_start',{mix:'loved_tracks'},'Lire les coups de cœur')">Lire les coups de cœur</button><button class="text-button" :disabled="locked" @click="prepare('deezer_reload',{},'Recharger Deezer')">Recharger Deezer</button></div>
        <details><summary>Autres liens Deezer</summary>
          <form @submit.prevent="prepare('deezer_page',{page},'Afficher ' + pages[page as keyof typeof pages])"><label>Page<select v-model="page" :disabled="locked"><option v-for="(label,key) in pages" :key="key" :value="key">{{ label }}</option></select></label><button class="secondary small" :disabled="locked">Afficher la page</button></form>
          <form @submit.prevent="prepare('deezer_smarttracklist',{id:selectionId,mode:selectionMode},'Ouvrir la sélection ' + selectionId)"><label>Identifiant de sélection smarttracklist<input v-model="selectionId" maxlength="80" pattern="[A-Za-z0-9_-]{1,80}" :disabled="locked" /></label><label>Action<select v-model="selectionMode" :disabled="locked"><option value="display">Afficher la sélection</option><option value="play">Demander sa lecture</option></select></label><button class="secondary small" :disabled="locked || !/^[A-Za-z0-9_-]{1,80}$/.test(selectionId)">Préparer</button></form>
          <p class="muted">Utilisez un identifiant de sélection fourni par Deezer. Le lien de lecture ne renvoie aucune confirmation ; actualisez la session pour vérifier le résultat.</p>
        </details>
      </div>
    </template>
    <p class="muted">Chaque bouton prépare une action à vérifier dans l’activité récente.</p>
  </section>
</template>
<style scoped>
.media-buttons { display:flex; flex-wrap:wrap; gap:8px; margin:12px 0; }
.deezer-controls { border-top:1px solid var(--border); margin-top:20px; padding-top:16px; }
.deezer-controls form { margin:14px 0; }
.media-controls label { display:block; margin:12px 0; }
.media-controls select, .media-controls input { width:100%; margin-top:6px; }
</style>
