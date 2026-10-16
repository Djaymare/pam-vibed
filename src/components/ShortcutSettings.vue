<script setup lang="ts">
import { useId, toRefs, type UnwrapNestedRefs } from 'vue';
import type { ShortcutPreference } from '../composables/useShortcutPreference';
const props = defineProps<{ shortcut: UnwrapNestedRefs<ShortcutPreference>; disabled?: boolean }>();
const { selected } = toRefs(props.shortcut);
const id = useId();
</script>
<template>
  <section class="settings-card shortcut-settings" :aria-labelledby="`${id}-title`">
    <h2 :id="`${id}-title`">Votre raccourci pour parler</h2>
    <p :id="`${id}-help`">
      Choisissez une combinaison puis enregistrez-la. Windows vérifie sa disponibilité. Le bouton du
      microphone et le menu de PAM restent utilisables.
    </p>
    <p v-if="shortcut.status" role="status">
      {{ shortcut.status.label }} · {{ shortcut.status.available ? 'actif' : 'indisponible' }}
    </p>
    <p
      v-if="shortcut.error || shortcut.status?.error"
      :id="`${id}-error`"
      class="result-error"
      role="alert"
    >
      {{ shortcut.error || shortcut.status?.error }}
    </p>
    <label :for="`${id}-choice`">Combinaison du raccourci</label>
    <select
      :id="`${id}-choice`"
      v-model="selected"
      :aria-describedby="`${id}-help${shortcut.error || shortcut.status?.error ? ` ${id}-error` : ''}`"
      :disabled="disabled || shortcut.pending"
    >
      <option value="ctrl_shift_space">Ctrl + Maj + Espace</option>
      <option value="ctrl_alt_space">Ctrl + Alt + Espace</option>
      <option value="ctrl_shift_f9">Ctrl + Maj + F9</option>
    </select>
    <button class="secondary small" :disabled="disabled || shortcut.pending" @click="shortcut.save">
      Enregistrer le raccourci
    </button>
    <button class="text-button" :disabled="disabled || shortcut.pending" @click="shortcut.load">
      Relire le réglage
    </button>
  </section>
</template>
