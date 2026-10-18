import { createApp, defineComponent, h, ref } from 'vue';
import App from '../../src/App.vue';
import ModalDialog from '../../src/components/ModalDialog.vue';
import '../../src/style.css';
// Track only resources acquired by this disposable page. This hook is before
// mount and each navigation gets a fresh registry. Never persist audio samples.
window.pamTestResources={tracks:[],contexts:[],async dispose(){
  for(const track of this.tracks)track.stop();
  await Promise.all(this.contexts.map(c=>c.state==='closed'?undefined:c.close()));
  return {liveTracks:this.tracks.filter(t=>t.readyState==='live').length,openContexts:this.contexts.filter(c=>c.state!=='closed').length};
}};
if(navigator.mediaDevices){const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async options=>{const stream=await original(options);window.pamTestResources.tracks.push(...stream.getTracks());return stream;};}
if(window.AudioContext){const Original=window.AudioContext;window.AudioContext=new Proxy(Original,{construct(target,args){const context=new target(...args);window.pamTestResources.contexts.push(context);return context;}});}
addEventListener('pagehide',()=>{void window.pamTestResources.dispose();},{once:true});
const Fixture = defineComponent({
  setup() {
    const shown = ref(false), busy = ref(false), veto = ref(false), trigger = ref(true);
    return () => h('div', [
      trigger.value && h('button', { id: 'trigger', onClick: () => { shown.value = true; } }, 'Ouvrir'),
      h('button', { id: 'fallback' }, 'Repli'),
      shown.value && h(ModalDialog, { labelledby: 'fixture-title', fallbackFocus: '#fallback', closeDisabled: busy.value, onClose: () => { if (!veto.value) shown.value = false; } }, {
        default: ({ requestClose }) => busy.value ? [h('h2', { id: 'fixture-title' }, 'Dialogue de composant')] : [
          h('h2', { id: 'fixture-title' }, 'Dialogue de composant'),
          h('input', { id: 'initial', 'data-dialog-initial-focus': '', disabled: busy.value }),
          h('button', { id: 'skip-disabled', disabled: true }, 'Ignorer'),
          h('button', { id: 'skip-hidden', style: 'display:none' }, 'Invisible'),
          h('details', [h('summary', { id: 'summary' }, 'Détails'), h('input', { id: 'closed-detail' })]),
          h('button', { id: 'veto', onClick: () => { veto.value = !veto.value; } }, 'Intercepter'),
          h('button', { id: 'remove', onClick: () => { trigger.value = false; } }, 'Retirer le déclencheur'),
          h('button', { id: 'busy', onClick: () => { busy.value = true; setTimeout(() => { busy.value = false; }, 500); } }, 'Occupé'),
          h('button', { id: 'last', onClick: () => requestClose('explicit'), disabled: busy.value }, 'Fermer'),
        ],
      }),
    ]);
  },
});
createApp(new URLSearchParams(location.search).has('component') ? Fixture : App).mount('#app');
