<script setup lang="ts">
import { computed } from 'vue';
import { correctionFields } from '../actions';
import type { CommandAction } from '../types';
const props = defineProps<{
  action?: CommandAction;
  modelValue: Record<string, string>;
  disabled: boolean;
}>();
const emit = defineEmits<{ 'update:modelValue': [Record<string, string>] }>();
const fields = computed(() => correctionFields(props.action));
function update(key: string, event: Event) {
  emit('update:modelValue', {
    ...props.modelValue,
    [key]: (event.target as HTMLInputElement).value,
  });
}
</script>
<template>
  <div v-if="fields.length" class="command-arguments">
    <label v-for="field in fields" :key="field.key"
      >{{ field.label || field.key }}
      <select
        v-if="field.values"
        :value="modelValue[field.key] || field.default || ''"
        :disabled="disabled"
        @change="update(field.key, $event)"
      >
        <option v-for="(label, value) in field.values" :key="value" :value="value">
          {{ label }}
        </option>
      </select>
      <input
        v-else
        :value="modelValue[field.key] || field.default || ''"
        :required="field.required"
        :pattern="field.pattern"
        :maxlength="field.maxLength"
        :inputmode="field.inputmode"
        :disabled="disabled"
        @input="update(field.key, $event)"
      />
      <small v-if="field.help">{{ field.help }}</small>
    </label>
  </div>
</template>
<style scoped>
.command-arguments {
  grid-column: 1/-1;
  display: grid;
  gap: 16px;
}
.command-arguments label {
  display: flex;
  flex-direction: column;
  gap: 7px;
  font-size: 12px;
  color: var(--text-secondary);
  min-width: 0;
}
.command-arguments input,
.command-arguments select {
  font-size: 12px;
}
.command-arguments small {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.6;
}
</style>
