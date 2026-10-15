<script setup lang="ts">
import { toRefs, type UnwrapNestedRefs } from 'vue';
import type { Profile } from '../composables/useProfile';
import CommandAliases from '../components/CommandAliases.vue';
import ProfileTransfer from '../components/ProfileTransfer.vue';
const props = defineProps<{ profile: UnwrapNestedRefs<Profile>; locked: boolean }>();
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
  saveCommandAlias,
  deleteCommandAlias,
} = toRefs(props.profile);
const emit = defineEmits<{ desktop: [action: 'hide' | 'quit'] }>();
const desktop = (action: 'hide' | 'quit') => emit('desktop', action);
</script>
<template>
  <div class="page-intro">
    <div class="eyebrow">À VOTRE RYTHME</div>
    <h1>Préférences</h1>
    <p>Une voix, vos règles, votre machine.</p>
  </div>
  <CommandAliases
    :applications="config.applications"
    :aliases="config.commandAliases || []"
    :locked="locked"
    :save="saveCommandAlias"
    :remove="deleteCommandAlias"
  />
  <ProfileTransfer :locked="locked" :request="profileRequest" />
  <section v-if="status?.profileBackup" class="settings-card">
    <h2>Dernière copie valide</h2>
    <p>Conservée avant chaque modification du profil.</p>
    <button class="secondary small" :disabled="locked" @click="beginRecovery">
      Préparer une restauration
    </button>
  </section>
  <section class="settings-card">
    <h2>Écoute et exécution</h2>
    <div class="setting-row">
      <div>
        <strong>Langue de transcription</strong>
        <p>Whistle comprend sept langues, ou détecte la langue.</p>
      </div>
      <select
        v-model="config.language"
        :disabled="locked"
        aria-label="Langue de transcription"
        @change="saveSettings"
      >
        <option value="auto">Détection automatique</option>
        <option value="fr">Français</option>
        <option value="en">English</option>
        <option value="de">Deutsch</option>
        <option value="es">Español</option>
        <option value="it">Italiano</option>
        <option value="nl">Nederlands</option>
        <option value="pl">Polski</option>
      </select>
    </div>
    <div class="setting-row">
      <div>
        <strong>Exécuter automatiquement</strong>
        <p>
          Lancer les actions quand Needle atteint le seuil de confiance.<br />Sinon, les actions
          restent à valider.
        </p>
      </div>
      <button
        class="toggle"
        :class="{ on: config.autoExecute }"
        :disabled="locked"
        role="switch"
        :aria-checked="config.autoExecute"
        aria-label="Exécuter automatiquement"
        @click="
          config.autoExecute = !config.autoExecute;
          saveSettings();
        "
      >
        <span />
      </button>
    </div>
    <div class="setting-row">
      <div>
        <strong>Seuil de confiance</strong>
        <p>Les scores inférieurs demandent votre validation.</p>
      </div>
      <div class="range-control">
        <input
          v-model="config.confidenceThreshold"
          type="range"
          min="0.1"
          max="1"
          step="0.05"
          :disabled="locked"
          aria-label="Seuil de confiance"
          @change="saveSettings"
        /><span>{{ Math.round(config.confidenceThreshold * 100) }} %</span>
      </div>
    </div>
  </section>
  <section class="settings-card">
    <h2>Accès rapide</h2>
    <div class="setting-row">
      <div>
        <strong>Raccourci global</strong>
        <p>
          Ctrl + Maj + Espace démarre ou arrête l’enregistrement, depuis vos autres applications.
        </p>
      </div>
      <span class="muted">{{ status?.desktop?.shortcutAvailable ? 'Actif' : 'Indisponible' }}</span>
    </div>
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
        :value="diagnosticExport"
        readonly
        rows="8"
        aria-label="Export de diagnostic filtré"
        spellcheck="false"
      /><button class="text-button" @click="diagnosticExport = ''">Fermer l’export</button>
    </div>
  </section>
  <section class="settings-card">
    <h2>Runtime embarqué</h2>
    <div class="setting-row">
      <div>
        <strong>{{
          status?.engine?.loaded ? 'Whistle et Needle en mémoire' : 'Moteurs disponibles'
        }}</strong>
        <p>Les modèles sont conservés entre vos demandes et repris après une panne.</p>
      </div>
      <button class="secondary small" :disabled="locked" @click="restartEngine">
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
