<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { isTauri } from '@tauri-apps/api/core';
import { request as ipcRequest, desktopAction, type RequestFunction } from './ipc';
import { describeError } from './errors';
import Icon from './components/Icon.vue';
import ApplicationPicker from './components/ApplicationPicker.vue';
import AssistantView from './views/AssistantView.vue';
import ApplicationsView from './views/ApplicationsView.vue';
import SettingsView from './views/SettingsView.vue';
import CorrectionDialog from './views/CorrectionDialog.vue';
import ApplicationEditorDialog from './views/ApplicationEditorDialog.vue';
import ProfileRecovery from './views/ProfileRecovery.vue';
import { useProfile } from './composables/useProfile';
import { useProposals } from './composables/useProposals';
import { useRequests } from './composables/useRequests';
import { useAudio } from './composables/useAudio';
import { useApplicationEditor } from './composables/useApplicationEditor';
import { useVoiceShortcuts } from './composables/useVoiceShortcuts';
import { useDraftGuard } from './composables/useDraftGuard';
import DiscardDraftDialog from './components/DiscardDraftDialog.vue';
const page = ref<'assistant' | 'applications' | 'settings'>('assistant');
const dialogReturnFocus = ref<HTMLElement | null>(null);
function rememberDialogTrigger() {
  dialogReturnFocus.value =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
}
const request: RequestFunction = (method, payload) => {
  if (!isTauri())
    throw new Error(
      'Ouvrez PAM avec l’application Windows pour accéder au microphone et aux applications.',
    );
  return ipcRequest(method, payload);
};
const profile = useProfile(
  request,
  () => locked.value,
  (value) => proposals.reconcile(value.proposals),
  () => page.value,
);
const proposals = useProposals(profile, () => locked.value, rememberDialogTrigger);
const requests = useRequests(
  profile,
  proposals,
  () => canRequest.value,
  () => locked.value,
);
const audio = useAudio(profile, requests, () => canRequest.value);
const applicationEditor = useApplicationEditor(profile, rememberDialogTrigger);
const { status, config, error, loading, busy, activeApps, refresh } = profile;
const { recording, requestingMic } = audio;
const {
  editorOpen,
  pickerOpen,
  installedApplications,
  replacingTarget,
  editingId,
  discoveryLoading,
  discoveryError,
  closePicker,
  discoverApplications,
  manualApplication,
  selectInstalled,
} = applicationEditor;
const { correction } = proposals;
const aliasDirty = ref(false);
const guard = useDraftGuard();
function navigate(next: typeof page.value) {
  if (next === page.value) return;
  guard.run(applicationEditor.dirty.value || proposals.correctionDirty.value, () => {
    page.value = next;
  });
}
const locked = computed(
  () => busy.value || recording.value || requestingMic.value || loading.value,
);
const canRequest = computed(
  () => !!status.value?.ready && activeApps.value.length > 0 && !locked.value,
);
const desktopTask = profile.scope.operation();
async function desktop(action: 'hide' | 'quit') {
  if (action === 'quit') {
    guard.run(
      applicationEditor.dirty.value ||
        proposals.correctionDirty.value ||
        profile.settingsDirty.value ||
        aliasDirty.value ||
        !!requests.text.value,
      () => {
        void performDesktop(action);
      },
    );
    return;
  }
  await performDesktop(action);
}
async function performDesktop(action: 'hide' | 'quit') {
  const token = desktopTask.begin();
  if (!token) return;
  try {
    await desktopAction(action);
  } catch (caught) {
    if (token.current()) {
      token.fail();
      error.value = describeError(caught);
    }
  } finally {
    token.finish();
  }
}
const ui = reactive({ profile, proposals, requests, audio, applicationEditor });
function showApplications(add: boolean) {
  navigate('applications');
  if (add) void applicationEditor.addApplication();
}
const shortcuts = useVoiceShortcuts(
  () => {
    if (editorOpen.value || pickerOpen.value || correction.value) return;
    navigate('assistant');
    if (recording.value) void audio.finishRecording();
    else if (canRequest.value) void audio.startRecording();
  },
  () => {
    void audio.cancelRecording();
  },
);
const shortcutError = shortcuts.error;
</script>
<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-mark"><Icon name="spark" :size="24" /></span
        ><span>PAM<span class="brand-caption">Votre assistant, en local.</span></span>
      </div>
      <div class="nav-label">ESPACE PERSONNEL</div>
      <nav aria-label="Navigation principale">
        <button
          data-dialog-fallback
          aria-label="Assistant"
          :disabled="recording || requestingMic"
          :class="{ selected: page === 'assistant' }"
          @click="navigate('assistant')"
        >
          <Icon name="mic" />Assistant
        </button>
        <button
          aria-label="Applications"
          :disabled="recording || requestingMic"
          :class="{ selected: page === 'applications' }"
          @click="navigate('applications')"
        >
          <Icon name="apps" />Applications<span class="nav-count">{{
            config.applications.length
          }}</span>
        </button>
        <button
          aria-label="Préférences"
          :disabled="recording || requestingMic"
          :class="{ selected: page === 'settings' }"
          @click="navigate('settings')"
        >
          <Icon name="settings" />Préférences
        </button>
      </nav>
      <div class="privacy-card">
        <Icon name="shield" :size="22" /><strong>Sur votre machine.</strong>
        <p>Votre voix et vos demandes sont traitées localement.</p>
        <span class="local-dot">Windows x64</span>
      </div>
      <div class="sidebar-footer">
        <span class="small-logo">P</span>
        <div>Prototype personnel<small>Whistle + Needle</small></div>
        <span class="version">v0.1</span>
      </div>
    </aside>
    <main>
      <header class="topbar">
        <span>{{
          page === 'assistant'
            ? 'Assistant'
            : page === 'applications'
              ? 'Applications'
              : 'Préférences'
        }}</span
        ><span class="runtime-pill" :class="{ offline: !status?.ready }"
          ><i />{{
            loading
              ? 'Vérification…'
              : status?.engine?.loaded
                ? 'Moteurs en mémoire'
                : status?.ready
                  ? 'Moteurs disponibles'
                  : 'Runtime indisponible'
          }}</span
        >
      </header>
      <div class="desktop-toolbar">
        <span><kbd>Ctrl</kbd> + <kbd>Maj</kbd> + <kbd>Espace</kbd> pour parler</span
        ><button class="text-button" @click="desktop('hide')">
          Réduire dans la zone de notification
        </button>
      </div>
      <div class="content">
        <p
          v-if="page !== 'settings' && (aliasDirty || ui.profile.settingsDirty)"
          class="notice"
          role="status"
        >
          Votre brouillon de préférences ou de formulation est conservé en mémoire.
          <button @click="navigate('settings')">Reprendre dans Préférences</button>
        </p>
        <ProfileRecovery :profile="ui.profile" :locked="locked" />
        <div v-if="shortcutError" class="notice error" role="alert">
          <span>{{ shortcutError }}</span>
          <button :disabled="shortcuts.registration.pending.value" @click="shortcuts.install">
            Réessayer les raccourcis
          </button>
        </div>
        <div v-if="status?.desktop?.shortcutError" class="notice error" role="alert">
          {{ status.desktop.shortcutError }} Vous pouvez utiliser le microphone ou le menu de PAM
          dans la zone de notification.
        </div>
        <div v-if="error" class="notice error" role="alert">
          <Icon name="info" /><span>{{ error }}</span
          ><button v-if="!status?.ready" :disabled="locked" @click="refresh">Réessayer</button
          ><button v-else aria-label="Fermer le message" @click="error = ''">
            <Icon name="close" :size="16" />
          </button>
        </div>

        <AssistantView
          v-if="page === 'assistant'"
          :profile="ui.profile"
          :audio="ui.audio"
          :requests="ui.requests"
          :proposals="ui.proposals"
          :locked="locked"
          :can-request="canRequest"
          @applications="showApplications"
        />
        <ApplicationsView
          v-else-if="page === 'applications'"
          :profile="ui.profile"
          :application-editor="ui.applicationEditor"
          :locked="locked"
        />
        <div v-show="page === 'settings'">
          <SettingsView
            :profile="ui.profile"
            :locked="locked"
            @desktop="desktop"
            @dirty="aliasDirty = $event"
          />
        </div>
        <footer class="content-footer">
          <Icon name="shield" :size="13" />Traitement local · aucun compte requis<span
            >PAM / PROTOTYPE</span
          >
        </footer>
      </div>
    </main>

    <CorrectionDialog
      :profile="ui.profile"
      :proposals="ui.proposals"
      :locked="locked"
      :dialog-return-focus="dialogReturnFocus"
    />
    <ApplicationPicker
      v-if="pickerOpen"
      :return-focus="dialogReturnFocus"
      :applications="installedApplications"
      :registered="
        replacingTarget
          ? config.applications.filter((app) => app.id !== editingId)
          : config.applications
      "
      :loading="discoveryLoading"
      :error="discoveryError"
      @close="closePicker"
      @refresh="discoverApplications"
      @manual="manualApplication"
      @select="selectInstalled"
    />

    <ApplicationEditorDialog
      :profile="ui.profile"
      :application-editor="ui.applicationEditor"
      :locked="locked"
      :dialog-return-focus="dialogReturnFocus"
    />
    <DiscardDraftDialog :open="guard.pending.value" @keep="guard.keep" @discard="guard.discard" />
  </div>
</template>
<style src="./style.css"></style>
