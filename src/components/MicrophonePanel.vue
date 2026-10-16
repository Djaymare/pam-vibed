<script setup lang="ts">
import type { UnwrapNestedRefs } from 'vue';
import type { Audio } from '../composables/useAudio';
defineProps<{ audio: UnwrapNestedRefs<Audio>; disabled: boolean }>();
</script>
<template>
  <section class="microphone-panel" aria-labelledby="microphone-title">
    <h2 id="microphone-title">Votre microphone</h2>
    <p id="microphone-help">
      Test local de 5 secondes, sans transcription ni action. Autorisez le microphone si Windows le
      demande. Aucun test ne démarre automatiquement.
    </p>
    <label
      v-if="
        audio.devices.filter((device) => device.deviceId !== 'default').length > 1 ||
        audio.selectedDeviceId
      "
      for="microphone-input"
      >Entrée audio
      <select
        id="microphone-input"
        :value="audio.selectedDeviceId"
        @change="audio.selectDevice(($event.target as HTMLSelectElement).value)"
        :disabled="disabled || audio.state !== 'idle'"
        aria-describedby="microphone-help microphone-message"
      >
        <option value="">Microphone par défaut de Windows</option>
        <option
          v-if="
            audio.selectedDeviceId &&
            !audio.devices.some((device) => device.deviceId === audio.selectedDeviceId)
          "
          :value="audio.selectedDeviceId"
          disabled
        >
          Microphone sélectionné indisponible
        </option>
        <option
          v-for="device in audio.devices.filter(
            (device) => device.deviceId && device.deviceId !== 'default',
          )"
          :key="device.deviceId"
          :value="device.deviceId"
        >
          {{ device.label }}
        </option>
      </select>
    </label>
    <button
      class="secondary small"
      :disabled="disabled || audio.state !== 'idle'"
      aria-describedby="microphone-help microphone-message"
      @click="audio.testMicrophone"
    >
      Tester le microphone
    </button>
    <button
      class="text-button"
      :disabled="audio.refreshingDevices || audio.state !== 'idle'"
      :aria-busy="audio.refreshingDevices"
      @click="audio.refreshDevices"
    >
      Actualiser les entrées
    </button>
    <button v-if="audio.testing" class="text-button" @click="audio.cancelRecording">
      Arrêter le test
    </button>
    <div v-if="audio.testing" role="status">
      {{
        audio.requestingMic
          ? 'Autorisez le microphone dans la fenêtre de permission.'
          : 'Parlez : le niveau doit bouger. Arrêt automatique après 5 secondes.'
      }}
    </div>
    <meter
      v-if="audio.testing"
      min="0"
      max="1"
      :value="audio.level"
      aria-label="Niveau du microphone"
    />
    <p
      id="microphone-message"
      :role="audio.microphoneError || audio.deviceError ? 'alert' : 'status'"
    >
      {{ audio.microphoneError || audio.deviceError || audio.testResult }}
    </p>
  </section>
</template>
