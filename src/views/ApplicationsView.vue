<script setup lang="ts">
import { toRefs, type UnwrapNestedRefs } from 'vue';
import Icon from '../components/Icon.vue';
import type { Profile } from '../composables/useProfile';
import type { ApplicationEditor } from '../composables/useApplicationEditor';

const props = defineProps<{
  profile: UnwrapNestedRefs<Profile>;
  applicationEditor: UnwrapNestedRefs<ApplicationEditor>;
  locked: boolean;
}>();
const { locked } = toRefs(props);
const { config, toggleApplication, deleteApplication, unavailable } = toRefs(props.profile);
const { editApplication, addApplication } = toRefs(props.applicationEditor);
</script>
<template>
  <div class="page-intro inline">
    <div>
      <div class="eyebrow">VOTRE BOÎTE À OUTILS</div>
      <h1>Applications</h1>
      <p>Choisissez les applications que PAM peut lancer.</p>
    </div>
    <button class="primary" :disabled="locked" @click="addApplication()">
      <Icon name="plus" :size="18" />Ajouter une application
    </button>
  </div>
  <div v-if="!config.applications.length" class="large-empty">
    <span class="empty-icon"><Icon name="apps" :size="30" /></span>
    <h2>Faites une place à vos applications</h2>
    <p>
      Choisissez une application installée ou un exécutable,<br />puis décrivez à quoi elle sert.
    </p>
    <button class="primary" :disabled="locked" @click="addApplication()">
      <Icon name="plus" :size="17" />Ajouter une application
    </button>
  </div>
  <div class="application-list">
    <article
      v-for="app in config.applications"
      :key="app.id"
      class="application-card"
      :class="{ disabled: !app.enabled }"
    >
      <span class="application-avatar"
        ><img v-if="app.windowsApp?.icon" :src="app.windowsApp.icon" alt="" />
        <template v-else>{{ app.name.slice(0, 1).toUpperCase() }}</template></span
      >
      <div class="application-body">
        <h3>{{ app.name }}</h3>
        <p v-if="unavailable(app)" class="result-error" role="status">
          Indisponible · Réparez la cible ou choisissez une autre application.
        </p>
        <p>{{ app.description }}</p>
        <code>{{
          app.windowsApp
            ? app.windowsApp.kind === 'store'
              ? 'Microsoft Store'
              : 'Application de bureau'
            : app.executable
        }}</code>
        <div class="alias-list">
          <span v-for="alias in app.aliases" :key="alias">{{ alias }}</span
          ><span v-if="!app.windowsApp && app.arguments.length"
            >{{ app.arguments.length }} argument(s)</span
          >
        </div>
      </div>
      <div class="application-actions">
        <button
          class="toggle"
          :class="{ on: app.enabled }"
          :disabled="locked"
          role="switch"
          :aria-checked="app.enabled"
          :aria-label="`Activer ${app.name}`"
          @click="toggleApplication(app)"
        >
          <span /></button
        ><button
          class="icon-button"
          :disabled="locked"
          :aria-label="`${unavailable(app) ? 'Réparer' : 'Modifier'} ${app.name}`"
          @click="editApplication(app)"
        >
          <Icon name="edit" :size="17" /></button
        ><button
          class="icon-button danger"
          :disabled="locked"
          :aria-label="`Supprimer ${app.name}`"
          @click="deleteApplication(app)"
        >
          <Icon name="trash" :size="17" />
        </button>
      </div>
    </article>
  </div>
  <div class="notice info">
    <Icon name="info" /><span
      >PAM lance les applications enregistrées et peut leur transmettre un texte, un fichier ou une
      URL via leurs arguments. Les actions internes dépendent de ce que chaque application accepte
      en ligne de commande.</span
    >
  </div>
</template>
