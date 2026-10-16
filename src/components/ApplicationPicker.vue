<script setup lang="ts">
import { vField } from '../composables/fieldAccessibility';
import { computed, ref } from 'vue';
import Icon from './Icon.vue';
import ModalDialog from './ModalDialog.vue';
import type { Application, InstalledApplication } from '../types';
const props = defineProps<{
  applications: InstalledApplication[];
  registered: Application[];
  loading: boolean;
  error: string;
  returnFocus?: HTMLElement | null;
}>();
const emit = defineEmits<{
  close: [];
  refresh: [];
  manual: [];
  select: [application: InstalledApplication];
}>();
const search = ref('');
const fold = (text: string) => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
const filtered = computed(() =>
  props.applications.filter((app) => fold(app.name).includes(fold(search.value.trim()))),
);
function isRegistered(app: InstalledApplication) {
  return props.registered.some(
    (existing) =>
      existing.windowsApp?.appId.toLowerCase() === app.appId.toLowerCase() ||
      fold(existing.name) === fold(app.name) ||
      existing.arguments.some(
        (argument) =>
          argument.replace(/^\{(.*)\}$/, '$1').toLowerCase() ===
          `shell:appsfolder\\${app.appId}`.toLowerCase(),
      ),
  );
}
</script>

<template>
  <ModalDialog
    class="discovery-modal"
    labelledby="discovery-title"
    :return-focus="returnFocus"
    fallback-focus="[data-dialog-fallback]"
    @close="emit('close')"
  >
    <template #default="{ requestClose }">
      <div class="modal-heading">
        <div>
          <div class="eyebrow">CONNECTER UNE APPLICATION</div>
          <h2 id="discovery-title">Choisir sur cet ordinateur</h2>
        </div>
        <button class="icon-button" aria-label="Fermer" @click="requestClose('explicit')">
          <Icon name="close" />
        </button>
      </div>
      <p class="discovery-intro">
        Choisissez une application de bureau ou du Microsoft Store, puis indiquez à PAM à quoi elle
        sert.
      </p>
      <label class="discovery-search"
        >Rechercher une application<input
          v-field
          v-model="search"
          type="search"
          placeholder="Ex. : Deezer, Code, Calculatrice…"
          data-dialog-initial-focus
      /></label>
      <div v-if="error" class="notice error" role="alert">{{ error }}</div>
      <div class="discovery-summary">
        <span aria-live="polite">{{
          loading ? 'Lecture des applications Windows…' : `${filtered.length} application(s)`
        }}</span
        ><button class="text-button" :disabled="loading" @click="emit('refresh')">
          Actualiser
        </button>
      </div>
      <div class="discovery-list" :aria-busy="loading">
        <p v-if="loading" class="discovery-empty">
          Les noms et les icônes sont récupérés depuis Windows.
        </p>
        <p v-else-if="!filtered.length" class="discovery-empty">
          {{
            search
              ? 'Aucune application ne correspond à cette recherche.'
              : 'Aucune application trouvée. Vous pouvez choisir un exécutable manuellement.'
          }}
        </p>
        <button
          v-for="app in filtered"
          v-else
          :key="app.appId"
          class="discovery-item"
          :disabled="isRegistered(app)"
          @click="emit('select', app)"
        >
          <span class="application-avatar"
            ><img v-if="app.icon" :src="app.icon" alt="" loading="lazy" /><Icon v-else name="apps"
          /></span>
          <span class="discovery-name"
            ><strong>{{ app.name }}</strong
            ><small>{{
              app.kind === 'store' ? 'Microsoft Store' : 'Application de bureau'
            }}</small></span
          >
          <span v-if="isRegistered(app)" class="discovery-added"
            ><Icon name="check" :size="15" />Déjà ajoutée</span
          ><Icon v-else name="plus" :size="18" />
        </button>
      </div>
      <div class="discovery-footer">
        <span>Une application portable ou absente de la liste ?</span
        ><button class="secondary" @click="emit('manual')">
          <Icon name="folder" :size="17" />Choisir un .exe
        </button>
      </div>
    </template>
  </ModalDialog>
</template>
