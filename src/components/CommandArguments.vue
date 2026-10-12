<script setup lang="ts">
import {deezerContent} from '../actions';
import type {CommandAction} from '../types';
const props=defineProps<{action?:CommandAction;modelValue:Record<string,string>;disabled:boolean}>();
const emit=defineEmits<{'update:modelValue':[Record<string,string>]}>();
function update(key:string,event:Event) {emit('update:modelValue',{...props.modelValue,[key]:(event.target as HTMLInputElement).value});}
</script>
<template>
  <div v-if="action==='deezer_search' || action==='deezer_content' || action==='deezer_smarttracklist'" class="command-arguments">
    <label v-if="action==='deezer_search'">Recherche à transmettre<input :value="modelValue.query || ''" required maxlength="200" :disabled="disabled" placeholder="Ex. : Daft Punk" @input="update('query',$event)" /><small>Corrigez ici un titre ou un artiste mal transcrit. La recherche restera associée à cette phrase si vous choisissez de la mémoriser.</small></label>
    <template v-if="action==='deezer_content'">
      <label>Type de contenu<select :value="modelValue.kind || 'track'" :disabled="disabled" @change="update('kind',$event)"><option v-for="(label,key) in deezerContent" :key="key" :value="key">{{ label }}</option></select></label>
      <label>Identifiant Deezer<input :value="modelValue.id || ''" required inputmode="numeric" pattern="[1-9][0-9]{0,18}" maxlength="19" :disabled="disabled" @input="update('id',$event)" /><small>Affiche la page du contenu. La lecture d’une chanson précise reste à choisir dans Deezer.</small></label>
    </template>
    <template v-if="action==='deezer_smarttracklist'">
      <label>Identifiant de sélection<input :value="modelValue.id || ''" required pattern="[A-Za-z0-9_-]{1,80}" maxlength="80" :disabled="disabled" @input="update('id',$event)" /></label>
      <label>Action de la sélection<select :value="modelValue.mode || 'display'" :disabled="disabled" @change="update('mode',$event)"><option value="display">Afficher la sélection</option><option value="play">Demander sa lecture</option></select></label>
    </template>
  </div>
</template>
<style scoped>
.command-arguments{grid-column:1/-1;display:grid;gap:16px}.command-arguments label{display:flex;flex-direction:column;gap:7px;font-size:12px;color:var(--text-secondary);min-width:0}.command-arguments input,.command-arguments select{font-size:12px}.command-arguments small{font-size:12px;color:var(--text-secondary);line-height:1.6}
</style>
