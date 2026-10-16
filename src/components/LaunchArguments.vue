<script setup lang="ts">
import { computed, ref, useId, nextTick } from 'vue';
import { vField, argumentsError } from '../composables/fieldAccessibility';
import { parseLaunchArguments, previewArguments } from '../launchArguments';
const props = defineProps<{
  modelValue: string;
  executable: string;
  input: string;
  disabled: boolean;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const mode = ref<'simple' | 'json'>('simple');
const conversionError = ref('');
const helpId = useId();
const fields = ref<HTMLFieldSetElement>();
const parsed = computed(() => {
  try {
    return parseLaunchArguments(props.modelValue);
  } catch {
    return null;
  }
});
const expert = computed(() => mode.value === 'json' || !parsed.value);
function switchMode() {
  if (expert.value && !parsed.value) {
    conversionError.value =
      'Corrigez le tableau JSON avant de passer aux champs. Votre texte est conservé.';
    return;
  }
  conversionError.value = '';
  mode.value = expert.value ? 'simple' : 'json';
}
function change(index: number, value?: string) {
  if (!parsed.value || props.disabled) return;
  const args = [...parsed.value];
  if (value === undefined) args.splice(index, 1);
  else args[index] = value;
  emit('update:modelValue', JSON.stringify(args));
  if (value === undefined)
    void nextTick(() => {
      const rows = fields.value?.querySelectorAll?.('textarea');
      (
        rows?.[Math.min(index, rows.length - 1)] ||
        fields.value?.querySelector?.<HTMLButtonElement>('[data-add-argument]')
      )?.focus();
    });
}
function add() {
  if (parsed.value && !props.disabled)
    emit('update:modelValue', JSON.stringify([...parsed.value, '']));
}
</script>
<template>
  <fieldset ref="fields" class="launch-arguments" :disabled="disabled">
    <legend>Arguments de lancement</legend>
    <p :id="helpId">
      Chaque champ est un argument distinct. Gardez les espaces et les guillemets voulus ; aucun
      shell ne les interprète. <code>{input}</code> est remplacé par le texte, fichier ou URL
      demandé. Un champ vide transmet un argument vide ; supprimez-le pour l’omettre.
    </p>
    <button type="button" class="text-button" :aria-describedby="helpId" @click="switchMode">
      {{ expert ? 'Utiliser les champs simples' : 'Utiliser le JSON expert' }}
    </button>
    <p v-if="conversionError" class="field-error" role="alert">{{ conversionError }}</p>
    <label v-if="expert"
      >Tableau JSON<textarea
        v-field="() => argumentsError(modelValue)"
        :value="modelValue"
        class="code-input"
        rows="4"
        :aria-describedby="helpId"
        @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
      />
    </label>
    <template v-else>
      <p v-if="!parsed?.length" class="muted">Aucun argument.</p>
      <div v-for="(argument, index) in parsed" :key="index" class="argument-row">
        <label
          >Argument {{ index + 1
          }}<textarea
            v-field
            :value="argument"
            rows="1"
            :aria-describedby="helpId"
            @input="change(index, ($event.target as HTMLTextAreaElement).value)"
          />
        </label>
        <button
          type="button"
          class="secondary small"
          :aria-label="`Supprimer l’argument ${index + 1}`"
          @click="change(index)"
        >
          Supprimer
        </button>
      </div>
      <button type="button" class="secondary small" data-add-argument @click="add">
        Ajouter un argument
      </button>
    </template>
    <div v-if="parsed" class="launch-preview">
      <h3>Aperçu du lancement</h3>
      <p>
        Exécutable : <code>{{ executable || 'À choisir' }}</code>
      </p>
      <p>Arguments après remplacement avec la valeur de test actuelle :</p>
      <ol v-if="parsed.length">
        <li v-for="(argument, index) in previewArguments(parsed, input)" :key="index">
          <code>{{ JSON.stringify(argument) }}</code>
        </li>
      </ol>
      <p v-else>Aucun argument.</p>
      <small
        >Les guillemets d’affichage délimitent les valeurs ; ils ne sont pas ajoutés au
        lancement.</small
      >
    </div>
  </fieldset>
</template>
<style scoped>
.launch-arguments {
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  margin: 16px 0;
  padding: 12px;
}
.argument-row {
  display: flex;
  align-items: end;
  gap: 8px;
}
.argument-row label {
  flex: 1;
  min-width: 0;
}
.launch-preview code {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
