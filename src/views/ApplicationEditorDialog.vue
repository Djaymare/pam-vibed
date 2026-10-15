<script setup lang="ts">
import { toRefs, type UnwrapNestedRefs } from 'vue';
import Icon from '../components/Icon.vue';
import type { Profile } from '../composables/useProfile';
import type { ApplicationEditor } from '../composables/useApplicationEditor';
import ModalDialog from '../components/ModalDialog.vue';
const props = defineProps<{
  profile: UnwrapNestedRefs<Profile>;
  applicationEditor: UnwrapNestedRefs<ApplicationEditor>;
  locked: boolean;
  dialogReturnFocus: HTMLElement | null;
}>();

const { busy } = toRefs(props.profile);
const {
  editorOpen,
  editingId,
  form,
  mediaSource,
  deezerPlugin,
  mediaSessions,
  mediaError,
  deezerTarget,
  formError,
  editingAvailability,
  testResult,
  testInput,
  testing,
  testNeedsInput,
  refreshMediaSessions,
  replaceTarget,
  useExecutable,
  testLaunch,
  browse,
  saveApplication,
} = toRefs(props.applicationEditor);
const { dialogReturnFocus } = toRefs(props);
</script>
<template>
  <ModalDialog
    v-if="editorOpen"
    labelledby="editor-title"
    :return-focus="dialogReturnFocus"
    fallback-focus=".sidebar nav button.selected"
    :close-disabled="busy"
    @close="editorOpen = false"
  >
    <template #default="{ requestClose }">
      <div class="modal-heading">
        <div>
          <div class="eyebrow">CONNECTER UNE APPLICATION</div>
          <h2 id="editor-title">
            {{ editingId ? 'Modifier l’application' : 'Nouvelle application' }}
          </h2>
        </div>
        <button
          class="icon-button"
          :disabled="busy"
          aria-label="Fermer"
          @click="requestClose('explicit')"
        >
          <Icon name="close" />
        </button>
      </div>
      <form @submit.prevent="saveApplication">
        <p v-if="editingAvailability?.available === false" class="notice error" role="status">
          {{ editingAvailability.reason }} Vos formulations sont conservées lors de la
          désactivation.
        </p>
        <button
          v-if="editingId"
          type="button"
          class="secondary small"
          :disabled="busy"
          @click="replaceTarget"
        >
          Choisir une autre application Windows
        </button>
        <div v-if="form.windowsApp" class="detected-target">
          <span class="application-avatar"
            ><img v-if="form.windowsApp.icon" :src="form.windowsApp.icon" alt="" /><Icon
              v-else
              name="apps"
          /></span>
          <div>
            <strong>Application détectée</strong
            ><small
              >{{
                form.windowsApp.kind === 'store' ? 'Microsoft Store' : 'Application de bureau'
              }}
              · lancement géré par Windows</small
            >
          </div>
          <button type="button" class="text-button" :disabled="busy" @click="useExecutable">
            Choisir un .exe
          </button>
        </div>
        <label
          >Nom de l’application<input
            data-dialog-initial-focus
            v-model="form.name"
            required
            maxlength="60"
            placeholder="Ex. : Visual Studio Code"
            :disabled="busy"
        /></label>
        <label
          >À quoi sert-elle ?<textarea
            v-model="form.description"
            required
            maxlength="240"
            rows="2"
            placeholder="Ex. : Ouvrir l’éditeur de code et travailler sur un projet."
            :disabled="busy"
          /><small>Cette description aide Needle à choisir la bonne application.</small></label
        >
        <label v-if="!form.windowsApp"
          >Exécutable Windows
          <div class="path-field">
            <input
              v-model="form.executable"
              required
              placeholder="C:\…\application.exe"
              :disabled="busy"
            /><button type="button" class="secondary" :disabled="busy" @click="browse">
              <Icon name="folder" :size="18" />Parcourir
            </button>
          </div></label
        >
        <label
          >Autres noms <span class="optional">facultatif</span
          ><input
            v-model="form.aliases"
            placeholder="Ex. : VS Code, éditeur de code"
            :disabled="busy"
          /><small>Séparez les noms par des virgules.</small></label
        >
        <label
          >Session multimédia Windows <span class="optional">facultatif</span
          ><select v-model="mediaSource" :disabled="busy || deezerPlugin">
            <option value="">Sans commandes multimédias</option>
            <option
              v-if="
                mediaSource && !mediaSessions.some((session) => session.sourceAppId === mediaSource)
              "
              :value="mediaSource"
            >
              {{ mediaSource }} · session absente
            </option>
            <option
              v-for="(session, index) in mediaSessions"
              :key="index"
              :value="session.sourceAppId"
            >
              {{ session.sourceAppId }} · {{ session.title || 'Média sans titre' }}
            </option></select
          ><small
            >Choisissez la session de cette application pour activer lecture, pause et piste
            suivante. Les capacités sont vérifiées à chaque commande.</small
          ></label
        >
        <button type="button" class="text-button" :disabled="busy" @click="refreshMediaSessions">
          Actualiser les sessions
        </button>
        <p v-if="mediaError" class="result-error">{{ mediaError }}</p>
        <label v-if="deezerTarget" class="alias-choice"
          ><input
            v-model="deezerPlugin"
            type="checkbox"
            :disabled="busy"
            @change="deezerPlugin && (mediaSource = 'Deezer.exe')"
          /><span>Activer le plugin Deezer Music : contenus, recherche et Flow</span></label
        >
        <details v-if="!form.windowsApp" class="advanced">
          <summary>Arguments de lancement</summary>
          <label
            >Tableau JSON<textarea
              v-model="form.arguments"
              class="code-input"
              rows="3"
              :disabled="busy"
            />
          </label>
          <p>
            Utilisez <code>[]</code> pour un lancement simple, ou <code>["{input}"]</code> pour
            transmettre le texte, le fichier ou l’URL demandé. Chaque élément reste un argument
            distinct.
          </p>
        </details>
        <div class="launch-test">
          <label v-if="testNeedsInput"
            >Texte, fichier ou URL pour le test<input
              v-model="testInput"
              maxlength="2048"
              :disabled="busy"
              placeholder="Ex. : C:\projets\mon-projet" /></label
          ><button
            type="button"
            class="secondary"
            :disabled="busy || !form.name.trim() || (!form.windowsApp && !form.executable.trim())"
            @click="testLaunch"
          >
            <Icon name="arrow" :size="17" />{{
              testing ? 'Lancement…' : 'Tester le lancement'
            }}</button
          ><small>Ce bouton ouvre l’application sans enregistrer le formulaire.</small>
        </div>
        <div
          v-if="testResult"
          class="notice"
          :class="testResult.success ? 'success' : 'error'"
          role="status"
        >
          {{ testResult.message }}
        </div>
        <div v-if="formError" class="notice error" role="alert">{{ formError }}</div>
        <div class="modal-footer">
          <button
            type="button"
            class="secondary"
            :disabled="busy"
            @click="requestClose('explicit')"
          >
            Annuler</button
          ><button class="primary" :disabled="busy">
            <Icon name="check" :size="17" />{{
              busy ? (testing ? 'Test en cours…' : 'Enregistrement…') : 'Enregistrer'
            }}
          </button>
        </div>
      </form>
    </template>
  </ModalDialog>
</template>
