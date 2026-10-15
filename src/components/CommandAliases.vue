<script setup lang="ts">
import { describeError } from '../errors';
import { computed, reactive, ref, watch } from 'vue';
import { useAsyncScope } from '../composables/useAsyncScope';
import Icon from './Icon.vue';
import CommandArguments from './CommandArguments.vue';
import { commandActions, commandChoiceKey, choiceArguments, commandLabel } from '../actions';
import type { Application, CommandAlias } from '../types';
const props = defineProps<{
  applications: Application[];
  aliases: CommandAlias[];
  locked: boolean;
  save: (alias: Omit<CommandAlias, 'id'> & { id?: string }) => Promise<void>;
  remove: (id: string) => Promise<void>;
}>();
const editing = ref(false),
  editingId = ref<string>(),
  error = ref('');
const task = useAsyncScope(() => [editing.value, editingId.value].join(':')).operation();
const form = reactive({
  phrase: '',
  applicationId: '',
  action: 'open',
  arguments: {} as Record<string, string>,
});
const active = computed(() => props.applications.filter((app) => app.enabled));
const application = computed(() => props.applications.find((app) => app.id === form.applicationId));
const actions = computed(() => commandActions(application.value));
const selected = computed(() => actions.value.find((choice) => choice.key === form.action));
watch(actions, (values) => {
  if (!values.some((choice) => choice.key === form.action)) form.action = 'open';
});
function edit(alias?: CommandAlias) {
  if (props.locked || task.pending.value) return;
  editingId.value = alias?.id;
  error.value = '';
  editing.value = true;
  Object.assign(
    form,
    alias
      ? { ...alias, action: commandChoiceKey(alias), arguments: { ...alias.arguments } }
      : { phrase: '', applicationId: active.value[0]?.id || '', action: 'open', arguments: {} },
  );
}
async function saveAlias() {
  if (props.locked || !selected.value) return;
  const token = task.begin();
  if (!token) return;
  error.value = '';
  try {
    await props.save({
      id: editingId.value,
      phrase: form.phrase.trim(),
      applicationId: form.applicationId,
      action: selected.value.action,
      ...(selected.value.action.startsWith('deezer_')
        ? { arguments: choiceArguments(selected.value, form.arguments) }
        : {}),
    });
    if (token.current()) editing.value = false;
  } catch (caught) {
    if (token.current()) {
      token.fail();
      error.value = describeError(caught);
    }
  } finally {
    token.finish();
  }
}
async function removeAlias(alias: CommandAlias) {
  if (props.locked) return;
  const token = task.begin();
  if (!token) return;
  error.value = '';
  try {
    await props.remove(alias.id);
    if (token.current() && editingId.value === alias.id) editing.value = false;
  } catch (caught) {
    if (token.current()) {
      token.fail();
      error.value = describeError(caught);
    }
  } finally {
    token.finish();
  }
}
function appName(alias: CommandAlias) {
  return (
    props.applications.find((app) => app.id === alias.applicationId)?.name ||
    'Application supprimée'
  );
}
</script>
<template>
  <section class="settings-card command-aliases" aria-labelledby="command-aliases-title">
    <div class="section-heading">
      <h2 id="command-aliases-title">Formulations personnelles</h2>
      <button class="text-button" :disabled="locked || !active.length" @click="edit()">
        <Icon name="plus" :size="15" />Ajouter une formulation
      </button>
    </div>
    <p class="alias-intro">
      Apprenez à PAM vos formulations et les erreurs de transcription habituelles. Par exemple : «
      pose le navigateur » → mettre Opera GX en pause.
    </p>
    <p v-if="!aliases.length && !editing" class="muted alias-empty">
      Aucune formulation mémorisée. Vous pouvez aussi en ajouter en corrigeant une demande.
    </p>
    <ul v-if="aliases.length" class="command-alias-list">
      <li v-for="alias in aliases" :key="alias.id">
        <div>
          <strong>« {{ alias.phrase }} »</strong>
          <p>
            {{ commandLabel(alias) }} · {{ appName(alias)
            }}<span v-if="!applications.find((app) => app.id === alias.applicationId)?.enabled">
              · désactivée</span
            >
          </p>
        </div>
        <div class="alias-buttons">
          <button
            class="icon-button"
            :disabled="locked"
            :aria-label="'Modifier la formulation ' + alias.phrase"
            @click="edit(alias)"
          >
            <Icon name="edit" :size="17" /></button
          ><button
            class="icon-button danger"
            :disabled="locked"
            :aria-label="'Supprimer la formulation ' + alias.phrase"
            @click="removeAlias(alias)"
          >
            <Icon name="trash" :size="17" />
          </button>
        </div>
      </li>
    </ul>
    <form v-if="editing" class="command-alias-editor" @submit.prevent="saveAlias">
      <label class="alias-phrase"
        >Formulation à reconnaître<input
          v-model="form.phrase"
          required
          maxlength="200"
          :disabled="locked"
          placeholder="Ex. : mais le film en pose"
        /><small
          >La phrase complète sera reconnue à l’écrit et après transcription vocale.</small
        ></label
      >
      <label
        >Application<select v-model="form.applicationId" required :disabled="locked">
          <option v-if="application && !application.enabled" :value="application.id" disabled>
            {{ application.name }} · désactivée
          </option>
          <option v-for="app in active" :key="app.id" :value="app.id">{{ app.name }}</option>
        </select></label
      >
      <label
        >Action<select v-model="form.action" required :disabled="locked">
          <option v-for="choice in actions" :key="choice.key" :value="choice.key">
            {{ choice.label }}
          </option>
        </select></label
      >
      <CommandArguments v-model="form.arguments" :action="selected?.action" :disabled="locked" />
      <div class="alias-form-footer">
        <button type="button" class="secondary small" :disabled="locked" @click="editing = false">
          Annuler</button
        ><button
          class="primary small"
          :disabled="locked || !form.phrase.trim() || !application?.enabled"
        >
          {{ editingId ? 'Enregistrer les modifications' : 'Enregistrer la formulation' }}
        </button>
      </div>
    </form>
    <p v-if="error" class="result-error" role="alert">{{ error }}</p>
    <p class="muted alias-footnote">
      Seule la formulation complète est associée à cette action. « Mais » et « pose » restent
      inchangés dans vos autres textes. Le seuil de confiance et les capacités du lecteur restent
      appliqués.
    </p>
  </section>
