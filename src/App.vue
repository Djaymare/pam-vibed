<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import Icon from './components/Icon.vue';
import ApplicationPicker from './components/ApplicationPicker.vue';
import MediaControls from './components/MediaControls.vue';
import { VoiceRecorder } from './audio/recorder';
import type { Application, Config, InstalledApplication, MediaSession, RuntimeStatus, Turn, WindowsApplication } from './types';

const page = ref<'assistant' | 'applications' | 'settings'>('assistant');
const status = ref<RuntimeStatus>();
const config = ref<Config>({ version: 1, applications: [], language: 'fr', autoExecute: true, confidenceThreshold: 0.7 });
const error = ref('');
const busy = ref(false);
const loading = ref(true);
const recording = ref(false);
const requestingMic = ref(false);
const seconds = ref(0);
const level = ref(0);
const text = ref('');
const turns = ref<Turn[]>([]);
const editorOpen = ref(false);
const editingId = ref<string>();
const form = reactive({ name: '', description: '', executable: '', aliases: '', arguments: '[]', enabled: true, windowsApp: undefined as WindowsApplication | undefined });
const mediaSource = ref('');
const deezerPlugin = ref(false);
const mediaSessions = ref<MediaSession[]>([]);
const mediaError = ref('');
const deezerTarget = computed(() => form.windowsApp?.appId === 'Deezer.62021768415AF_q7m17pa7q8kj0!Deezer.Music');
const formError = ref('');
const pickerOpen = ref(false);
const discoveryLoading = ref(false);
const discoveryError = ref('');
const installedApplications = ref<InstalledApplication[]>([]);
const testResult = ref<{ success: boolean; message: string }>();
const testInput = ref('');
const testing = ref(false);
const testNeedsInput = computed(() => !form.windowsApp && form.arguments.includes('{input}'));
const correction = ref<Turn>();
const correctionError = ref('');
const correctionForm = reactive({ text: '', applicationId: '', input: '', saveAlias: false, alias: '' });
const correctionApp = computed(() => activeApps.value.find(app => app.id === correctionForm.applicationId));
const correctionInput = computed(() => correctionApp.value?.arguments.some(arg => arg.includes('{input}')));
const activeApps = computed(() => config.value.applications.filter(app => app.enabled));
const locked = computed(() => busy.value || recording.value || requestingMic.value || loading.value);
const canRequest = computed(() => !!status.value?.ready && activeApps.value.length > 0 && !locked.value);
let recorder: VoiceRecorder | undefined;
let interval: number | undefined;
let limitTimer: number | undefined;
let healthTimer: number | undefined;
const unlisten: UnlistenFn[] = [];
let disposed = false;

