// Real recorder, composable, native events and desktop action; no assistant,
// personal profile, audio export, model request or external application.
import { createApp, h, ref, reactive } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useAsyncScope } from '../../src/composables/useAsyncScope';
import { useAudio } from '../../src/composables/useAudio';
import { useVoiceShortcuts } from '../../src/composables/useVoiceShortcuts';
import { desktopAction } from '../../src/ipc';
import MicrophonePanel from '../../src/components/MicrophonePanel.vue';
import '../../src/style.css';
const streams = [], events = [], contexts = [], results = [];
const bootId = crypto.randomUUID(), loadedAt = Date.now();
const NativeContext = window.AudioContext;
window.AudioContext = new Proxy(NativeContext, { construct(target, args) { const context = Reflect.construct(target, args); contexts.push(context); return context; } });
const media = navigator.mediaDevices;
if (media?.getUserMedia) {
  const real = media.getUserMedia.bind(media);
  media.getUserMedia = async constraints => {
    const stream = await real(constraints);
    streams.push(stream);
    events.push({ type: 'acquired', at: Date.now() });
    return stream;
  };
  media.addEventListener('devicechange', () => events.push({ type: 'devicechange', at: Date.now() }));
}
createApp({ setup() {
  const scope = useAsyncScope(), mutation = scope.operation(), error = ref('');
  const profile = { scope, mutation, error, request: async (_method, payload) => ({ code: payload.code, stage: 'microphone', requestId: 'pam-microphone-fixture' }), beginMutation: label => mutation.begin(label) };
  const requests = { sent: ref(false), process: async (_method, payload) => {
    const bytes = new Uint8Array(payload.audio), view = new DataView(bytes.buffer);
    results.push({ bytes: bytes.length, riff: String.fromCharCode(...bytes.slice(0,4)), channels: view.getUint16(22,true), sampleRate: view.getUint32(24,true), bits: view.getUint16(34,true) });
  } };
  const audio = useAudio(profile, requests, () => true);
  const shortcuts = useVoiceShortcuts(() => {}, () => {
    events.push({ type: 'native-cancel', at: Date.now() });
    void audio.cancelRecording();
  });
  const ui = reactive(audio);
  const state = () => ({ bootId, loadedAt, state: ui.state, error: error.value, level: ui.level, seconds: ui.seconds,
    tracks: streams.flatMap(s => s.getTracks().map(t => ({ state: t.readyState, muted: t.muted, enabled: t.enabled }))),
    events: [...events], results, contexts: contexts.map(context => context.state),
    testResult: ui.testResult, microphoneError: ui.microphoneError, deviceError: ui.deviceError,
    devices: ui.devices.length, listenerError: shortcuts.error.value, visible: document.visibilityState });
  window.pamMicrophone = { audio, state, streams, events,
    hide: () => desktopAction('hide'), close: () => getCurrentWindow().close(),
    suspend: () => contexts.at(-1)?.suspend(), nativeVisible: () => getCurrentWindow().isVisible() };
  return () => h('main', { style: 'font:20px system-ui;max-width:850px;margin:40px auto' }, [
    h('h1', 'PAM — essai microphone jetable'),
    h('p', 'Capture locale limitée à 30 secondes. Aucun audio enregistré sur disque ni transmis au moteur.'),
    h('button', { id: 'start', onClick: () => audio.startRecording(), disabled: ui.state !== 'idle' }, 'Démarrer la capture'),
    h('button', { id: 'cancel', onClick: () => audio.cancelRecording() }, 'Annuler'),
    h('button', { id: 'finish', onClick: () => audio.finishRecording() }, 'Arrêter et vérifier le WAV local'),
    h('button', { id: 'hide', onClick: () => desktopAction('hide') }, 'Masquer par le code natif'),
    h('button', { id: 'close', onClick: () => getCurrentWindow().close() }, 'Fermer par le code natif'),
    h('p', { role: 'status' }, `État : ${ui.state} · niveau ${Math.round(ui.level * 100)} % · ${ui.seconds} s`),
    h('p', { role: 'alert' }, error.value || shortcuts.error.value),
    h(MicrophonePanel, { audio: ui, disabled: false }),
    h('p', 'Les permissions système doivent être traitées manuellement. Utilisez les boutons uniquement quand l’essai est annoncé.'),
  ]);
} }).mount('#app');
