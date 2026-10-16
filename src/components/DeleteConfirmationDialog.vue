<script setup lang="ts">
import type { DeletionScope } from '../deletion';
import { commandLabel } from '../actions';
import ModalDialog from './ModalDialog.vue';
defineProps<{ scope?: DeletionScope; pending: boolean; error: string }>();
const emit = defineEmits<{ cancel: []; confirm: [] }>();
</script>
<template>
  <ModalDialog
    v-if="scope"
    labelledby="delete-title"
    :close-disabled="pending"
    fallback-focus="[data-dialog-fallback]"
    @close="emit('cancel')"
  >
    <h2 id="delete-title">
      {{
        scope.kind === 'application'
          ? 'Supprimer cette application de PAM ?'
          : 'Supprimer cette formulation ?'
      }}
    </h2>
    <template v-if="scope.kind === 'application'">
      <p>
        <strong>{{ scope.application.name }}</strong> : {{ scope.application.description }}
      </p>
      <p>La fiche PAM, sa cible de lancement et ses arguments seront supprimés.</p>
      <p>
        Cible :
        <code>{{ scope.application.windowsApp?.appId || scope.application.executable }}</code>
      </p>
      <p>
        Arguments : <code>{{ JSON.stringify(scope.application.arguments) }}</code>
      </p>
      <p>
        Noms reconnus supprimés :
        {{ scope.application.aliases.join(', ') || 'aucun nom supplémentaire' }}.
      </p>
      <p>
        {{ scope.aliases.length }} formulation(s) personnelle(s) associée(s) seront supprimées :
      </p>
    </template>
    <p v-else>
      Seule cette formulation sera supprimée. La fiche de {{ scope.application.name }} et les autres
      formulations seront conservées.
    </p>
    <ul class="deletion-aliases">
      <li v-for="alias in scope.aliases" :key="alias.id">
        « {{ alias.phrase }} » → {{ commandLabel(alias) }} · {{ scope.application.name }}
      </li>
    </ul>
    <p>
      Cette suppression est définitive après confirmation. Vous pouvez encore annuler avant de
      confirmer.
    </p>
    <p v-if="scope.kind === 'application'">L’application installée sur Windows reste disponible.</p>
    <p v-if="pending" role="status">Suppression en cours. L’annulation n’est plus disponible.</p>
    <p v-if="error" id="delete-error" class="result-error" role="alert">{{ error }}</p>
    <div class="modal-footer">
      <button
        data-delete-cancel
        data-dialog-initial-focus
        class="secondary"
        :disabled="pending"
        @click="emit('cancel')"
      >
        Annuler
      </button>
      <button
        data-delete-confirm
        class="primary"
        :disabled="pending || !!error"
        :aria-describedby="error ? 'delete-error' : undefined"
        @click="emit('confirm')"
      >
        {{ pending ? 'Suppression…' : 'Confirmer la suppression' }}
      </button>
    </div>
  </ModalDialog>
</template>
<style scoped>
.deletion-aliases {
  overflow-wrap: anywhere;
}
</style>
