<script setup lang="ts">
import { vField } from '../composables/fieldAccessibility';
import { toRefs, type UnwrapNestedRefs } from 'vue';
import Icon from '../components/Icon.vue';
import LaunchArguments from '../components/LaunchArguments.vue';
import type { Profile } from '../composables/useProfile';
import type { ApplicationEditor } from '../composables/useApplicationEditor';
import ModalDialog from '../components/ModalDialog.vue';
import DiscardDraftDialog from '../components/DiscardDraftDialog.vue';
import { useDraftGuard } from '../composables/useDraftGuard';
const props = defineProps<{
  profile: UnwrapNestedRefs<Profile>;
  applicationEditor: UnwrapNestedRefs<ApplicationEditor>;
  locked: boolean;
  dialogReturnFocus: HTMLElement | null;
}>();

const { busy } = toRefs(props.profile);
const {
  editorOpen,
  dirty,
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
  guidance,
  suggestDescription,
  testNeedsInput,
  refreshMediaSessions,
  replaceTarget,
  useExecutable,
  testLaunch,
  browse,
  saveApplication,
} = toRefs(props.applicationEditor);
const { dialogReturnFocus } = toRefs(props);
const guard = useDraftGuard();
const closeEditor = () =>
  guard.run(dirty.value, () => {
    editorOpen.value = false;
  });
</script>
<template>
  <ModalDialog
    v-if="editorOpen"
    labelledby="editor-title"
    :return-focus="dialogReturnFocus"
    fallback-focus=".sidebar nav button.selected"
    :close-disabled="busy"
    @close="closeEditor"
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
          :aria-describedby="formError ? 'application-form-error' : undefined"
          :disabled="busy"
          aria-label="Fermer"
          @click="requestClose('explicit')"
        >
          <Icon name="close" />
        </button>
      </div>
      <form
        :aria-describedby="formError ? 'application-form-error' : undefined"
        @submit.prevent="saveApplication"
      >
        <p v-if="editingAvailability?.available === false" class="notice error" role="status">
          {{ editingAvailability.reason }} Vos formulations sont conservées lors de la
          désactivation.
        </p>
        <button
          v-if="editingId"
          type="button"
          class="secondary small"
          :aria-describedby="formError ? 'application-form-error' : undefined"
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
          <button
            type="button"
            class="text-button"
            :aria-describedby="formError ? 'application-form-error' : undefined"
            :disabled="busy"
            @click="useExecutable"
          >
            Choisir un .exe
          </button>
        </div>
        <label
          >Nom de l’application<input
            v-field
            data-dialog-initial-focus
            v-model="form.name"
            required
            maxlength="60"
            placeholder="Ex. : Visual Studio Code"
            :aria-describedby="formError ? 'application-form-error' : undefined"
            :disabled="busy"
        /></label>
        <label
          >À quoi sert-elle ?<textarea
            v-field
            v-model="form.description"
            required
            maxlength="240"
            rows="2"
            placeholder="Ex. : Ouvrir l’éditeur de code et travailler sur un projet."
            :aria-describedby="formError ? 'application-form-error' : undefined"
            :disabled="busy"
          /><small
            >Décrivez uniquement les actions que PAM peut demander à cette application.</small
          ></label
        >
        <button type="button" class="text-button" :disabled="busy" @click="suggestDescription">
          Utiliser la description suggérée
        </button>
        <p class="muted">{{ guidance.limit }} Exemple : « {{ guidance.examples[0] }} ».</p>
        <div v-if="!form.windowsApp" class="executable-field">
          <label for="application-executable">Exécutable Windows</label>
          <div class="path-field">
            <input
              v-field
              id="application-executable"
              v-model="form.executable"
              required
              placeholder="C:\…\application.exe"
              :aria-describedby="formError ? 'application-form-error' : undefined"
              :disabled="busy"
            /><button
              type="button"
              class="secondary"
              :aria-describedby="formError ? 'application-form-error' : undefined"
              :disabled="busy"
              @click="browse"
            >
              <Icon name="folder" :size="18" />Parcourir
            </button>
          </div>
        </div>
        <details class="application-options">
          <summary>Options de l’application : autres noms et commandes du lecteur</summary>
          <label
            >Autres noms <span class="optional">facultatif</span
            ><input
              v-field
              v-model="form.aliases"
              placeholder="Ex. : VS Code, éditeur de code"
              :aria-describedby="formError ? 'application-form-error' : undefined"
              :disabled="busy"
            /><small>Séparez les noms par des virgules.</small></label
          >
          <label
            >Lecteur Windows <span class="optional">facultatif</span
            ><select v-field v-model="mediaSource" :disabled="busy || deezerPlugin">
              <option value="">Sans commandes multimédias</option>
              <option
                v-if="
                  mediaSource &&
                  !mediaSessions.some((session) => session.sourceAppId === mediaSource)
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
          <button
            type="button"
            class="text-button"
            :aria-describedby="formError ? 'application-form-error' : undefined"
            :disabled="busy"
            @click="refreshMediaSessions"
          >
            Actualiser les sessions
          </button>
          <p v-if="mediaError" class="result-error">{{ mediaError }}</p>
          <label v-if="deezerTarget" class="alias-choice"
            ><input
              v-field
              v-model="deezerPlugin"
              type="checkbox"
              :aria-describedby="formError ? 'application-form-error' : undefined"
              :disabled="busy"
              @change="deezerPlugin && (mediaSource = 'Deezer.exe')"
            /><span>Activer les liens Deezer Music : contenus, recherche et Flow</span></label
          >
          <LaunchArguments
            v-if="!form.windowsApp"
            v-model="form.arguments"
            :executable="form.executable"
            :input="testInput"
            :disabled="busy"
          />
        </details>
        <div class="launch-test">
          <label v-if="testNeedsInput"
            >Texte, fichier ou URL pour le test<input
              v-field
              v-model="testInput"
              maxlength="2048"
              :aria-describedby="formError ? 'application-form-error' : undefined"
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
        <div v-if="formError" id="application-form-error" class="notice error" role="alert">
          {{ formError }} La saisie est conservée ; vérifiez les champs puis réessayez.
        </div>
        <div class="modal-footer">
          <button
            type="button"
            class="secondary"
            :aria-describedby="formError ? 'application-form-error' : undefined"
            :disabled="busy"
            @click="requestClose('explicit')"
          >
            Annuler</button
          ><button
            class="primary"
            :aria-describedby="formError ? 'application-form-error' : undefined"
            :disabled="busy"
          >
            <Icon name="check" :size="17" />{{
              busy ? (testing ? 'Test en cours…' : 'Enregistrement…') : 'Enregistrer'
            }}
          </button>
        </div>
      </form>
    </template>
  </ModalDialog>
  <DiscardDraftDialog :open="guard.pending.value" @keep="guard.keep" @discard="guard.discard" />
</template>
