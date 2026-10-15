import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {harness,settle} from './fixtures/vue-harness.mjs';
import {checkNativeConcordance,nativeMediaSource} from '../scripts/check-action-registry.mjs';
const require=createRequire(import.meta.url);
const {registry,ACTIONS,parameterSchema,validateArguments}=require('../sidecar/action-registry.cjs');
const {toolsFor}=require('../sidecar/assistant/intent.cjs');
const {deezerUri,validateDeezerArgs}=require('../sidecar/deezer.cjs');
const {recognizeDeezerCommand}=require('../sidecar/deezer-commands.cjs');
const {canonicalPrompt,needleTools}=require('../sidecar/needle-tools.cjs');
const contract=require('../sidecar/contracts.json');
const routes=JSON.parse(readFileSync('tests/fixtures/action-routes.json'));
const app={id:'11111111-1111-4111-8111-111111111111',name:'Deezer Music',description:'Fixture',aliases:['Deezer'],enabled:true,arguments:[],media:{sourceAppId:'Fixture',deezer:true},windowsApp:{appId:registry.deezer.appId}};
const config={applications:[app]};
const elements=root=>[root,...root.children.flatMap(elements)];
const text=node=>node.text+node.children.map(text).join('');

test('PAM-18 catalogue, Vue choices, IPC and Node schemas cover the same actions',t=>{
  const h=harness(t),front=h.feature('actions.ts');
  assert.deepEqual(front.actionRegistry,registry);
  const ids=registry.actions.map(a=>a.id);
  assert.equal(new Set(ids).size,ids.length);
  assert.deepEqual(contract.definitions.CommandAction.enum,ids);
  assert.deepEqual(Object.keys(front.commandActionLabels),ids);
  const choices=front.commandActions(app),tools=toolsFor(config);
  assert.deepEqual([...new Set(choices.map(c=>c.action))].sort(),[...ids].sort());
  assert.deepEqual(tools.map(t=>t.action).sort(),[...ids].sort());
  for(const definition of registry.actions) {
    assert.ok(definition.label && definition.expectedEffect && definition.prerequisites.length);
    assert.deepEqual(definition.corrections,['applicationId',...Object.keys(definition.parameters.properties)]);
    const tool=tools.find(t=>t.action===definition.id);
    if(definition.family!=='application')assert.deepEqual(tool.parameters,parameterSchema(definition.id));
    if(definition.family!=='deezer')assert.ok(canonicalPrompt(tool,app));
  }
  assert.deepEqual(Object.keys(contract.definitions.MediaSession.properties['capabilities?'].properties).sort(),front.mediaActions.map(a=>a.capability).sort());
  for(const choice of choices)if(choice.arguments) {
    assert.equal(front.commandChoiceKey(choice),choice.key);
    assert.deepEqual(front.choiceArguments(choice,{}),choice.arguments);
    validateArguments(choice.action,choice.arguments);
  }
  assert.deepEqual(needleTools(tools,config).map(t=>t.parameters),tools.map(t=>t.parameters));
  assert.deepEqual(h.errors,[]);
});

test('PAM-18 generated route corpus uses production router and every declared option',t=>{
  const front=harness(t).feature('actions.ts');
  for(const row of routes) {
    assert.equal(deezerUri(row.action,row.args),row.uri);
    const choice=front.commandActions(app).find(c=>c.action===row.action && (!c.arguments || Object.entries(c.arguments).every(([k,v])=>row.args[k]===v)));
    assert.ok(choice,row.action);
    assert.deepEqual(front.choiceArguments(choice,row.args),validateDeezerArgs(row.action,row.args));
  }
  for(const [page,option] of Object.entries(registry.options.pages))for(const alias of option.aliases)
    assert.equal(recognizeDeezerCommand(`Deezer affiche ${alias}`,config)?.arguments.page,page,alias);
  for(const [kind,option] of Object.entries(registry.options.contents))for(const alias of option.aliases)
    assert.equal(recognizeDeezerCommand(`Deezer affiche ${alias} 123`,config)?.arguments.kind,kind,alias);
});

