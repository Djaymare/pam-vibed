import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { parse, compileScript } from '@vue/compiler-sfc';
import ts from 'typescript';
import * as vue from 'vue';

// Compile and mount the real App SFC with Vue's renderer. Only native services,
// timers and unrelated child components are substituted; no WebView2 claim.
async function mountApp(t, { recoveryFailure = false, healthy = false } = {}) {
  const previousDocument = globalThis.document;
  globalThis.document = { activeElement: null };
  t.after(() => { if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument; });
  const calls = [];
  const empty = { version: 1, applications: [], commandAliases: [], language: 'fr', autoExecute: true, confidenceThreshold: 0.7 };
  let profileError = { message: 'Profil invalide : applications[0] : Nom invalide.', fingerprint: 'original', recoverable: true };
  if (healthy) {
    profileError = undefined;
    empty.applications = [{ id: '11111111-1111-4111-8111-111111111111', name: 'Éditeur valide', description: 'Test', executable: 'C:\\fixture.exe', arguments: [], aliases: [], enabled: true }];
  }
  const invoke = async (command, input) => {
    if (command !== 'assistant_request') return;
    calls.push(input);
    if (input.method === 'status') return { ready: !profileError, config: empty, configError: profileError, checks: [], engine: null };
    if (input.method === 'recover_config') {
      if (recoveryFailure) throw Error('Sauvegarde impossible ; original conservé.');
      profileError = undefined;
      return { config: empty, backupPath: 'C:\\fixture\\applications.invalid.backup.json' };
    }
    throw Error(`Unexpected method ${input.method}`);
  };
  const source = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8');
  const { descriptor } = parse(source);
  const script = compileScript(descriptor, { id: 'pam-profile-test', inlineTemplate: true });
  const compiled = ts.transpileModule(script.content, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const localRequire = createRequire(import.meta.url);
  const stub = vue.defineComponent({ render: () => vue.h('span') });
  const injectedRequire = name => {
    if (name === 'vue') return vue;
    if (name.endsWith('.vue')) return { __esModule: true, default: stub };
    if (name.includes('@tauri-apps/api/core')) return { invoke, isTauri: () => true };
    if (name.includes('@tauri-apps/api/event')) return { listen: async () => () => {} };
    if (name.includes('@tauri-apps/plugin-dialog')) return { open: async () => null };
    if (name === './actions') return { commandActions: () => [], choiceArguments: () => ({}) };
    if (name === './audio/recorder') return { VoiceRecorder: class {} };
    return localRequire(name);
  };
  const exports = {};
  const timers = { setInterval: () => 1, clearInterval: () => {}, setTimeout: () => 1, clearTimeout: () => {} };
  new Function('require', 'exports', 'window', compiled)(injectedRequire, exports, timers);
  const node = (type, text = '') => ({ type, tagName: type.toUpperCase(), text, children: [], props: {}, parent: null, addEventListener() {}, removeEventListener() {} });
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
  return { root, calls, button, click, text: () => textOf(root), all: () => all(root) };
}
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
