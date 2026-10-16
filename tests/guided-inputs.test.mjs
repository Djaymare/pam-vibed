import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { harness, settle, config } from './fixtures/vue-harness.mjs';
import { parseLaunchArguments, previewArguments } from '../src/launchArguments.ts';
const require = createRequire(import.meta.url);
const { hostLauncher } = require('../sidecar/host.cjs');
const { validateDeezerArgs, deezerUri } = require('../sidecar/deezer.cjs');
const nodes = n => [n, ...n.children.flatMap(nodes)];
const text = n => n.text + n.children.map(text).join('');
const args = ['--file', 'C:\\Mes fichiers\\un "titre".txt', '', '  espaces  ', '{input}', '--name={input}', 'ligne\nsuivante', '\\fin\\'];

test('PAM-27 JSON, previews and the production host preserve argv boundaries and literal quotes', async () => {
  const input = 'C:\\Autre fichier\\"test" & $(echo non).txt';
  assert.deepEqual(parseLaunchArguments(JSON.stringify(args)), args);
  const expected = previewArguments(args, input);
  let emitted;
  await hostLauncher(async (method, payload) => { assert.equal(method, 'launch_application'); emitted = payload; return { accepted: true }; })({ executable: 'C:\\Test avec espaces\\fixture.exe', arguments: args }, { input });
  assert.deepEqual(emitted.arguments, expected);
  assert.equal(emitted.arguments[4], input);
  assert.equal(emitted.arguments[5], '--name=' + input);
  assert.deepEqual(previewArguments(['{input}{input}', '"literal"'], '{input}'), ['{input}{input}', '"literal"']);
  for (const invalid of ['{', '{}', 'null', '[1]', '["ok", false]']) assert.throws(() => parseLaunchArguments(invalid), /tableau JSON/);
});

test('PAM-27 simple fields and JSON round trip without rewriting; invalid JSON stays editable', async t => {
  const h = harness(t, { components: true }); let model;
  const m = h.mount((load, v) => { model = v.ref(JSON.stringify(args, null, 3)); return () => v.h(load('components/LaunchArguments.vue').default, { modelValue: model.value, executable: 'C:\\fixture.exe', input: 'un fichier', disabled: false, 'onUpdate:modelValue': value => model.value = value }); });
  const all = () => nodes(m.root), button = label => all().find(n => n.type === 'button' && text(n).trim() === label);
  await settle();
  assert.deepEqual(all().filter(n => n.type === 'textarea').map(n => n.props.value), args);
  const original = model.value;
  button('Utiliser le JSON expert').props.onClick(); await settle();
  assert.equal(all().find(n => n.type === 'textarea').props.value, original);
  button('Utiliser les champs simples').props.onClick(); await settle(); assert.equal(model.value, original);
  button('Ajouter un argument').props.onClick(); await settle(); assert.deepEqual(JSON.parse(model.value), [...args, '']);
  all().find(n => n.props['aria-label'] === 'Supprimer l’argument 3').props.onClick(); await settle();
  assert.deepEqual(JSON.parse(model.value), [...args.slice(0,2),...args.slice(3),'']);
  all().find(n => n.type === 'textarea').props.onInput({ target: { value: '  nouveau "texte"  ' } }); await settle();
  assert.equal(JSON.parse(model.value)[0], '  nouveau "texte"  ');
  button('Utiliser le JSON expert').props.onClick(); await settle();
  all().find(n => n.type === 'textarea').props.onInput({ target: { value: '["inachevé"' } }); await settle();
  button('Utiliser les champs simples').props.onClick(); await settle();
  assert.equal(model.value, '["inachevé"'); assert.match(text(m.root), /Votre texte est conservé/);
  all().find(n => n.type === 'textarea').props.onInput({ target: { value: '[]' } }); await settle();
  button('Utiliser les champs simples').props.onClick(); await settle(); assert.match(text(m.root), /Aucun argument/);
  assert.deepEqual(h.errors, []);
});

test('PAM-27 application save/test failures retain the exact simple/expert draft', async t => {
  const h = harness(t, { request: method => ['save_application','test_application'].includes(method) ? Promise.reject(Error('Erreur fixture')) : undefined });
  let editor;
  h.mount((load,v) => { const mutation = load('composables/useAsyncScope.ts').useAsyncScope().operation(); const profile = { request:h.request, busy:mutation.pending, config:v.ref(config()), status:v.ref(), updateHealth:async()=>{}, beginMutation:()=>mutation.begin(), isLocked:()=>mutation.pending.value, mutation:{kind:v.ref('')}, scope:load('composables/useAsyncScope.ts').useAsyncScope() }; editor = load('composables/useApplicationEditor.ts').useApplicationEditor(profile,()=>{}); });
  editor.editApplication(); editor.form.arguments = JSON.stringify(args); editor.testInput.value = 'C:\\Mon fichier.txt'; await settle();
  for (const method of ['testLaunch','saveApplication']) { await editor[method](); assert.equal(editor.form.arguments, JSON.stringify(args)); assert.equal(editor.editorOpen.value, true); assert.equal(editor.dirty.value, true); assert.match(editor.formError.value,/Erreur fixture/); }
  for (const call of h.calls.filter(c => ['save_application','test_application'].includes(c.method))) assert.deepEqual(call.payload.arguments, args);
  editor.form.arguments = '[1]'; const before = h.calls.length; await editor.saveApplication(); assert.equal(h.calls.length, before); assert.match(editor.formError.value,/tableau JSON/);
  assert.deepEqual(h.errors, []);
});