test('PAM-18 independent Windows allowlists agree; page, action, protocol and native drift fail',()=>{
  const source=nativeMediaSource();checkNativeConcordance(registry,source);
  for(const mutate of [r=>r.options.pages.new_page={path:'new'},r=>r.options.contents.unsafe={label:'Unsafe'},
    r=>r.actions.push({id:'media_unsafe',family:'media',nativeAction:'unsafe'}),r=>r.deezer.protocols.push('file')]) {
    const copy=structuredClone(registry);mutate(copy);
    assert.throws(()=>checkNativeConcordance(copy,source),/drift/);
  }
  assert.throws(()=>checkNativeConcordance(registry,source.replace('"channels/charts"','"unsafe"')),/drift/);
});

test('PAM-18 Tauri and bundle verification include the shared catalogue',()=>{
  const resources=JSON.parse(readFileSync('src-tauri/tauri.conf.json')).bundle.resources;
  const verifier=readFileSync('scripts/verify-bundle.mjs','utf8');
  for(const file of ['action-registry.cjs','action-registry.json']) {
    assert.equal(resources[`../sidecar/${file}`],`sidecar/${file}`);
    assert.ok(verifier.includes(`'sidecar/${file}'`));
  }
});

test('PAM-18 correction fields use shared defaults, enums and bounds',async t=>{
  for(const action of ['deezer_search','deezer_content','deezer_smarttracklist']) {
    const h=harness(t,{components:true}),front=h.feature('actions.ts');let changed;
    const mounted=h.mount((load,vue)=>()=>vue.h(load('components/CommandArguments.vue').default,{action,modelValue:{},disabled:false,'onUpdate:modelValue':v=>changed=v}));
    const fields=front.correctionFields(action),nodes=elements(mounted.root);
    assert.equal(nodes.filter(n=>n.type==='label').length,fields.length);
    for(const field of fields) {
      const element=nodes.find(n=>n.props.onInput && n.props.pattern===field.pattern && n.props.maxlength===field.maxLength);
      if(field.values)assert.ok(nodes.some(n=>n.type==='select' && n.children.filter(c=>c.type==='option').length===Object.keys(field.values).length));
      else {assert.ok(element,field.key);element.props.onInput({target:{value:'chosen'}});assert.equal(changed[field.key],'chosen');}
    }
    assert.deepEqual(h.errors,[]);h.unmount();await settle();
  }
});

test('PAM-18 theoretical catalogue never grants a missing or ambiguous live capability',async t=>{
  const capabilities={play:false,pause:true,next:false,previous:false,stop:false,toggle:false};
  const session={sourceAppId:'Fixture',capabilities};
  assert.equal(toolsFor(config).filter(t=>t.action.startsWith('media_')).length,6);
  assert.deepEqual(toolsFor(config,[session]).filter(t=>t.action.startsWith('media_')).map(t=>t.action),['media_pause']);
  for(const sessions of [[],[session,session],[{...session,error:'closed'}]])assert.equal(toolsFor(config,sessions).filter(t=>t.action.startsWith('media_')).length,0);
  const h=harness(t,{components:true,request:method=>method==='media_sessions'?[session]:undefined});
  const m=h.mount((load,vue)=>()=>vue.h(load('components/MediaControls.vue').default,{applications:[app],locked:false}));await settle();
  const buttons=elements(m.root).filter(n=>n.type==='button' && n.props.class==='secondary small' && ['Lecture','Pause','Piste suivante','Piste précédente','Arrêter','Lecture / pause'].includes(text(n).trim()));
  assert.equal(buttons.length,6);assert.deepEqual(buttons.filter(n=>!n.props.disabled).map(n=>text(n).trim()),['Pause']);assert.deepEqual(h.errors,[]);
});

test('PAM-18 unknown and hostile action parameters never reach the native adapter',async()=>{
  const {createMedia}=require('../sidecar/media.cjs');let effects=0;const media=createMedia(async()=>{effects++;return {accepted:true};});
  for(const [action,args] of [['media_toString',{}],['media_unknown',{}],['deezer_unknown',{}],['deezer_page',{page:'constructor'}],['deezer_content',{kind:'track',id:'1?autoplay=true'}],['deezer_search',{query:'x',uri:'file:///x'}],['deezer_smarttracklist',{id:'x/../bad',mode:'play'}]])
    await assert.rejects(media.execute(app,action,args));
  assert.equal(effects,0);
  assert.throws(()=>validateArguments('constructor',{}));
});
