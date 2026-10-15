import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parse, compileScript } from '@vue/compiler-sfc';
import ts from 'typescript';
import * as vue from 'vue';

// Compile and mount the real App SFC with Vue's renderer. Only native services,
// timers and unrelated child components are substituted; no WebView2 claim.
async function mountApp(t, { recoveryFailure = false, healthy = false, proposalScenario = false, correctionSuccess = false, transferScenario = false, transferFailure = false, backupScenario = false, diagnosticScenario = false, microphoneFailure = false } = {}) {
  const previousDocument = globalThis.document;
  globalThis.document = { activeElement: null };
  for (const name of ['Document', 'ShadowRoot']) {
    const previous = globalThis[name]; globalThis[name] = class {};
    t.after(() => { if (previous === undefined) delete globalThis[name]; else globalThis[name] = previous; });
  }
  t.after(() => { if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument; });
  const calls = [];
  let time = Date.now(), sequence = 0;
  const TestDate = class extends Date { static now() { return time; } };
  const proposals = [], timerCallbacks = new Map();
  const empty = { version: 2, applications: [], commandAliases: [], language: 'fr', autoExecute: true, confidenceThreshold: 0.7 };
  const profileBackup = backupScenario ? { fingerprint: 'previewed-current', backupFingerprint: 'previewed-backup', backupSummary: { applications: ['Éditeur sauvegardé'], formulations: 3, language: 'en', autoExecute: false, confidenceThreshold: 0.9 } } : undefined;
  let profileError = { message: 'Profil invalide : applications[0] : Nom invalide.', fingerprint: 'original', recoverable: true };
  if (healthy) {
    profileError = undefined;
    empty.applications = [{ id: '11111111-1111-4111-8111-111111111111', name: 'Éditeur valide', description: 'Test', executable: 'C:\\fixture.exe', arguments: [], aliases: [], enabled: true }];
  }
  const invoke = async (command, input) => {
    if (command !== 'assistant_request') return;
    calls.push(input);
    if (diagnosticScenario && input.method === 'export_diagnostics') return {format:1,events:[{error:{code:'model_failure',stage:'transcription',requestId:'pam-1-2-3'}}]};
    if (diagnosticScenario && input.method === 'process_text') throw {code:'model_failure',stage:'transcription',requestId:'pam-1-2-3',message:'C:\\Users\\Private\\SENTINEL',technical:{raw:'SENTINEL'}};
    if (microphoneFailure && input.method === 'diagnostic_event') return {code:input.payload.code,stage:'microphone',requestId:'pam-1-2-4'};
    if (input.method === 'status') return { ready: !profileError, config: structuredClone(empty), proposals: proposalScenario ? structuredClone(proposals) : [], configError: profileError, profileBackup, checks: [], engine: null };
    if (transferScenario && input.method === 'export_config') return JSON.stringify(empty, null, 2);
    if (transferScenario && input.method === 'preview_import') return { fingerprint: 'before', importFingerprint: 'import-digest', summary: { applications: ['Application importée'], formulations: 2, language: 'en', autoExecute: false, confidenceThreshold: 0.8 } };
    if (transferScenario && input.method === 'import_config') {
      if (transferFailure) throw Error('Le profil a changé. Recommencez l’aperçu.');
      empty.applications[0].name = 'Application importée';
      return { config: empty, backupPath: 'C:\\fixture\\previous.json' };
    }
    if (proposalScenario && input.method === 'process_text') {
      const id = `proposal-${++sequence}`;
      const proposal = { state: 'pending', createdAt: time, expiresAt: time + 600000, reason: null };
      proposals.push({ id, ...proposal });
      return { id, transcript: input.payload.text, language: 'fr', confidence: null, reasoning: '', durationMs: 0, calls: [], results: [], status: 'pending', proposal };
    }
    if (proposalScenario && input.method === 'correct_request') {
      Object.assign(proposals.find(p => p.id === input.payload.id), { state: 'invalidated', reason: 'corrected', message: 'Proposition retirée après correction échouée. Reformulez votre demande.' });
      if (correctionSuccess) {
        empty.applications[0].aliases.push('Alias corrigé');
        const id = `proposal-${++sequence}`, proposal = { state: 'pending', createdAt: time, expiresAt: time + 600000, reason: null };
        proposals.push({ id, ...proposal });
        return { id, transcript: 'Correction réussie', language: 'fr', confidence: null, reasoning: '', durationMs: 0, calls: [], results: [], status: 'pending', proposal };
      }
      throw Error('Correction de test échouée');
    }
    if (proposalScenario && input.method === 'set_application_enabled') {
      empty.applications[0].enabled = input.payload.enabled;
      return structuredClone(empty);
    }
    if (proposalScenario && input.method === 'confirm') {
      return { id: input.payload.id, status: 'expired', proposal: { state: 'expired', createdAt: time - 600000, expiresAt: time, reason: 'expired' }, message: 'Cette proposition a expiré. Reformulez votre demande.' };
    }
    if (input.method === 'recover_config') {
      if (recoveryFailure) throw Error('Sauvegarde impossible ; original conservé.');
      profileError = undefined;
      return { config: empty, backupPath: 'C:\\fixture\\applications.invalid.backup.json' };
    }
    throw Error(`Unexpected method ${input.method}`);
  };
  const source = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8');
  const { descriptor } = parse(source);
  const script = compileScript(descriptor, { id: 'pam-profile-test', inlineTemplate: true, templateOptions: { compilerOptions: { hoistStatic: false } } });
  const compiled = ts.transpileModule(script.content, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const localRequire = createRequire(import.meta.url);
  const stub = vue.defineComponent({ render: () => vue.h('span') });
  const injectedRequire = name => {
    if (name === './errors' || name === '../errors') {
      const result = {};
      const code = ts.transpileModule(readFileSync(new URL('../src/errors.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
      new Function('require','exports',code)(localRequire,result); return result;
    }
    if (name === 'vue') return vue;
    if (transferScenario && name.endsWith('/ProfileTransfer.vue')) {
      const component = parse(readFileSync(new URL('../src/components/ProfileTransfer.vue', import.meta.url), 'utf8')).descriptor;
      const code = ts.transpileModule(compileScript(component, { id: 'pam-transfer-test', inlineTemplate: true, templateOptions: { compilerOptions: { hoistStatic: false } } }).content, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
      const result = {}; new Function('require', 'exports', code)(injectedRequire, result); return result;
    }
    if (proposalScenario && name.endsWith('/ModalDialog.vue')) return { __esModule: true, default: vue.defineComponent({
      setup: (_props, { slots }) => () => vue.h('section', slots.default?.({ requestClose() {} })),
    }) };
    if (name.endsWith('.vue')) return { __esModule: true, default: stub };
    if (name.includes('@tauri-apps/api/core')) return { invoke, isTauri: () => true };
    if (name.includes('@tauri-apps/api/event')) return { listen: async () => () => {} };
    if (name.includes('@tauri-apps/plugin-dialog')) return { open: async () => null };
    if (name === './actions') return { commandActions: () => [], choiceArguments: () => ({}) };
    if (name === './proposals') {
      const result = {};
      const code = ts.transpileModule(readFileSync(new URL('../src/proposals.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
      new Function('exports', 'Date', code)(result, TestDate); return result;
    }
    if (name === './audio/recorder') return { VoiceRecorder: class { async start() {if(microphoneFailure)throw new DOMException('SENTINEL','NotAllowedError');} async dispose() {} } };
    return localRequire(name);
  };
  const exports = {};
  const timers = { setInterval: (callback, ms) => { timerCallbacks.set(ms, callback); return ms; }, clearInterval: ms => timerCallbacks.delete(ms), setTimeout: () => 1, clearTimeout: () => {} };
  new Function('require', 'exports', 'window', 'HTMLElement', 'Date', compiled)(injectedRequire, exports, timers, class {}, TestDate);
  const node = (type, text = '') => ({ type, tagName: type.toUpperCase(), text, children: [], props: {}, parent: null, addEventListener() {}, removeEventListener() {}, getRootNode() { return globalThis.document; }, get options() { return this.children.filter(n => n.type === 'option'); } });
  const renderer = vue.createRenderer({
    createElement: type => node(type), createText: text => node('#text', text), createComment: text => node('#comment', text),
    setText: (n, text) => n.text = text, setElementText: (n, text) => { n.text = text; n.children = []; },
    parentNode: n => n.parent, nextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1] || null,
    patchProp: (n, key, _old, value) => n.props[key] = value,
    insert(n, parent, anchor) {
      if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1);
      n.parent = parent; const index = parent.children.indexOf(anchor);
      parent.children.splice(index < 0 ? parent.children.length : index, 0, n);
    },
    remove(n) { n.parent.children.splice(n.parent.children.indexOf(n), 1); n.parent = null; },
  });
  const root = node('root'), app = renderer.createApp(exports.default);
  app.mount(root); t.after(() => app.unmount());
  const settle = async () => { for (let i = 0; i < 12; i++) { await Promise.resolve(); await vue.nextTick(); } };
  const all = n => [n, ...n.children.flatMap(all)];
  const textOf = n => n.text + n.children.map(textOf).join('');
  const button = label => all(root).find(n => n.type === 'button' && textOf(n) === label);
  const click = async label => { const b = button(label); assert.ok(b, label); assert.ok(!b.props.disabled); await b.props.onClick(); await settle(); };
  await settle();
  return { root, calls, button, click, text: () => textOf(root), all: () => all(root), settle,
    async send(text) {
      all(root).find(n => n.props['aria-label'] === 'Demande écrite').props['onUpdate:modelValue'](text);
      await settle(); await all(root).find(n => n.type === 'form' && n.props.class === 'text-request').props.onSubmit({ preventDefault() {} }); await settle();
    },
    async tick(ms) { time += ms; timerCallbacks.get(1000)?.(); await settle(); },
    async health() { timerCallbacks.get(15000)?.(); for (let i = 0; i < 5; i++) await settle(); },
    async disableApplication() {
      // Drive the real application toggle handler through its rendered button.
      await all(root).find(n => n.props['aria-label'] === 'Applications').props.onClick(); await settle();
      await all(root).find(n => n.props.role === 'switch').props.onClick(); await settle();
      await all(root).find(n => n.props['aria-label'] === 'Assistant').props.onClick(); await settle();
    },
  };
}
test('PAM-12 Vue : message structuré corrélable et export uniquement après clic volontaire', async t => {
  const f=await mountApp(t,{healthy:true,diagnosticScenario:true});
  assert.equal(f.calls.some(c=>c.method==='export_diagnostics'),false);
  await f.send('SENTINEL');
  const alerts=f.all().filter(n=>n.props.role==='alert').map(n=>n.text+n.children.map(c=>c.text).join('')).join('');
  assert.match(alerts,/Rechargez les moteurs/);assert.match(alerts,/pam-1-2-3/);assert.doesNotMatch(alerts,/SENTINEL|Users|Private|object Object/);
  await f.all().find(n=>n.props['aria-label']==='Préférences').props.onClick();await f.settle();
  await f.click('Préparer un export de diagnostic');
  assert.equal(f.calls.filter(c=>c.method==='export_diagnostics').length,1);
  const output=f.all().find(n=>n.props['aria-label']==='Export de diagnostic filtré');assert.match(output.props.value,/model_failure/);assert.ok(output.props.readonly!==undefined);
  await f.click('Fermer l’export');assert.equal(f.all().some(n=>n.props['aria-label']==='Export de diagnostic filtré'),false);
});
test('PAM-12 Vue : refus du microphone envoyé sans données personnelles et affiché avec sa référence',async t=>{
  const f=await mountApp(t,{healthy:true,microphoneFailure:true});
  await f.all().find(n=>n.props['aria-label']==='Commencer l’enregistrement').props.onClick();await f.settle();
  assert.deepEqual(f.calls.find(c=>c.method==='diagnostic_event').payload,{code:'microphone_denied'});
  assert.match(f.text(),/microphone refusé/);assert.match(f.text(),/pam-1-2-4/);assert.doesNotMatch(f.text(),/SENTINEL/);
});
test('le profil invalide bloque la demande et l’annulation de récupération ne produit aucun effet', async t => {
  const f = await mountApp(t);
  assert.match(f.text(), /Profil invalide/);
  assert.equal(f.all().find(n => n.props['aria-label'] === 'Commencer l’enregistrement').props.disabled, true);
  await f.click('Récupérer le profil');
  assert.match(f.text(), /copie exacte/); assert.match(f.text(), /applications et formulations seront retirées/);
  await f.click('Annuler');
  assert.equal(f.calls.some(call => call.method === 'recover_config'), false);
  assert.equal(f.button('Sauvegarder puis restaurer'), undefined);
});
test('le chargement normal conserve les applications d’un profil valide', async t => {
  const f = await mountApp(t, { healthy: true });
  assert.match(f.text(), /Éditeur valide/);
  assert.equal(f.button('Récupérer le profil'), undefined);
  assert.equal(f.all().find(n => n.props['aria-label'] === 'Commencer l’enregistrement').props.disabled, false);
});
test('la confirmation transmet l’empreinte puis affiche la sauvegarde et le profil vide', async t => {
  const f = await mountApp(t);
  await f.click('Récupérer le profil'); await f.click('Sauvegarder puis restaurer');
  assert.deepEqual(f.calls.find(call => call.method === 'recover_config').payload, { confirmed: true, fingerprint: 'original' });
  assert.match(f.text(), /Original sauvegardé : C:\\fixture\\applications.invalid.backup.json/);
  assert.equal(f.button('Récupérer le profil'), undefined);
});
test('une sauvegarde refusée laisse la récupération disponible et affiche l’erreur', async t => {
  const f = await mountApp(t, { recoveryFailure: true });
  await f.click('Récupérer le profil'); await f.click('Sauvegarder puis restaurer');
  assert.match(f.text(), /Sauvegarde impossible ; original conservé/);
  assert.ok(f.button('Récupérer le profil'));
  assert.doesNotMatch(f.text(), /Original sauvegardé/);
});

test('PAM-11 Vue : export local, aperçu explicite des préférences, édition et annulation sans remplacement', async t => {
  const f = await mountApp(t, { healthy: true, transferScenario: true });
  await f.all().find(n => n.props['aria-label'] === 'Préférences').props.onClick(); await f.settle();
  await f.click('Afficher l’export du profil');
  const exported = f.all().find(n => n.props['aria-label'] === 'Export du profil');
  assert.ok(exported.props.readonly !== undefined); assert.match(exported.props.value, /Éditeur valide/);
  const content = f.all().find(n => n.props['aria-label'] === 'Profil à importer');
  content.props['onUpdate:modelValue']('{"version":2}'); await f.settle();
  await f.click('Vérifier l’import');
  assert.match(f.text(), /1 applications et 2 formulations/); assert.match(f.text(), /désactivée/); assert.match(f.text(), /80 %/);
  content.props['onUpdate:modelValue']('{"version":1}'); await f.settle();
  assert.equal(f.button('Confirmer le remplacement du profil'), undefined);
  await f.click('Vérifier l’import'); await f.click('Annuler l’import');
  assert.equal(f.calls.some(call => call.method === 'import_config'), false);
});
test('PAM-11 Vue : confirmation liée à l’aperçu, résultat et erreur de remplacement', async t => {
  for (const transferFailure of [false, true]) {
    const f = await mountApp(t, { healthy: true, transferScenario: true, transferFailure });
    await f.all().find(n => n.props['aria-label'] === 'Préférences').props.onClick(); await f.settle();
    f.all().find(n => n.props['aria-label'] === 'Profil à importer').props['onUpdate:modelValue']('import-content'); await f.settle();
    await f.click('Vérifier l’import'); await f.click('Confirmer le remplacement du profil');
    const payload = f.calls.find(call => call.method === 'import_config').payload;
    assert.equal(payload.content, 'import-content'); assert.equal(payload.confirmed, true);
    assert.equal(payload.fingerprint, 'before'); assert.equal(payload.importFingerprint, 'import-digest');
    assert.equal(f.button('Confirmer le remplacement du profil'), undefined);
    assert.match(f.text(), transferFailure ? /Le profil a changé/ : /Profil importé.*previous.json/);
    if (transferFailure) assert.doesNotMatch(f.text(), /Profil importé/);
  }
});
test('PAM-11 Vue : restauration affiche le contenu sauvegardé et confirme ses empreintes', async t => {
  const f = await mountApp(t, { healthy: true, backupScenario: true });
  await f.all().find(n => n.props['aria-label'] === 'Préférences').props.onClick(); await f.settle();
  await f.click('Préparer une restauration'); assert.match(f.text(), /Éditeur sauvegardé/); assert.match(f.text(), /3 formulations/);
  assert.equal(f.calls.some(call => call.method === 'recover_config'), false);
  await f.click('Restaurer la dernière copie valide');
  assert.deepEqual(f.calls.find(call => call.method === 'recover_config').payload, { confirmed: true, fingerprint: 'previewed-current', restoreBackup: true, backupFingerprint: 'previewed-backup' });
});

test('PAM-10 Vue : vingt-cinq demandes conservent toutes les validations non résolues', async t => {
  const f = await mountApp(t, { healthy: true, proposalScenario: true });
  for (let i = 0; i < 25; i++) await f.send(`Demande ${i}`);
  assert.equal(f.all().filter(n => n.type === 'button' && n.props.class === 'primary small').length, 25);
  assert.match(f.text(), /Demande 0/); assert.match(f.text(), /À valider avant/);
  await f.tick(600000);
  assert.equal(f.button('Exécuter'), undefined); assert.match(f.text(), /Proposition expirée/); assert.match(f.text(), /Reformulez/);
});
test('PAM-10 Vue : état métier expiré reçu à la confirmation retire le bouton', async t => {
  const f = await mountApp(t, { healthy: true, proposalScenario: true }); await f.send('Mon action');
  await f.click('Exécuter'); assert.equal(f.button('Exécuter'), undefined);
  assert.match(f.text(), /Proposition expirée/); assert.match(f.text(), /Reformulez votre demande/);
  assert.equal(f.calls.filter(c => c.method === 'confirm').length, 1);
});
test('PAM-10 Vue : correction échouée synchronise le retrait et conserve sa cause', async t => {
  const f = await mountApp(t, { healthy: true, proposalScenario: true }); await f.send('Mon action');
  await f.click('Corriger la demande');
  const forms = f.all().filter(n => n.type === 'form');
  await forms[forms.length - 1].props.onSubmit({ preventDefault() {} }); await f.settle(); await f.health();
  assert.equal(f.button('Exécuter'), undefined); assert.match(f.text(), /correction échouée/);
});
test('PAM-10 Vue : modifier une application retire immédiatement les validations visibles', async t => {
  const f = await mountApp(t, { healthy: true, proposalScenario: true }); await f.send('Mon action');
  await f.disableApplication(); assert.equal(f.button('Exécuter'), undefined); assert.match(f.text(), /applications ou formulations ont changé/);
});
test('PAM-10 Vue : une correction qui ajoute un alias conserve la nouvelle proposition valide', async t => {
  const f = await mountApp(t, { healthy: true, proposalScenario: true, correctionSuccess: true }); await f.send('Mon action');
  await f.click('Corriger la demande'); const forms = f.all().filter(n => n.type === 'form');
  await forms[forms.length - 1].props.onSubmit({ preventDefault() {} }); await f.settle();
  assert.ok(f.button('Exécuter')); assert.match(f.text(), /Correction réussie/);
  assert.equal(f.all().filter(n => n.type === 'button' && n.props.class === 'primary small').length, 1);
});
