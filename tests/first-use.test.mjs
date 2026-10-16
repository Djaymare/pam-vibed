import test from 'node:test';
import assert from 'node:assert/strict';
import { applicationGuidance } from '../src/firstUse.ts';
import { harness, settle, config } from './fixtures/vue-harness.mjs';
const nodes=n=>[n,...n.children.flatMap(nodes)];
const text=n=>n.text+n.children.map(text).join('');
test('PAM-26 descriptions never promise internal actions for a simple launcher or an absent player',()=>{
 const app={name:'Éditeur',arguments:[]};
 assert.deepEqual(applicationGuidance(app).examples,['Ouvre Éditeur']);
 assert.match(applicationGuidance(app).limit,/ne pilote pas ses boutons/);
 const media={...app,media:{sourceAppId:'player'}};
 assert.equal(applicationGuidance(media).examples.length,1);
 assert.equal(applicationGuidance(media,[{sourceAppId:'PLAYER',capabilities:{pause:true}}]).examples.length,2);
 assert.equal(applicationGuidance(media,[{sourceAppId:'player',capabilities:{pause:false}}]).examples.length,1);
 assert.match(applicationGuidance({...media,media:{sourceAppId:'player',deezer:true}}).limit,/ne peut pas garantir/);
});
test('PAM-26 first action requires a real test result; unavailable recovery and draft preparation stay local',async t=>{
 let fail=false,profile,requests,props,tests=0;const h=harness(t,{components:true});
 const mounted=h.mount((load,v)=>{
  const scope=load('composables/useAsyncScope.ts').useAsyncScope(),mutation=scope.operation();
  profile=v.reactive({config:config(),unavailable:()=>fail,beginMutation:k=>mutation.begin(k),request:async(method,payload)=>{tests++;assert.equal(method,'test_application');assert.equal(payload.name,'Initial');return {success:!fail,message:fail?'Absent':'Ouverture demandée'};},updateHealth:async()=>{},toggleApplication:app=>app.enabled=!app.enabled});
  requests=v.reactive({text:''});props=v.reactive({profile,requests,locked:false});
  return ()=>v.h(load('components/FirstUseGuide.vue').default,props);
 });await settle();
 const all=()=>nodes(mounted.root),button=label=>all().find(n=>n.type==='button'&&text(n).trim()===label);
 assert.equal(button('Préparer ma phrase écrite').props.disabled,true);
 await button('Tester l’ouverture').props.onClick();await settle();
 assert.equal(button('Préparer ma phrase écrite').props.disabled,false);assert.equal(tests,1);
 h.document.querySelector=()=>({focus(){}});
 await button('Préparer ma phrase écrite').props.onClick();assert.equal(requests.text,'Ouvre Initial');assert.equal(tests,1);
 requests.text='Ma longue demande conservée';await settle();await button('Reprendre ma phrase écrite').props.onClick();assert.equal(requests.text,'Ma longue demande conservée');requests.text='';await settle();
 profile.config.applications[0].executable='changed.exe';await settle();assert.equal(button('Préparer ma phrase écrite').props.disabled,true);
 fail=true;profile.config={...profile.config};await settle();assert.match(text(mounted.root),/indisponible/);assert.ok(button('Désactiver Initial'));assert.equal(button('Tester l’ouverture').props.disabled,true);
 assert.deepEqual(h.errors,[]);
});
test('PAM-26 empty profile offers selection and a failed opening keeps the example locked',async t=>{
 const h=harness(t,{components:true});let profile,added=0;
 const mounted=h.mount((load,v)=>{const operation=load('composables/useAsyncScope.ts').useAsyncScope().operation();profile=v.reactive({config:{...config(),applications:[]},unavailable:()=>false,beginMutation:k=>operation.begin(k),request:async()=>{throw Error('Absent');},updateHealth:async()=>{}});return ()=>v.h(load('components/FirstUseGuide.vue').default,{profile,requests:{text:''},locked:false,onAdd:()=>added++});});await settle();
 let all=()=>nodes(mounted.root),button=label=>all().find(n=>n.type==='button'&&text(n).trim()===label);
 button('Choisir ma première application').props.onClick();assert.equal(added,1);
 profile.config.applications=config().applications;await settle();await button('Tester l’ouverture').props.onClick();await settle();
 assert.equal(button('Préparer ma phrase écrite').props.disabled,true);assert.match(text(mounted.root),/Réparez/);assert.deepEqual(h.errors,[]);
});
test('PAM-26 shortcut conflict replacement preserves selected draft on failure and ignores late unmount',async t=>{
 const h=harness(t);let preference,mode='conflict';let resolveSave;
 const request=async(method,payload)=>{assert.equal(method,'voice_shortcut');if(!payload?.shortcut)return {id:'ctrl_shift_space',label:'Ctrl + Maj + Espace',available:false,error:'Occupé'};if(mode==='hold')return new Promise(resolve=>resolveSave=resolve);return {id:payload.shortcut,label:'Ctrl + Alt + Espace',available:true,error:mode==='conflict'?'Autre combinaison occupée':''};};
 h.mount(load=>preference=load('composables/useShortcutPreference.ts').useShortcutPreference(request));await settle();assert.equal(preference.status.value.available,false);
 preference.selected.value='ctrl_alt_space';await preference.save();assert.equal(preference.selected.value,'ctrl_alt_space');assert.match(preference.status.value.error,/occupée/);
 mode='ok';await preference.save();assert.equal(preference.status.value.available,true);assert.equal(preference.status.value.error,'');
 mode='hold';const pending=preference.save();h.unmount();resolveSave({id:'ctrl_shift_f9',label:'F9',available:true,error:''});await pending;assert.equal(preference.status.value.id,'ctrl_alt_space');
});
test('PAM-26 suggested descriptions follow configured capabilities without overwriting custom prose',async t=>{
 const h=harness(t);let editor;
 h.mount((load,v)=>{const scope=load('composables/useAsyncScope.ts').useAsyncScope(),mutation=scope.operation();const profile={request:h.request,busy:mutation.pending,config:v.ref(config()),status:v.ref(),scope,mutation,isLocked:()=>false,beginMutation:k=>mutation.begin(k),updateHealth:async()=>{}};editor=load('composables/useApplicationEditor.ts').useApplicationEditor(profile,()=>{});});
 editor.selectInstalled({name:'Deezer',appId:'Deezer.62021768415AF_q7m17pa7q8kj0!Deezer.Music',kind:'store',icon:null});await settle();assert.match(editor.form.description,/Flow/);
 editor.deezerPlugin.value=false;await settle();assert.doesNotMatch(editor.form.description,/Flow/);assert.match(editor.form.description,/lecture/);
 editor.form.description='Ma description conservée';editor.mediaSource.value='';await settle();assert.equal(editor.form.description,'Ma description conservée');assert.match(editor.guidance.value.limit,/ne pilote pas/);
});
