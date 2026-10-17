<script setup lang="ts">
import { computed, nextTick, ref, watch, toRefs, type UnwrapNestedRefs } from 'vue';
import type { Profile } from '../composables/useProfile';
import type { Requests } from '../composables/useRequests';
import type { Application } from '../types';
import { applicationGuidance, launchIdentity } from '../firstUse';
import { describeError } from '../errors';
const props = defineProps<{
  profile: UnwrapNestedRefs<Profile>;
  requests: UnwrapNestedRefs<Requests>;
  locked: boolean;
}>();
const emit = defineEmits<{ add: []; repair: [app: Application] }>();
const { text } = toRefs(props.requests);
const { settingsDraft, saveSettings, settingsDirty, settingsError } = toRefs(props.profile);
const selectedId = ref(''),
  testedIdentity = ref(''),
  message = ref(''),
  testInput = ref('');
const applications = computed(() => props.profile.config.applications);
const selected = computed(() => applications.value.find((app) => app.id === selectedId.value));
const tested = computed(
  () => !!selected.value && testedIdentity.value === launchIdentity(selected.value),
);
const needsInput = computed(() => selected.value?.arguments.some((arg) => arg.includes('{input}')));
const guidance = computed(() => (selected.value ? applicationGuidance(selected.value) : undefined));
watch(
  applications,
  (apps) => {
    if (!apps.some((app) => app.id === selectedId.value))
      selectedId.value = apps.find((app) => app.enabled)?.id || apps[0]?.id || '';
  },
  { immediate: true },
);
watch(selectedId, () => {
  message.value = '';
  testInput.value = '';
});
watch(testInput, () => {
  testedIdentity.value = '';
});
async function testOpening() {
  const app = selected.value;
  if (
    !app ||
    props.locked ||
    !app.enabled ||
    props.profile.unavailable(app) ||
    (needsInput.value && !testInput.value.trim())
  )
    return;
  const token = props.profile.beginMutation('test_application');
  if (!token) return;
  const identity = launchIdentity(app);
  message.value = '';
  testedIdentity.value = '';
  try {
    const result = await props.profile.request('test_application', {
      ...app,
      ...(needsInput.value ? { input: testInput.value } : {}),
    });
    if (token.current() && selected.value && launchIdentity(selected.value) === identity) {
      message.value = result.message;
      if (result.success) testedIdentity.value = identity;
    }
  } catch (error) {
    if (token.current())
      message.value =
        describeError(error) + ' Réparez la cible ou choisissez une autre application.';
  } finally {
    token.finish();
    void props.profile.updateHealth();
  }
}
async function useExample() {
  if (
    !guidance.value ||
    !tested.value ||
    props.locked ||
    !selected.value?.enabled ||
    props.profile.unavailable(selected.value)
  )
    return;
  if (!text.value.trim())
    text.value = guidance.value.examples[0] + (needsInput.value ? ` avec ${testInput.value}` : '');
  await nextTick();
  document.querySelector<HTMLInputElement>('#written-request')?.focus();
}
</script>
<template>
  <section class="settings-card first-use" aria-labelledby="first-use-title">
    <h2 id="first-use-title">Votre première action</h2>
    <ol>
      <li>
        <strong>Choisissez une application</strong>
        <label v-if="applications.length" for="first-use-application">Application à essayer</label>
        <select
          v-if="applications.length"
          id="first-use-application"
          v-model="selectedId"
          :disabled="locked"
        >
          <option v-for="app in applications" :key="app.id" :value="app.id">
            {{ app.name }}{{ !app.enabled ? ' · désactivée' : '' }}
          </option>
        </select>
        <button class="secondary small" :disabled="locked" @click="emit('add')">
          {{ applications.length ? 'Ajouter une application' : 'Choisir ma première application' }}
        </button>
        <div
          v-if="selected && (profile.unavailable(selected) || !selected.enabled)"
          class="notice"
          role="status"
        >
          {{
            !selected.enabled
              ? 'Cette application est désactivée.'
              : 'Cette application est indisponible.'
          }}
          Vos formulations sont conservées.
          <button :disabled="locked" @click="emit('repair', selected)">
            Réparer ou modifier {{ selected.name }}
          </button>
          <button
            v-if="selected.enabled"
            :disabled="locked"
            @click="profile.toggleApplication(selected)"
          >
            Désactiver {{ selected.name }}
          </button>
          <button v-else :disabled="locked" @click="profile.toggleApplication(selected)">
            Réactiver {{ selected.name }}
          </button>
        </div>
      </li>
      <li>
        <strong>Testez son ouverture</strong>
        <p>
          Ce test ouvre l’application avec ses arguments enregistrés. Vérifiez sa fenêtre avant de
          continuer.
        </p>
        <label v-if="needsInput" for="first-use-input"
          >Texte, fichier ou lien à transmettre pour le test</label
        >
        <input
          v-if="needsInput"
          id="first-use-input"
          v-model="testInput"
          maxlength="2048"
          :disabled="locked"
        />
        <button
          class="secondary small"
          :disabled="
            locked ||
            !selected ||
            !selected.enabled ||
            profile.unavailable(selected) ||
            (needsInput && !testInput.trim())
          "
          @click="testOpening"
        >
          Tester l’ouverture
        </button>
        <p v-if="message" role="status">{{ message }}</p>
        <p v-if="guidance" class="muted">{{ guidance.limit }}</p>
      </li>
      <li>
        <strong>Essayez une phrase</strong>
        <p v-if="guidance">
          Dites « {{ guidance.examples[0] }} » ou utilisez cette phrase à l’écrit.
        </p>
        <p v-else>Après l’ajout et le test, un exemple adapté apparaîtra ici.</p>
        <button
          class="secondary small"
          :disabled="locked || !tested || !selected?.enabled || profile.unavailable(selected)"
          @click="useExample"
        >
          {{ text.trim() ? 'Reprendre ma phrase écrite' : 'Préparer ma phrase écrite' }}
        </button>
        <p>
          Le microphone se teste juste en dessous. En cas de refus, vous pouvez toujours écrire.
        </p>
      </li>
    </ol>
    <p id="first-use-auto-help">
      L’exécution automatique est désactivée pour un nouveau profil. Si vous l’activez, une commande
      écrite simple d’ouverture sans arguments ou de lecture / pause peut s’exécuter immédiatement
      au-dessus du seuil. La voix, les arguments, les demandes composées et les autres actions
      demandent toujours votre confirmation. Le score Needle ne mesure pas la fidélité de la
      transcription. Vous pouvez modifier ce réglage dans Préférences.
    </p>
    <button
      role="switch"
      aria-label="Exécution automatique au premier usage"
      aria-describedby="first-use-auto-help"
      :aria-checked="settingsDraft.autoExecute"
      :disabled="locked"
      @click="
        settingsDraft.autoExecute = !settingsDraft.autoExecute;
        saveSettings();
      "
    >
      Exécution automatique : {{ settingsDraft.autoExecute ? 'activée' : 'désactivée' }}
    </button>
    <p v-if="settingsDirty" role="status">Préférence non enregistrée.</p>
    <p v-if="settingsError" role="alert">{{ settingsError }}</p>
  </section>
</template>
