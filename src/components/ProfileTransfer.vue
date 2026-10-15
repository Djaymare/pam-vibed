<script setup lang="ts">
import { ref, watch } from 'vue';
import type { ImportPreview } from '../types';
import { describeError } from '../errors';
import type { RequestFunction } from '../ipc';
const props = defineProps<{ locked: boolean; request: RequestFunction }>();
const content = ref(''), exported = ref(''), preview = ref<ImportPreview>(), busy = ref(false), message = ref(''), error = ref('');
watch(content, () => { preview.value = undefined; });
async function run(action: () => Promise<void>) {
  if (props.locked || busy.value) return;
  busy.value = true; error.value = ''; message.value = '';
  try { await action(); } catch (caught) { error.value = describeError(caught); preview.value = undefined; }
  finally { busy.value = false; }
}
function exportProfile() { return run(async () => { exported.value = await props.request('export_config'); }); }
function inspectImport() { return run(async () => { preview.value = await props.request('preview_import', { content: content.value }); }); }
function importProfile() { return run(async () => {
  if (!preview.value) return;
  const result = await props.request('import_config', { content: content.value, ...preview.value, confirmed: true });
  preview.value = undefined; content.value = ''; exported.value = '';
  message.value = `Profil importé. Copie de l’ancien profil : ${result.backupPath}`;
}); }
function loadFile(event: Event) { return run(async () => {
  const input = event.target as HTMLInputElement, file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error('Profil trop volumineux (2 Mio maximum).');
    content.value = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
  } finally { input.value = ''; }
}); }
</script>

<template>
  <section class="settings-card profile-transfer" aria-label="Sauvegarde et transfert du profil">
    <h2>Sauvegarde et transfert du profil</h2>
    <p>Les applications, préférences et formulations restent sur cet ordinateur. Un export contient vos chemins personnels.</p>
    <button class="secondary small" :disabled="locked || busy" @click="exportProfile">Afficher l’export du profil</button>
    <div v-if="exported">
      <p>Copiez ce JSON dans un fichier local pour conserver votre export.</p>
      <textarea :value="exported" readonly rows="8" aria-label="Export du profil" spellcheck="false" />
    </div>
    <label>Importer un fichier JSON <input type="file" accept=".json,application/json" :disabled="locked || busy" @change="loadFile" /></label>
    <label>Ou collez un export <textarea v-model="content" :disabled="locked || busy" rows="5" aria-label="Profil à importer" spellcheck="false" /></label>
    <button class="secondary small" :disabled="locked || busy || !content.trim()" @click="inspectImport">Vérifier l’import</button>
    <div v-if="preview" class="notice profile-recovery" role="status">
      <p>Remplacement complet : {{ preview.summary.applications.length }} applications et {{ preview.summary.formulations }} formulations.
        Les identifiants sont conservés ; aucun mélange avec le profil actuel.</p>
      <p>{{ preview.summary.applications.join(', ') || 'Aucune application' }}</p>
      <p>Langue : {{ preview.summary.language }} · Exécution automatique : {{ preview.summary.autoExecute ? 'activée' : 'désactivée' }} · Seuil : {{ Math.round(preview.summary.confidenceThreshold * 100) }} %.</p>
      <p>Les anciens plans d’action seront retirés. Le profil actuel sera sauvegardé avant remplacement.</p>
      <button class="primary small" :disabled="locked || busy" @click="importProfile">Confirmer le remplacement du profil</button>
      <button class="secondary small" :disabled="locked || busy" @click="preview = undefined">Annuler l’import</button>
    </div>
    <p v-if="error" class="result-error" role="alert">{{ error }}</p>
    <p v-if="message" role="status">{{ message }}</p>
  </section>
</template>

<style scoped>
.profile-transfer { display: flex; flex-direction: column; align-items: stretch; gap: 14px; }
.profile-transfer label { display: flex; flex-direction: column; gap: 8px; }
.profile-transfer p { font-size: 12px; line-height: 1.65; }
.profile-transfer textarea { width: 100%; resize: vertical; }
.profile-recovery { flex-direction: column; }
</style>
