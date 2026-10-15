<script setup lang="ts">
import { toRefs, type UnwrapNestedRefs } from 'vue';
import type { Profile } from '../composables/useProfile';

const props = defineProps<{ profile: UnwrapNestedRefs<Profile>; locked: boolean }>();
const { locked } = toRefs(props);
const { status, recoveryOpen, recoveryBackup, recoveryChoice, beginRecovery, recoverProfile } =
  toRefs(props.profile);
</script>
<template>
  <div v-if="status?.configError" class="notice error" role="alert">
    <span>{{ status.configError.message }}</span>
    <small v-if="status.error"
      >{{ status.error.code }} · {{ status.error.stage }} · {{ status.error.requestId }}</small
    >
    <button
      v-if="status.configError.recoverable && !recoveryOpen"
      :disabled="locked"
      @click="beginRecovery"
    >
      Récupérer le profil
    </button>
  </div>
  <section
    v-if="recoveryOpen"
    class="notice profile-recovery"
    aria-label="Confirmation de récupération"
  >
    <template v-if="recoveryChoice?.backupFingerprint">
      <p>
        Dernière copie valide : {{ recoveryChoice.backupSummary.applications.length }} applications
        et {{ recoveryChoice.backupSummary.formulations }} formulations.
        {{ recoveryChoice.backupSummary.applications.join(', ') }}
      </p>
      <p>
        Langue : {{ recoveryChoice.backupSummary.language }} · Exécution automatique :
        {{ recoveryChoice.backupSummary.autoExecute ? 'activée' : 'désactivée' }} · Seuil :
        {{ Math.round(recoveryChoice.backupSummary.confidenceThreshold * 100) }} %.
      </p>
      <p>
        Le profil actuel sera conservé dans une copie exacte. Les anciens plans d’action seront
        retirés.
      </p>
      <button :disabled="locked" @click="recoverProfile(true)">
        Restaurer la dernière copie valide
      </button>
    </template>
    <template v-if="status?.configError">
      <span
        >Une copie exacte du fichier sera conservée dans le dossier du profil. Les applications et
        formulations seront retirées du profil actif et les préférences restaurées par défaut. Vous
        pourrez récupérer vos données depuis la sauvegarde. Confirmer la restauration d’un profil
        vide ?</span
      >
      <button :disabled="locked" @click="recoverProfile(false)">Sauvegarder puis restaurer</button>
    </template>
    <button :disabled="locked" @click="recoveryOpen = false">Annuler</button>
  </section>
  <div v-if="recoveryBackup" class="notice" role="status">
    Profil restauré. Original sauvegardé : {{ recoveryBackup }}
  </div>
</template>
