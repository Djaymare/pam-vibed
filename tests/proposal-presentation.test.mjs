import test from 'node:test';
import assert from 'node:assert/strict';
import { harness, settle, turn, config } from './fixtures/vue-harness.mjs';

const call={name:'deezer_flow',applicationId:'fixture',applicationName:'Deezer',action:'deezer_start',actionLabel:'Démarrer Flow',arguments:{mix:'flow'}};
const proposal=()=>({...turn(),calls:[call]});
function walk(n,fn){if(fn(n))return n;for(const c of n.children??[]){const hit=walk(c,fn);if(hit)return hit;}}
const text=n=>n.text+(n.children??[]).map(text).join('');
function render(t,value) {
  const h=harness(t,{components:true});const card=h.mount((load,vue)=>{const state=vue.reactive({turn:value,config:config(),locked:false,runtimeReady:true});return Object.assign(()=>vue.h(load('components/TurnCard.vue').default,state),{state});});
  return {h,card,s:card.value.state,content:()=>text(card.root),execute:()=>walk(card.root,n=>n.type==='button'&&text(n).trim()==='Exécuter')};
}
test('PAM-22 Flow confirmation explains reason, target, registry parameters and expected effect',async t=>{
  const f=render(t,proposal());await settle();const content=f.content();
  for(const phrase of ['Pourquoi valider','commandes du lecteur','Cible','Deezer','Sélection','Démarrer Flow','protocole ne confirme pas la lecture'])assert.ok(content.includes(phrase),phrase);
  assert.ok(f.execute());assert.deepEqual(f.h.errors,[]);
});
test('PAM-22 every terminal/invalid proposal removes execution, including a stale pending snapshot',async t=>{
  const f=render(t,proposal());await settle();assert.ok(f.execute());
  for(const state of ['expired','invalidated','consumed','unknown']){f.s.turn={...proposal(),proposal:{...proposal().proposal,state}};await settle();assert.equal(f.execute(),undefined,state);}
  f.s.turn={...proposal(),proposal:{...proposal().proposal,expiresAt:Date.now()-1}};await settle();assert.equal(f.execute(),undefined);
  for(const status of ['partial','executed','failed','expired','invalidated','consumed']){f.s.turn={...proposal(),status};await settle();assert.equal(f.execute(),undefined,status);}
});
test('PAM-22 complete, partial and unknown results keep command evidence separate from observation',async t=>{
  const f=render(t,{...proposal(),status:'executed',message:'Cette confirmation a déjà été consommée.',results:[{applicationName:'Deezer',success:true,outcome:'performed',message:'Lien envoyé. Le protocole ne fournit pas de confirmation de lecture.',details:{accepted:true}}]});await settle();
  assert.match(f.content(),/Commande acceptée/);assert.match(f.content(),/Effet non observé/);assert.doesNotMatch(f.content(),/Effectuée|Lecture observée/);
  assert.doesNotMatch(f.content(),/déjà été consommée/);
  f.s.turn={...proposal(),status:'partial',calls:[call,call,call],results:[{index:0,applicationName:'Deezer',success:true,outcome:'performed',message:'Acceptée',details:{accepted:true}},{index:1,applicationName:'Deezer',success:false,outcome:'unknown',message:'Réponse perdue'},{index:2,applicationName:'Deezer',success:false,outcome:'not_started',message:'Non démarrée'}]};await settle();
  for(const phrase of ['Étape 1','Étape 2','Étape 3','issue inconnue','non démarrée','ne peut pas être relancé'])assert.ok(f.content().includes(phrase),phrase);
  assert.equal(f.execute(),undefined);assert.deepEqual(f.h.errors,[]);
});
test('PAM-22 Windows session snapshots are reported as observations, never causal or audible proof',t=>{
  const h=harness(t),p=h.feature('presentation.ts');const result={success:true,details:{accepted:true,sourceAppId:'target',after:{sourceAppId:'TARGET',playbackStatus:'Lecture',title:'Fixture'}}};
  assert.match(p.observedState(result),/État observé.*lecture.*ne prouve pas/);
  assert.equal(p.observedState({...result,details:{...result.details,sourceAppId:'other'}}),'');
  assert.equal(p.observedState({...result,details:{...result.details,after:{error:'closed'}}}),'');
  assert.equal(p.observedState({...result,details:{...result.details,after:{sourceAppId:42,playbackStatus:'Lecture'}}}),'');
  assert.equal(p.resultLabel({success:true,outcome:'performed'}),'Commande envoyée');
});
test('PAM-22 explicit media requests reveal only their returned card, and uncertain confirms cannot replay',async t=>{
  let confirms=0;const h=harness(t,{request:(method)=>{if(method==='prepare_action')return proposal();if(method==='confirm'){confirms++;throw Error('Réponse perdue');}}});
  const f=h.mount(load=>{const profile=load('composables/useProfile.ts').useProfile(h.request,()=>profile?.busy.value??false,()=>{});const proposals=load('composables/useProposals.ts').useProposals(profile,()=>profile.busy.value,()=>{});const requests=load('composables/useRequests.ts').useRequests(profile,proposals,()=>profile.runtimeReady.value&&!profile.busy.value,()=>profile.busy.value);return {profile,proposals,requests};}).value;await settle();
  f.proposals.add({...proposal(),id:'text'});assert.equal(f.proposals.revealedId.value,'');
  await f.requests.prepareMediaAction('fixture','deezer_start',{mix:'flow'},'Flow');await settle();assert.equal(f.proposals.revealedId.value,'turn');
  await f.proposals.resolveTurn(f.proposals.turns.value[0],true);await settle();assert.equal(f.proposals.turns.value[0].status,'invalidated');
  await f.proposals.resolveTurn(f.proposals.turns.value[0],true);assert.equal(confirms,1);assert.match(f.proposals.turns.value[0].message,/ne sera pas relancée/);
});