test('PAM-27 Deezer URLs use registry types, strict hosts, HTTPS, positive string IDs and only share parameters', t => {
  const parse = harness(t).feature('deezerLink.ts').parseDeezerLink;
  for (const kind of ['track','album','artist','playlist','show','episode','profile']) {
    for (const prefix of ['https://deezer.com/','https://www.deezer.com/fr/','https://www.deezer.com/en-us/']) {
      const result = parse(prefix + kind + '/1234567890123456789?utm_source=share&deferredFl=1');
      assert.deepEqual(result, {kind,id:'1234567890123456789'});
      assert.deepEqual(validateDeezerArgs('deezer_content',result),result);
      assert.equal(deezerUri('deezer_content',result),'deezer://www.deezer.com/'+kind+'/1234567890123456789');
    }
  }
  for (const url of ['http://www.deezer.com/track/1','file:///track/1','javascript:alert(1)','deezer://www.deezer.com/track/1','https://www.deezer.com.evil/track/1','https://evil@www.deezer.com/track/1','https://www.deezer.com:443/track/1','https://www.deezer.com./track/1','https://WWW.DEEZER.COM/track/1','https://www.deezer.com/track/0','https://www.deezer.com/track/01','https://www.deezer.com/track/12345678901234567890','https://www.deezer.com/track/1/../../album/2','https://www.deezer.com/track/%31','https://www.deezer.com/unknown/1','https://www.deezer.com/track/1?redirect=evil','https://www.deezer.com/track/1?autoplay=true','https://www.deezer.com/track/1#play','https://link.deezer.com/s/fixture','https://www.deezer.com/track/1?utm_source=%00']) {
    assert.throws(() => parse(url), Error, url);
    // Backend rejects raw URLs even when a caller bypasses the guided form.
    assert.throws(() => validateDeezerArgs('deezer_content',{kind:'track',id:url}), Error, url);
  }
});

test('PAM-27 link form emits only canonical arguments, rejects bypassed invalid input and retains draft on remount', async t => {
  const h = harness(t,{components:true}), events=[]; let draft, show;
  const app={...config().applications[0],media:{sourceAppId:'Fixture',deezer:true}};
  const m=h.mount((load,v)=>{draft=v.reactive({contentLink:''});show=v.ref(true);return()=>show.value?v.h(load('components/MediaControls.vue').default,{applications:[app],locked:false,draft:draft.contentLink,'onUpdate:draft':value=>draft.contentLink=value,onAction:(...a)=>events.push(a)}):null;});await settle();
  const form=()=>nodes(m.root).find(n=>n.type==='form'&&nodes(n).some(c=>c.props.placeholder==='https://www.deezer.com/fr/track/3135556'));
  draft.contentLink='https://www.deezer.com/fr/album/123';await settle();form().props.onSubmit({preventDefault(){}});
  assert.deepEqual(events[0].slice(0,3),['fixture','deezer_content',{kind:'album',id:'123'}]);
  draft.contentLink='https://deezer.com.evil/track/1';await settle();form().props.onSubmit({preventDefault(){}});assert.equal(events.length,1);
  show.value=false;await settle();show.value=true;await settle();assert.equal(draft.contentLink,'https://deezer.com.evil/track/1');assert.ok(form());
  assert.deepEqual(h.errors,[]);
});

test('PAM-27 production backend rejects raw links before the adapter and accepts only canonical registry routes', async t => {
  const parse=harness(t).feature('deezerLink.ts').parseDeezerLink;
  const {createMedia}=require('../sidecar/media.cjs');
  const {DEEZER_APP_ID}=require('../sidecar/deezer.cjs');
  const emitted=[],media=createMedia(async request=>{emitted.push(request);return{accepted:true};});
  const app={name:'Fixture',media:{sourceAppId:'Deezer.exe',deezer:true},windowsApp:{appId:DEEZER_APP_ID}};
  for(const id of ['https://www.deezer.com/track/1','https://deezer.com.evil/track/1','file:///track/1','1?autoplay=true','1/../../flushCache']) await assert.rejects(media.execute(app,'deezer_content',{kind:'track',id}));
  assert.equal(emitted.length,0);
  await media.execute(app,'deezer_content',parse('https://www.deezer.com/fr/album/3135556'));
  assert.equal(emitted.length,1);assert.equal(emitted[0].uri,'deezer://www.deezer.com/album/3135556');
});
