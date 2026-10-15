<script setup lang="ts">
import ModalDialog from './ModalDialog.vue';
defineProps<{ open: boolean }>();
const emit = defineEmits<{ keep: []; discard: [] }>();
</script>
<template>
  <ModalDialog v-if="open" labelledby="discard-draft-title" @close="emit('keep')">
    <h2 id="discard-draft-title">Abandonner les modifications ?</h2>
    <p>
      Votre saisie n’est pas enregistrée. Vous pouvez continuer à la modifier et l’enregistrer
      depuis le formulaire.
    </p>
    <p>Les alias déjà mémorisés restent enregistrés.</p>
    <div class="modal-footer">
      <button data-keep-draft data-dialog-initial-focus class="primary" @click="emit('keep')">
        Continuer la saisie
      </button>
      <button data-discard-draft class="secondary" @click="emit('discard')">
        Abandonner le brouillon
      </button>
    </div>
  </ModalDialog>
</template>