</template>
<style scoped>
.command-aliases h2 {
  margin: 0;
}
.alias-intro {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.7;
  margin-bottom: 16px;
}
.alias-empty {
  padding: 8px 0 16px;
}
.command-alias-list {
  padding: 0;
  margin: 0;
  list-style: none;
}
.command-alias-list li {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 15px 0;
  border-bottom: 1px solid #edf0f5;
}
.command-alias-list li > div:first-child {
  flex: 1;
  min-width: 0;
}
.command-alias-list strong {
  font-size: 12px;
  font-weight: 550;
  overflow-wrap: anywhere;
}
.command-alias-list p {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.6;
  margin-top: 6px;
}
.alias-buttons {
  display: flex;
  flex-shrink: 0;
}
.command-alias-editor {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  padding: 20px 0 8px;
}
.command-alias-editor label {
  font-size: 12px;
  color: var(--text-secondary);
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
}
.command-alias-editor input,
.command-alias-editor select {
  font-size: 12px;
}
.command-alias-editor small {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.6;
}
.alias-phrase,
.alias-form-footer {
  grid-column: 1/-1;
}
.alias-form-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.alias-footnote {
  margin-top: 17px;
  line-height: 1.7;
}
@media (max-width: 700px) {
  .section-heading {
    align-items: flex-start;
    gap: 12px;
    flex-wrap: wrap;
  }
  .command-alias-editor {
    grid-template-columns: 1fr;
  }
}
</style>
