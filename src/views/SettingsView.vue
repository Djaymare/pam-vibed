<script setup lang="ts">
import { vField } from '../composables/fieldAccessibility';
import { languages, languageStrings } from '../languages';
import { toRefs, type UnwrapNestedRefs } from 'vue';
import type { Profile } from '../composables/useProfile';
import CommandAliases from '../components/CommandAliases.vue';
import ProfileTransfer from '../components/ProfileTransfer.vue';
import ShortcutSettings from '../components/ShortcutSettings.vue';
import type { ShortcutPreference } from '../composables/useShortcutPreference';
const props = defineProps<{
  profile: UnwrapNestedRefs<Profile>;
  locked: boolean;
  shortcut: UnwrapNestedRefs<ShortcutPreference>;
}>();
const { locked } = toRefs(props);
const {
  status,
  config,
  diagnosticExport,
  diagnostics,
  exportDiagnostics,
  beginRecovery,
  profileRequest,
  restartEngine,
  saveSettings,
  settingsDraft,
  settingsDirty,
  settingsError,
  discardSettings,
  saveCommandAlias,
  deleteCommandAlias,
} = toRefs(props.profile);
const emit = defineEmits<{ desktop: [action: 'hide' | 'quit']; dirty: [value: boolean] }>();
const desktop = (action: 'hide' | 'quit') => emit('desktop', action);
</script>
<template>
  <div class="page-intro">
    <div class="eyebrow">À VOTRE RYTHME</div>
    <h1 tabindex="-1">Préférences</h1>
    <p>Une voix, vos règles, votre machine.</p>
  </div>
  <CommandAliases
    :applications="config.applications"
    :aliases="config.commandAliases || []"
    :locked="locked"
    :save="saveCommandAlias"
    :remove="deleteCommandAlias"
    @dirty="emit('dirty', $event)"
  />
  <ProfileTransfer :locked="locked" :request="profileRequest" />
  <section v-if="status?.profileBackup" class="settings-card">
    <h2>Dernière copie valide</h2>
    <p>Conservée avant chaque modification du profil.</p>
    <button
      class="secondary small"
      :aria-describedby="settingsError ? 'settings-error' : undefined"
      :disabled="locked"
      @click="beginRecovery"
    >
      Préparer une restauration
    </button>
  </section>
  <section class="settings-card">
    <h2>Écoute et exécution</h2>
    <div class="setting-row">
      <div>
        <label for="settings-language">Langue de transcription</label>
        <p id="settings-language-help">
          {{ languageStrings.help }} {{ languageStrings.manualCorrection }}
        </p>
      </div>
      <select
        v-field
        id="settings-language"
        v-model="settingsDraft.language"
        :aria-describedby="`settings-language-help ${settingsError ? 'settings-error' : ''}`"
        :disabled="locked"
        aria-label="Langue de transcription"
        @change="saveSettings"
      >
        <option v-for="language in languages" :key="language.id" :value="language.id">
          {{ language.option }}
        </option>
      </select>
    </div>
    <div class="setting-row">
      <div>
        <strong>Exécuter automatiquement</strong>
        <p id="settings-auto-help">
          Les demandes reconnues avec assez de confiance peuvent s’exécuter sans confirmation.<br />Sinon,
          les actions restent à valider. Un score élevé ne garantit pas un choix correct.
        </p>
      </div>
      <button
        class="toggle"
        :class="{ on: settingsDraft.autoExecute }"
        :disabled="locked"
        role="switch"
        :aria-describedby="`settings-auto-help ${settingsError ? 'settings-error' : ''}`"
        :aria-checked="settingsDraft.autoExecute"
        aria-label="Exécuter automatiquement"
        @click="
          settingsDraft.autoExecute = !settingsDraft.autoExecute;
          saveSettings();
        "
      >
        <span />
      </button>
    </div>
    <div class="setting-row">
      <div>
        <label for="settings-threshold">Seuil de confiance</label>
        <p id="settings-threshold-help">Les scores inférieurs demandent votre validation.</p>
      </div>
      <div class="range-control">
        <input
          v-field
          id="settings-threshold"
          v-model.number="settingsDraft.confidenceThreshold"
          type="range"
          min="0.1"
          max="1"
          step="0.05"
          :aria-describedby="`settings-threshold-help ${settingsError ? 'settings-error' : ''}`"
          :aria-valuetext="`${Math.round(settingsDraft.confidenceThreshold * 100)} %`"
          :disabled="locked"
          aria-label="Seuil de confiance"
          @change="saveSettings"
        /><span>{{ Math.round(settingsDraft.confidenceThreshold * 100) }} %</span>
      </div>
    </div>
    <p v-if="settingsError" id="settings-error" class="result-error" role="alert">
      {{ settingsError }} Vos valeurs sont conservées.
    </p>
    <div v-if="settingsDirty" class="alias-form-footer">
      <span role="status">Préférences non enregistrées</span>
      <button
        :aria-describedby="settingsError ? 'settings-error' : undefined"
        :disabled="locked"
        @click="discardSettings"
      >
        Rétablir les valeurs enregistrées
      </button>
      <button
        :aria-describedby="settingsError ? 'settings-error' : undefined"
        :disabled="locked"
        @click="saveSettings"
      >
        Réessayer l’enregistrement
      </button>
    </div>
  </section>
  <section class="settings-card">
    <h2>Accès rapide</h2>
    <ShortcutSettings :shortcut="shortcut" :disabled="locked" />
    <div class="setting-row">
      <div>
        <strong>PAM dans la zone de notification</strong>
        <p>
          Fermer la fenêtre réduit PAM. Un clic sur son icône réaffiche la fenêtre.<br />Le
          microphone est coupé lorsque vous masquez la fenêtre.
        </p>
      </div>
      <button class="secondary small" @click="desktop('hide')">Réduire PAM</button>
    </div>
    <div class="setting-row">
      <div>
        <strong>Quitter l’application</strong>
        <p>Arrête PAM et libère les modèles en mémoire.</p>
      </div>
      <button class="secondary small" @click="desktop('quit')">Quitter PAM</button>
    </div>
  </section>
  <section class="settings-card">
    <h2>Diagnostics locaux</h2>
    <p>
      Journal filtré : codes de panne, étapes et références, sans audio, transcription, arguments ni
      chemins personnels. Conservation : 7 jours, avec purge au prochain accès ; 3 fichiers de 64
      Kio. Aucun envoi automatique.
    </p>
    <button
      class="secondary small"
      :disabled="locked || diagnostics.pending"
      :aria-busy="diagnostics.pending"
      @click="exportDiagnostics"
    >
      {{ diagnostics.pending ? 'Préparation du diagnostic…' : 'Préparer un export de diagnostic' }}
    </button>
    <div v-if="diagnosticExport">
      <p>Copiez cet export JSON pour le conserver ou le partager volontairement.</p>
      <textarea
        v-field
        :value="diagnosticExport"
        readonly
        rows="8"
        aria-label="Export de diagnostic filtré"
        spellcheck="false"
      /><button class="text-button" @click="diagnosticExport = ''">Fermer l’export</button>
    </div>
  </section>
  <section class="settings-card">
    <h2>Diagnostics des moteurs et du lecteur</h2>
    <p>
      Whistle transcrit la voix, Needle prépare les actions et GSMTC lit les capacités du lecteur
      Windows. Ces traitements restent locaux.
    </p>
    <div class="setting-row">
      <div>
        <strong>{{ profile.runtimeLabel }}</strong>
        <p>Les modèles sont conservés entre vos demandes et repris après une panne.</p>
      </div>
      <button
        class="secondary small"
        :aria-describedby="settingsError ? 'settings-error' : undefined"
        :disabled="locked"
        @click="restartEngine"
      >
        Recharger les moteurs
      </button>
    </div>
    <div class="runtime-grid">
      <div>
        <span>Reconnaissance vocale</span><strong>Whistle</strong
        ><small>16 kHz · jusqu’à 30 secondes</small>
      </div>
      <div>
        <span>Compréhension et outils</span><strong>Needle 3</strong
        ><small>Exécution CPU locale</small>
      </div>
      <div>
        <span>Sidecar</span><strong>Node {{ status?.manifest?.node || '—' }}</strong
        ><small>npm {{ status?.manifest?.npm || '—' }} embarqué</small>
      </div>
      <div>
        <span>Plateforme</span><strong>Windows x64</strong
        ><small>Aucune installation de dépendance</small>
      </div>
    </div>
    <div v-if="status && !status.ready" class="runtime-checks">
      <p v-for="check in status.checks" :key="check.file">
        {{ check.available ? '✓' : '✕' }} {{ check.file }}
      </p>
    </div>
    <p v-if="status?.temporaryCleanup?.failed" class="result-error" role="status">
      Le nettoyage de fichiers temporaires a échoué. Ils peuvent rester sur disque ; vérifiez
      l’accès au profil puis rechargez l’état.
    </p>
    <p class="config-path">
      Configuration locale : <code>{{ status?.configDirectory || 'Indisponible' }}</code>
    </p>
  </section>
</template>
