<script setup lang="ts">
import { toRefs, type UnwrapNestedRefs } from 'vue';
import Icon from '../components/Icon.vue';
import type { Profile } from '../composables/useProfile';
import type { Proposals } from '../composables/useProposals';
import ModalDialog from '../components/ModalDialog.vue';
import CommandArguments from '../components/CommandArguments.vue';
import DiscardDraftDialog from '../components/DiscardDraftDialog.vue';
import { useDraftGuard } from '../composables/useDraftGuard';
const props = defineProps<{
  profile: UnwrapNestedRefs<Profile>;
  proposals: UnwrapNestedRefs<Proposals>;
  locked: boolean;
  dialogReturnFocus: HTMLElement | null;
}>();

const { busy, activeApps } = toRefs(props.profile);
const {
  correction,
  correctionError,
  correctionStage,
  correctionSaved,
  correctionDirty,
  correctionForm,
  correctionApp,
  correctionActions,
  correctionChoice,
  correctionInput,
  correctTurn,
} = toRefs(props.proposals);
const { dialogReturnFocus } = toRefs(props);
const guard = useDraftGuard();
const closeCorrection = () =>
  guard.run(correctionDirty.value, () => {
    correction.value = undefined;
  });
</script>
<template>
  <ModalDialog
    v-if="correction"
    labelledby="correction-title"
    :return-focus="dialogReturnFocus"
    fallback-focus=".sidebar nav button.selected"
    :close-disabled="busy"
    @close="closeCorrection"
  >
    <template #default="{ requestClose }">
      <div class="modal-heading">
        <div>
          <div class="eyebrow">AFFINER VOTRE DEMANDE</div>
          <h2 id="correction-title">Corriger la demande</h2>
        </div>
        <button
          class="icon-button"
          :aria-describedby="correctionError ? 'correction-form-error' : undefined"
          :disabled="busy"
          aria-label="Fermer"
          @click="requestClose('explicit')"
        >
          <Icon name="close" />
        </button>
      </div>
      <form
        :aria-describedby="correctionError ? 'correction-form-error' : undefined"
        @submit.prevent="correctTurn"
      >
        <label
          >Ce que vous vouliez dire<textarea
            data-dialog-initial-focus
            v-model="correctionForm.text"
            required
            maxlength="2000"
            rows="3"
            :aria-describedby="correctionError ? 'correction-form-error' : undefined"
            :disabled="busy"
          />
        </label>
        <label
          >Je voulais cette application<select
            v-model="correctionForm.applicationId"
            :aria-describedby="correctionError ? 'correction-form-error' : undefined"
            :disabled="busy"
          >
            <option value="">Laisser Needle choisir</option>
            <option v-for="app in activeApps" :key="app.id" :value="app.id">{{ app.name }}</option>
          </select></label
        >
        <label v-if="correctionApp"
          >Je voulais cette action<select
            v-model="correctionForm.action"
            :aria-describedby="correctionError ? 'correction-form-error' : undefined"
            :disabled="busy"
          >
            <option value="">Interpréter la demande corrigée</option>
            <option v-for="choice in correctionActions" :key="choice.key" :value="choice.key">
              {{ choice.label }}
            </option></select
          ><small
            >Choisissez la lecture, une page ou une recherche Deezer, puis vérifiez ses
            paramètres.</small
          ></label
        >
        <CommandArguments
          v-model="correctionForm.arguments"
          :action="correctionChoice?.action"
          :error-id="correctionError ? 'correction-form-error' : undefined"
          :disabled="busy"
        />
        <label v-if="correctionInput"
          >Texte, fichier ou URL à transmettre<input
            v-model="correctionForm.input"
            maxlength="2048"
            :aria-describedby="correctionError ? 'correction-form-error' : undefined"
            :disabled="busy"
          /><small>Vérifiez cette entrée avant de préparer l’action.</small></label
        >
        <template
          v-if="correctionApp && (!correctionForm.action || correctionForm.action === 'open')"
        >
          <label class="alias-choice"
            ><input
              v-model="correctionForm.saveAlias"
              type="checkbox"
              :aria-describedby="correctionError ? 'correction-form-error' : undefined"
              :disabled="busy"
            /><span>Enregistrer un autre nom pour {{ correctionApp.name }}</span></label
          >
          <label v-if="correctionForm.saveAlias"
            >Autre nom à retenir<input
              v-model="correctionForm.alias"
              required
              maxlength="40"
              :aria-describedby="correctionError ? 'correction-form-error' : undefined"
              :disabled="busy"
            /><small>Ce nom servira pour vos prochaines demandes vocales et écrites.</small></label
          >
        </template>
        <template v-if="correctionApp && correctionForm.action">
          <label class="alias-choice"
            ><input
              v-model="correctionForm.saveCommandAlias"
              type="checkbox"
              :aria-describedby="correctionError ? 'correction-form-error' : undefined"
              :disabled="busy"
            /><span>Mémoriser une formulation pour cette action</span></label
          >
          <label v-if="correctionForm.saveCommandAlias"
            >Formulation à reconnaître<input
              v-model="correctionForm.commandPhrase"
              required
              maxlength="200"
              :aria-describedby="correctionError ? 'correction-form-error' : undefined"
              :disabled="busy"
            /><small
              >Ex. : « pose le navigateur » ou « mais le film en pose ». Retrouvez ces formulations
              dans Préférences.</small
            ></label
          >
        </template>
        <p class="correction-help">
          L’action proposée sera à valider.
          {{
            correction.status === 'pending'
              ? 'La proposition initiale sera annulée.'
              : correction.status === 'executed'
                ? 'L’action déjà exécutée reste effectuée.'
                : ''
          }}
        </p>
        <p v-if="correctionSaved" class="notice success" role="status">
          La mémorisation est enregistrée. Une reprise vérifie le profil avant toute nouvelle
          mémorisation.
        </p>
        <div v-if="correctionError" id="correction-form-error" class="notice error" role="alert">
          {{ correctionError }} Votre saisie est conservée.
          {{
            correctionSaved
              ? 'La nouvelle préparation reste à réussir ; les alias déjà enregistrés sont conservés.'
              : 'Vérifiez les champs puis réessayez.'
          }}
        </div>
        <div class="modal-footer">
          <button
            type="button"
            class="secondary"
            :aria-describedby="correctionError ? 'correction-form-error' : undefined"
            :disabled="busy"
            @click="requestClose('explicit')"
          >
            Annuler</button
          ><button class="primary" :disabled="busy || !correctionForm.text.trim()">
            {{
              busy
                ? correctionStage === 'memorization'
                  ? 'Préparation et mémorisation…'
                  : 'Préparation…'
                : 'Préparer la correction'
            }}
          </button>
        </div>
      </form>
    </template>
  </ModalDialog>
  <DiscardDraftDialog :open="guard.pending.value" @keep="guard.keep" @discard="guard.discard" />
</template>