async function request<T>(method: string, payload: unknown = {}): Promise<T> {
  if (!isTauri()) throw new Error('Ouvrez PAM avec l’application Windows pour accéder au microphone et aux applications.');
  return invoke<T>('assistant_request', { method, payload });
}
function describeError(caught: unknown) {
  if (caught instanceof DOMException && caught.name === 'NotAllowedError') return 'Accès au microphone refusé. Autorisez le microphone pour PAM dans les paramètres de confidentialité de Windows.';
  if (caught instanceof DOMException && caught.name === 'NotFoundError') return 'Aucun microphone détecté. Branchez un microphone puis réessayez.';
  return caught instanceof Error ? caught.message : String(caught);
}
async function refresh() {
  loading.value = true; error.value = '';
  try { status.value = await request<RuntimeStatus>('status'); config.value = status.value.config; }
  catch (caught) { error.value = describeError(caught); }
  finally { loading.value = false; }
}
async function updateHealth() {
  if (locked.value || !isTauri()) return;
  try { status.value = await request<RuntimeStatus>('status'); }
  catch (caught) { error.value = describeError(caught); }
}
onMounted(async () => {
  if (isTauri()) {
    for (const [event, callback] of [
      ['pam-toggle-voice', () => {
        if (editorOpen.value || pickerOpen.value || correction.value) return;
        page.value = 'assistant';
        if (recording.value) void finishRecording();
        else if (canRequest.value) void startRecording();
      }],
      ['pam-cancel-voice', () => { void cancelRecording(); }],
    ] as const) {
      const stop = await listen(event, callback);
      if (disposed) stop(); else unlisten.push(stop);
    }
  }
  if (!disposed) { await refresh(); healthTimer = window.setInterval(() => { void updateHealth(); }, 15_000); }
});
watch(recording, value => { if (isTauri()) void invoke('desktop_action', { action: value ? 'listening' : 'idle' }).catch(() => {}); });
async function process(method: string, payload: unknown) {
  busy.value = true; error.value = '';
  try {
    const turn = await request<Turn>(method, payload);
    turns.value = [turn, ...turns.value].slice(0, 20); text.value = '';
  } catch (caught) { error.value = describeError(caught); }
  finally { busy.value = false; void updateHealth(); }
}
async function submitText() { if (canRequest.value && text.value.trim()) await process('process_text', { text: text.value.trim() }); }
async function prepareMediaAction(applicationId:string, action:string, args:Record<string,string>, label:string) {
  if (!locked.value) await process('prepare_action',{applicationId,action,arguments:args,label});
}
async function refreshMediaSessions() {
  mediaError.value = '';
  try { mediaSessions.value = await request<MediaSession[]>('media_sessions'); }
  catch (caught) { mediaError.value = describeError(caught); }
}
function clearTimers() { window.clearInterval(interval); window.clearTimeout(limitTimer); }
async function startRecording() {
  if (!canRequest.value) return;
  requestingMic.value = true; error.value = ''; seconds.value = 0;
  const currentRecorder = new VoiceRecorder(); recorder = currentRecorder;
  try {
    await currentRecorder.start(value => { level.value = value; }, () => { void finishRecording(); });
    if (recorder !== currentRecorder || !requestingMic.value) { await currentRecorder.dispose(); return; }
    recording.value = true;
    interval = window.setInterval(() => { seconds.value += 1; }, 1000);
    limitTimer = window.setTimeout(() => { void finishRecording(); }, 29_500);
  } catch (caught) { if (recorder === currentRecorder) { error.value = describeError(caught); recorder = undefined; } }
  finally { if (recorder === currentRecorder || !recorder) requestingMic.value = false; }
}
async function finishRecording() {
  if (!recording.value || !recorder) return;
  recording.value = false; busy.value = true; clearTimers();
  try {
    const audio = await recorder.finish(); await process('process_audio', { audio: Array.from(audio) });
  } catch (caught) { error.value = describeError(caught); }
  finally { recorder = undefined; busy.value = false; level.value = 0; }
}
async function cancelRecording() {
  requestingMic.value = false; recording.value = false; clearTimers(); await recorder?.dispose(); recorder = undefined; level.value = 0;
}
onBeforeUnmount(() => { disposed = true; clearTimers(); window.clearInterval(healthTimer); unlisten.forEach(stop => stop()); void recorder?.dispose(); });
function editTurn(turn: Turn) {
  correction.value = turn; correctionError.value = '';
  Object.assign(correctionForm, { text: turn.transcript, applicationId: '', input: turn.calls[0]?.arguments.input || '', saveAlias: false,
    alias: turn.transcript.replace(/^(?:ouvre|ouvrez|lance|lancez|démarre|open|launch|start)\s+(?:l['’]|(?:le|la|the)\s+)?/i, '').replace(/[.!?]+$/, '').trim().slice(0, 40) });
}
async function correctTurn() {
  if (!correction.value || locked.value) return;
  const original = correction.value;
  busy.value = true; correctionError.value = '';
  try {
    const turn = await request<Turn>('correct_request', { id: original.id, text: correctionForm.text.trim(),
      applicationId: correctionForm.applicationId || undefined, input: correctionInput.value ? correctionForm.input : undefined,
      saveAlias: correctionForm.saveAlias && !!correctionApp.value, alias: correctionForm.alias });
    turns.value = [turn, ...turns.value.map(item => item.id === original.id && item.status === 'pending' ? { ...item, status: 'cancelled' as const } : item)].slice(0, 20);
    correction.value = undefined;
    status.value = await request<RuntimeStatus>('status'); config.value = status.value.config;
  } catch (caught) { correctionError.value = describeError(caught); }
  finally { busy.value = false; void updateHealth(); }
}
async function desktop(action: 'hide' | 'quit') {
  try { await invoke('desktop_action', { action }); }
  catch (caught) { error.value = describeError(caught); }
}
async function restartEngine() {
  busy.value = true; error.value = '';
  try { await request('restart_engine'); status.value = await request<RuntimeStatus>('status'); }
  catch (caught) { error.value = describeError(caught); }
  finally { busy.value = false; }
}
async function resolveTurn(turn: Turn, accept: boolean) {
  if (locked.value) return;
  busy.value = true; error.value = '';
  try {
    const updated = await request<Turn>(accept ? 'confirm' : 'discard', { id: turn.id });
    turns.value = turns.value.map(item => item.id === turn.id ? { ...item, ...updated } : item);
  } catch (caught) { error.value = describeError(caught); }
  finally { busy.value = false; }
}
function editApplication(application?: Application) {
  editingId.value = application?.id;
  form.windowsApp = application?.windowsApp;
  mediaSource.value = application?.media?.sourceAppId || '';
  deezerPlugin.value = application?.media?.deezer || false;
  void refreshMediaSessions();
  Object.assign(form, application ? { ...application, aliases: application.aliases.join(', '), arguments: JSON.stringify(application.arguments, null, 2) }
    : { name: '', description: '', executable: '', aliases: '', arguments: '[]', enabled: true });
  formError.value = ''; testResult.value = undefined; testInput.value = ''; editorOpen.value = true;
}
async function addApplication() {
  pickerOpen.value = true;
  if (!installedApplications.value.length) await discoverApplications();
}
async function discoverApplications() {
  if (discoveryLoading.value) return;
  discoveryLoading.value = true; discoveryError.value = '';
  try { installedApplications.value = await invoke<InstalledApplication[]>('discover_applications'); }
  catch (caught) { discoveryError.value = describeError(caught); }
  finally { discoveryLoading.value = false; }
}
function selectInstalled(application: InstalledApplication) {
  pickerOpen.value = false; editApplication();
  form.name = application.name.slice(0, 60);
  form.description = `Ouvrir ${form.name}.`;
  form.windowsApp = { appId: application.appId, kind: application.kind, icon: application.icon, launchArgument: application.launchArgument };
  deezerPlugin.value = false; mediaSource.value = '';
  if (deezerTarget.value) { deezerPlugin.value = true; mediaSource.value = 'Deezer.exe'; }
  // The native bridge supplies the trusted launch target when saving or testing.
}
function manualApplication() { pickerOpen.value = false; editApplication(); }
function useExecutable() { form.windowsApp = undefined; form.executable = ''; form.arguments = '[]'; testResult.value = undefined; deezerPlugin.value = false; mediaSource.value = ''; }
function applicationPayload() {
  let args: unknown;
  try { args = JSON.parse(form.arguments); } catch { throw new Error('Les arguments doivent être un tableau JSON, par exemple ["--new-window", "{input}"].'); }
  return { ...form, media:mediaSource.value ? {sourceAppId:mediaSource.value,deezer:deezerPlugin.value && deezerTarget.value} : undefined, id: editingId.value, aliases: form.aliases.split(',').map(alias => alias.trim()).filter(Boolean), arguments: args };
}
async function testLaunch() {
  busy.value = true; testing.value = true; formError.value = ''; testResult.value = undefined;
  try { testResult.value = await request('test_application', { ...applicationPayload(), input: testNeedsInput.value ? testInput.value : undefined }); }
  catch (caught) { formError.value = describeError(caught); }
  finally { busy.value = false; testing.value = false; }
}
watch(() => [form.executable, form.arguments, form.windowsApp?.appId, testInput.value], () => { testResult.value = undefined; });
async function browse() {
  try {
    const selected = await open({ title: 'Choisir une application Windows', multiple: false, directory: false,
      filters: [{ name: 'Application Windows', extensions: ['exe'] }] });
    if (typeof selected === 'string') form.executable = selected;
  } catch (caught) { formError.value = describeError(caught); }
}
async function saveApplication() {
  busy.value = true; formError.value = '';
  try {
    config.value = await request<Config>('save_application', applicationPayload());
    editorOpen.value = false;
  } catch (caught) { formError.value = describeError(caught); }
  finally { busy.value = false; }
}
async function toggleApplication(application: Application) {
  busy.value = true; error.value = '';
  try { config.value = await request<Config>('save_application', { ...application, enabled: !application.enabled }); }
  catch (caught) { error.value = describeError(caught); }
  finally { busy.value = false; }
}
async function deleteApplication(application: Application) {
  busy.value = true; error.value = '';
  try { config.value = await request<Config>('delete_application', { id: application.id }); }
  catch (caught) { error.value = describeError(caught); }
  finally { busy.value = false; }
}
async function saveSettings() {
  busy.value = true; error.value = '';
  try { config.value = await request<Config>('settings', { language: config.value.language, autoExecute: config.value.autoExecute,
    confidenceThreshold: Number(config.value.confidenceThreshold) }); }
  catch (caught) { const message = describeError(caught); await refresh(); error.value = message; }
  finally { busy.value = false; }
}
const labels: Record<Turn['status'], string> = { executed: 'Terminé', pending: 'À valider', unsupported: 'Aucune action disponible', silence: 'Aucune parole détectée', failed: 'Échec de l’action', cancelled: 'Annulé' };
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand"><span class="brand-mark"><Icon name="spark" :size="24" /></span><span>PAM<span class="brand-caption">Votre assistant, en local.</span></span></div>
      <div class="nav-label">ESPACE PERSONNEL</div>
      <nav aria-label="Navigation principale">
        <button :disabled="recording || requestingMic" :class="{ selected: page === 'assistant' }" @click="page = 'assistant'"><Icon name="mic" />Assistant</button>
        <button :disabled="recording || requestingMic" :class="{ selected: page === 'applications' }" @click="page = 'applications'"><Icon name="apps" />Applications<span class="nav-count">{{ config.applications.length }}</span></button>
        <button :disabled="recording || requestingMic" :class="{ selected: page === 'settings' }" @click="page = 'settings'"><Icon name="settings" />Préférences</button>
      </nav>
      <div class="privacy-card"><Icon name="shield" :size="22" /><strong>Sur votre machine.</strong><p>Votre voix et vos demandes sont traitées localement.</p><span class="local-dot">Windows x64</span></div>
      <div class="sidebar-footer"><span class="small-logo">P</span><div>Prototype personnel<small>Whistle + Needle</small></div><span class="version">v0.1</span></div>
    </aside>
    <main>
      <header class="topbar"><span>{{ page === 'assistant' ? 'Assistant' : page === 'applications' ? 'Applications' : 'Préférences' }}</span><span class="runtime-pill" :class="{ offline: !status?.ready }"><i />{{ loading ? 'Vérification…' : status?.engine?.loaded ? 'Moteurs en mémoire' : status?.ready ? 'Moteurs disponibles' : 'Runtime indisponible' }}</span></header>
      <div class="desktop-toolbar"><span><kbd>Ctrl</kbd> + <kbd>Maj</kbd> + <kbd>Espace</kbd> pour parler</span><button class="text-button" @click="desktop('hide')">Réduire dans la zone de notification</button></div>
      <div class="content">
        <div v-if="status?.desktop?.shortcutError" class="notice error" role="alert">{{ status.desktop.shortcutError }} Vous pouvez utiliser le microphone ou le menu de PAM dans la zone de notification.</div>
        <div v-if="error" class="notice error" role="alert"><Icon name="info" /><span>{{ error }}</span><button v-if="!status?.ready" :disabled="locked" @click="refresh">Réessayer</button><button v-else aria-label="Fermer le message" @click="error = ''"><Icon name="close" :size="16" /></button></div>
        <template v-if="page === 'assistant'">
          <div class="page-intro"><div class="eyebrow">UN MOT, UNE ACTION</div><h1>Qu’est-ce qu’on fait ?</h1><p>Parlez à PAM. Vos applications prennent le relais.</p></div>
          <section class="voice-card" aria-label="Enregistrement vocal">
            <div class="card-top"><span class="subtle-label"><span class="status-dot" :class="{ listening: recording }" />{{ recording ? 'MICROPHONE ACTIF' : busy ? 'TRAITEMENT LOCAL' : 'PRÊT À VOUS ÉCOUTER' }}</span><span class="clip-limit">{{ recording ? `${seconds} / 30 s` : '30 s maximum' }}</span></div>
            <div class="voice-center"><div class="mic-orbit" :class="{ recording }" :style="{ '--level': level }"><button class="mic-button" :class="{ recording }" :disabled="!recording && !canRequest" :aria-label="recording ? 'Arrêter et traiter la demande' : 'Commencer l’enregistrement'" @click="recording ? finishRecording() : startRecording()"><Icon :name="recording ? 'stop' : 'mic'" :size="34" /></button></div>
              <h2>{{ requestingMic ? 'Autorisez votre microphone' : recording ? 'Je vous écoute…' : busy ? 'Je traite votre demande…' : 'Appuyez pour parler' }}</h2>
              <p>{{ recording ? 'Appuyez à nouveau pour lancer votre demande.' : activeApps.length ? 'Dites, par exemple : « Ouvre ' + activeApps[0]?.name + ' »' : 'Ajoutez une application pour commencer.' }}</p>
              <button v-if="recording" class="text-button" @click="cancelRecording">Annuler l’enregistrement</button>
              <button v-else-if="!activeApps.length" class="text-button" @click="page = 'applications'; addApplication()">Ajouter ma première application <Icon name="arrow" :size="15" /></button>
            </div>
            <div class="pipeline"><span><Icon name="mic" :size="15" />Voix</span><Icon name="chevron" :size="12" /><span>Whistle<small>transcrit</small></span><Icon name="chevron" :size="12" /><span>Needle<small>comprend</small></span><Icon name="chevron" :size="12" /><span><Icon name="apps" :size="15" />Application</span></div>
          </section>
          <form class="text-request" @submit.prevent="submitText"><input v-model="text" :disabled="locked" maxlength="2000" aria-label="Demande écrite" placeholder="Vous préférez écrire ? Entrez votre demande…" /><button class="send-button" :disabled="!canRequest || !text.trim()" aria-label="Envoyer la demande"><Icon name="arrow" :size="20" /></button></form>
          <MediaControls :applications="config.applications" :locked="locked" @action="prepareMediaAction" />
          <section class="connected"><div class="section-heading"><h3>Vos applications<span>{{ activeApps.length }}</span></h3><button class="text-button" :disabled="locked" @click="page = 'applications'">Gérer <Icon name="arrow" :size="14" /></button></div><div v-if="activeApps.length" class="app-chips"><span v-for="app in activeApps" :key="app.id"><span class="app-initial">{{ app.name.slice(0, 1).toUpperCase() }}</span>{{ app.name }}<i /></span></div><p v-else class="empty-inline">Aucune application connectée pour le moment.</p></section>
          <section class="history"><div class="section-heading"><h3>Activité récente</h3><span class="muted">Cette session uniquement</span></div>
            <div v-if="!turns.length" class="history-empty"><Icon name="clock" :size="22" /><p>Votre première demande apparaîtra ici.</p></div>
            <article v-for="turn in turns" :key="turn.id" class="turn-card"><div class="turn-head"><span class="turn-badge" :class="turn.status"><Icon :name="turn.status === 'executed' ? 'check' : 'info'" :size="14" />{{ labels[turn.status] }}</span><span class="turn-metrics">{{ (turn.durationMs / 1000).toFixed(2) }} s<span v-if="turn.confidence !== null"> · confiance Needle {{ Math.round(turn.confidence * 100) }} %</span></span></div><p class="transcript">{{ turn.transcript || 'Le microphone n’a capté aucune parole.' }}</p><div v-if="turn.calls.length" class="call-list"><div v-for="(call, index) in turn.calls" :key="index"><Icon name="arrow" :size="14" /><strong>{{ call.actionLabel || 'Ouvrir' }} {{ call.applicationName }}</strong><code v-if="Object.keys(call.arguments).length">{{ Object.entries(call.arguments).map(([key,value]) => `${key} : ${value}`).join(' · ') }}</code></div></div><p v-if="turn.status === 'unsupported'" class="muted">{{ turn.message || 'Cette demande ne correspond à aucune action actuellement disponible. Consultez les sessions et les capacités de votre lecteur.' }}</p><p v-for="(result, index) in turn.results" :key="index" :class="result.success ? 'result-success' : 'result-error'">{{ result.message }}</p><div v-if="turn.status === 'pending'" class="approval"><p>Vérifiez les actions proposées avant de les lancer.</p><button class="primary small" :disabled="locked" @click="resolveTurn(turn, true)"><Icon name="check" :size="16" />Exécuter</button><button class="secondary small" :disabled="locked" @click="resolveTurn(turn, false)">Annuler</button></div><div class="turn-correction"><span v-if="turn.correctedFrom" class="muted">Demande corrigée · validation requise</span><button class="text-button" :disabled="locked" @click="editTurn(turn)"><Icon name="edit" :size="14" />Corriger la demande</button></div><details v-if="turn.reasoning"><summary>Raisonnement Needle</summary><p>{{ turn.reasoning }}</p></details></article>
          </section>
        </template>
        <template v-else-if="page === 'applications'">
          <div class="page-intro inline"><div><div class="eyebrow">VOTRE BOÎTE À OUTILS</div><h1>Applications</h1><p>Choisissez les applications que PAM peut lancer.</p></div><button class="primary" :disabled="locked" @click="addApplication()"><Icon name="plus" :size="18" />Ajouter une application</button></div>
          <div v-if="!config.applications.length" class="large-empty"><span class="empty-icon"><Icon name="apps" :size="30" /></span><h2>Faites une place à vos applications</h2><p>Choisissez une application installée ou un exécutable,<br />puis décrivez à quoi elle sert.</p><button class="primary" :disabled="locked" @click="addApplication()"><Icon name="plus" :size="17" />Ajouter une application</button></div>
          <div class="application-list"><article v-for="app in config.applications" :key="app.id" class="application-card" :class="{ disabled: !app.enabled }"><span class="application-avatar"><img v-if="app.windowsApp?.icon" :src="app.windowsApp.icon" alt="" /> <template v-else>{{ app.name.slice(0, 1).toUpperCase() }}</template></span><div class="application-body"><h3>{{ app.name }}</h3><p>{{ app.description }}</p><code>{{ app.windowsApp ? (app.windowsApp.kind === 'store' ? 'Microsoft Store' : 'Application de bureau') : app.executable }}</code><div class="alias-list"><span v-for="alias in app.aliases" :key="alias">{{ alias }}</span><span v-if="!app.windowsApp && app.arguments.length">{{ app.arguments.length }} argument(s)</span></div></div><div class="application-actions"><button class="toggle" :class="{ on: app.enabled }" :disabled="locked" role="switch" :aria-checked="app.enabled" :aria-label="`Activer ${app.name}`" @click="toggleApplication(app)"><span /></button><button class="icon-button" :disabled="locked" :aria-label="`Modifier ${app.name}`" @click="editApplication(app)"><Icon name="edit" :size="17" /></button><button class="icon-button danger" :disabled="locked" :aria-label="`Supprimer ${app.name}`" @click="deleteApplication(app)"><Icon name="trash" :size="17" /></button></div></article></div>
          <div class="notice info"><Icon name="info" /><span>PAM lance les applications enregistrées et peut leur transmettre un texte, un fichier ou une URL via leurs arguments. Les actions internes dépendent de ce que chaque application accepte en ligne de commande.</span></div>
        </template>
        <template v-else>
          <div class="page-intro"><div class="eyebrow">À VOTRE RYTHME</div><h1>Préférences</h1><p>Une voix, vos règles, votre machine.</p></div>
          <section class="settings-card"><h2>Écoute et exécution</h2><div class="setting-row"><div><strong>Langue de transcription</strong><p>Whistle comprend sept langues, ou détecte la langue.</p></div><select v-model="config.language" :disabled="locked" aria-label="Langue de transcription" @change="saveSettings"><option value="auto">Détection automatique</option><option value="fr">Français</option><option value="en">English</option><option value="de">Deutsch</option><option value="es">Español</option><option value="it">Italiano</option><option value="nl">Nederlands</option><option value="pl">Polski</option></select></div><div class="setting-row"><div><strong>Exécuter automatiquement</strong><p>Lancer les actions quand Needle atteint le seuil de confiance.<br />Sinon, les actions restent à valider.</p></div><button class="toggle" :class="{ on: config.autoExecute }" :disabled="locked" role="switch" :aria-checked="config.autoExecute" aria-label="Exécuter automatiquement" @click="config.autoExecute = !config.autoExecute; saveSettings()"><span /></button></div><div class="setting-row"><div><strong>Seuil de confiance</strong><p>Les scores inférieurs demandent votre validation.</p></div><div class="range-control"><input v-model="config.confidenceThreshold" type="range" min="0.1" max="1" step="0.05" :disabled="locked" aria-label="Seuil de confiance" @change="saveSettings" /><span>{{ Math.round(config.confidenceThreshold * 100) }} %</span></div></div></section>
          <section class="settings-card"><h2>Accès rapide</h2><div class="setting-row"><div><strong>Raccourci global</strong><p>Ctrl + Maj + Espace démarre ou arrête l’enregistrement, depuis vos autres applications.</p></div><span class="muted">{{ status?.desktop?.shortcutAvailable ? 'Actif' : 'Indisponible' }}</span></div><div class="setting-row"><div><strong>PAM dans la zone de notification</strong><p>Fermer la fenêtre réduit PAM. Un clic sur son icône réaffiche la fenêtre.<br />Le microphone est coupé lorsque vous masquez la fenêtre.</p></div><button class="secondary small" @click="desktop('hide')">Réduire PAM</button></div><div class="setting-row"><div><strong>Quitter l’application</strong><p>Arrête PAM et libère les modèles en mémoire.</p></div><button class="secondary small" @click="desktop('quit')">Quitter PAM</button></div></section>
          <section class="settings-card"><h2>Runtime embarqué</h2><div class="setting-row"><div><strong>{{ status?.engine?.loaded ? 'Whistle et Needle en mémoire' : 'Moteurs disponibles' }}</strong><p>Les modèles sont conservés entre vos demandes et repris après une panne.</p></div><button class="secondary small" :disabled="locked" @click="restartEngine">Recharger les moteurs</button></div><div class="runtime-grid"><div><span>Reconnaissance vocale</span><strong>Whistle</strong><small>16 kHz · jusqu’à 30 secondes</small></div><div><span>Compréhension et outils</span><strong>Needle 3</strong><small>Exécution CPU locale</small></div><div><span>Sidecar</span><strong>Node {{ status?.manifest?.node || '—' }}</strong><small>npm {{ status?.manifest?.npm || '—' }} embarqué</small></div><div><span>Plateforme</span><strong>Windows x64</strong><small>Aucune installation de dépendance</small></div></div><div v-if="status && !status.ready" class="runtime-checks"><p v-for="check in status.checks" :key="check.file">{{ check.available ? '✓' : '✕' }} {{ check.file }}</p></div><p class="config-path">Configuration locale : <code>{{ status?.configDirectory || 'Indisponible' }}</code></p></section>
        </template>
        <footer class="content-footer"><Icon name="shield" :size="13" />Traitement local · aucun compte requis<span>PAM / PROTOTYPE</span></footer>
      </div>
    </main>
    <div v-if="correction" class="modal-backdrop" @click.self="!busy && (correction = undefined)">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="correction-title">
        <div class="modal-heading"><div><div class="eyebrow">AFFINER VOTRE DEMANDE</div><h2 id="correction-title">Corriger la demande</h2></div><button class="icon-button" :disabled="busy" aria-label="Fermer" @click="correction = undefined"><Icon name="close" /></button></div>
        <form @submit.prevent="correctTurn">
          <label>Ce que vous vouliez dire<textarea v-model="correctionForm.text" required maxlength="2000" rows="3" :disabled="busy" /></label>
          <label>Je voulais cette application<select v-model="correctionForm.applicationId" :disabled="busy"><option value="">Laisser Needle choisir</option><option v-for="app in activeApps" :key="app.id" :value="app.id">{{ app.name }}</option></select></label>
          <label v-if="correctionInput">Texte, fichier ou URL à transmettre<input v-model="correctionForm.input" maxlength="2048" :disabled="busy" /><small>Vérifiez cette entrée avant de préparer l’action.</small></label>
          <template v-if="correctionApp">
            <label class="alias-choice"><input v-model="correctionForm.saveAlias" type="checkbox" :disabled="busy" /><span>Enregistrer un autre nom pour {{ correctionApp.name }}</span></label>
            <label v-if="correctionForm.saveAlias">Autre nom à retenir<input v-model="correctionForm.alias" required maxlength="40" :disabled="busy" /><small>Ce nom servira pour vos prochaines demandes vocales et écrites.</small></label>
          </template>
          <p class="correction-help">L’action proposée sera à valider. {{ correction.status === 'pending' ? 'La proposition initiale sera annulée.' : correction.status === 'executed' ? 'L’action déjà exécutée reste effectuée.' : '' }}</p>
          <div v-if="correctionError" class="notice error" role="alert">{{ correctionError }}</div>
          <div class="modal-footer"><button type="button" class="secondary" :disabled="busy" @click="correction = undefined">Annuler</button><button class="primary" :disabled="busy || !correctionForm.text.trim()">{{ busy ? 'Préparation…' : 'Préparer la correction' }}</button></div>
        </form>
      </section>
    </div>
    <ApplicationPicker v-if="pickerOpen" :applications="installedApplications" :registered="config.applications" :loading="discoveryLoading" :error="discoveryError" @close="pickerOpen = false" @refresh="discoverApplications" @manual="manualApplication" @select="selectInstalled" />
    <div v-if="editorOpen" class="modal-backdrop" @click.self="!busy && (editorOpen = false)" @keydown.esc="!busy && (editorOpen = false)">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="editor-title">
        <div class="modal-heading"><div><div class="eyebrow">CONNECTER UNE APPLICATION</div><h2 id="editor-title">{{ editingId ? 'Modifier l’application' : 'Nouvelle application' }}</h2></div><button class="icon-button" :disabled="busy" aria-label="Fermer" @click="editorOpen = false"><Icon name="close" /></button></div>
        <form @submit.prevent="saveApplication">
          <div v-if="form.windowsApp" class="detected-target"><span class="application-avatar"><img v-if="form.windowsApp.icon" :src="form.windowsApp.icon" alt="" /><Icon v-else name="apps" /></span><div><strong>Application détectée</strong><small>{{ form.windowsApp.kind === 'store' ? 'Microsoft Store' : 'Application de bureau' }} · lancement géré par Windows</small></div><button type="button" class="text-button" :disabled="busy" @click="useExecutable">Choisir un .exe</button></div>
          <label>Nom de l’application<input v-model="form.name" required maxlength="60" placeholder="Ex. : Visual Studio Code" :disabled="busy" /></label>
          <label>À quoi sert-elle ?<textarea v-model="form.description" required maxlength="240" rows="2" placeholder="Ex. : Ouvrir l’éditeur de code et travailler sur un projet." :disabled="busy" /><small>Cette description aide Needle à choisir la bonne application.</small></label>
          <label v-if="!form.windowsApp">Exécutable Windows<div class="path-field"><input v-model="form.executable" required placeholder="C:\…\application.exe" :disabled="busy" /><button type="button" class="secondary" :disabled="busy" @click="browse"><Icon name="folder" :size="18" />Parcourir</button></div></label>
          <label>Autres noms <span class="optional">facultatif</span><input v-model="form.aliases" placeholder="Ex. : VS Code, éditeur de code" :disabled="busy" /><small>Séparez les noms par des virgules.</small></label>
          <label>Session multimédia Windows <span class="optional">facultatif</span><select v-model="mediaSource" :disabled="busy || deezerPlugin"><option value="">Sans commandes multimédias</option><option v-if="mediaSource && !mediaSessions.some(session => session.sourceAppId === mediaSource)" :value="mediaSource">{{ mediaSource }} · session absente</option><option v-for="(session,index) in mediaSessions" :key="index" :value="session.sourceAppId">{{ session.sourceAppId }} · {{ session.title || 'Média sans titre' }}</option></select><small>Choisissez la session de cette application pour activer lecture, pause et piste suivante. Les capacités sont vérifiées à chaque commande.</small></label>
          <button type="button" class="text-button" :disabled="busy" @click="refreshMediaSessions">Actualiser les sessions</button>
          <p v-if="mediaError" class="result-error">{{ mediaError }}</p>
          <label v-if="deezerTarget" class="alias-choice"><input v-model="deezerPlugin" type="checkbox" :disabled="busy" @change="deezerPlugin && (mediaSource = 'Deezer.exe')" /><span>Activer le plugin Deezer Music : contenus, recherche et Flow</span></label>
          <details v-if="!form.windowsApp" class="advanced"><summary>Arguments de lancement</summary><label>Tableau JSON<textarea v-model="form.arguments" class="code-input" rows="3" :disabled="busy" /></label><p>Utilisez <code>[]</code> pour un lancement simple, ou <code>["{input}"]</code> pour transmettre le texte, le fichier ou l’URL demandé. Chaque élément reste un argument distinct.</p></details>
          <div class="launch-test"><label v-if="testNeedsInput">Texte, fichier ou URL pour le test<input v-model="testInput" maxlength="2048" :disabled="busy" placeholder="Ex. : C:\projets\mon-projet" /></label><button type="button" class="secondary" :disabled="busy || !form.name.trim() || (!form.windowsApp && !form.executable.trim())" @click="testLaunch"><Icon name="arrow" :size="17" />{{ testing ? 'Lancement…' : 'Tester le lancement' }}</button><small>Ce bouton ouvre l’application sans enregistrer le formulaire.</small></div>
          <div v-if="testResult" class="notice" :class="testResult.success ? 'success' : 'error'" role="status">{{ testResult.message }}</div>
          <div v-if="formError" class="notice error" role="alert">{{ formError }}</div>
          <div class="modal-footer"><button type="button" class="secondary" :disabled="busy" @click="editorOpen = false">Annuler</button><button class="primary" :disabled="busy"><Icon name="check" :size="17" />{{ busy ? (testing ? 'Test en cours…' : 'Enregistrement…') : 'Enregistrer' }}</button></div>
        </form>
      </section>
    </div>
  </div>
</template>
<style src="./style.css"></style>
