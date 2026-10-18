import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile, mkdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createServer as createNetServer } from 'node:net';
import { firstUseChecks } from '../tests/first-use-checks.mjs';
import { navigationChecks } from '../tests/navigation-checks.mjs';
import { guidedInputChecks } from '../tests/guided-input-checks.mjs';
import { componentJourneyChecks } from '../tests/component-journey-checks.mjs';

// Real Windows WebView2 + Vue components, with only native services simulated.
// Build src-tauri/examples/modal-test-host.rs first and set PAM_MODAL_TEST_HOST.
const root = resolve(process.env.PAM_TEST_SOURCE_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '..'));
assert.equal(process.platform, 'win32', 'This suite requires Windows WebView2.');
const host = process.env.PAM_MODAL_TEST_HOST;
assert.ok(host, 'Set PAM_MODAL_TEST_HOST to the compiled disposable host.');
const dependencyRoot = resolve(process.env.PAM_TEST_DEPENDENCY_ROOT || root);
const { createServer } = await import(pathToFileURL(join(dependencyRoot, 'node_modules/vite/dist/node/index.js')));
const { default: vue } = await import(pathToFileURL(join(dependencyRoot, 'node_modules/@vitejs/plugin-vue/dist/index.mjs')));
const fixture = join(root, 'tests/fixtures/modal-native.js');
const reportDirectory=resolve(process.env.PAM_WEBVIEW_REPORT_DIR||join(root,'artifacts','webview-tests',String(Date.now())));
await mkdir(reportDirectory,{recursive:true});
const server = await createServer({ configFile: false, root, cacheDir: join(dependencyRoot, 'node_modules/.vite-modal-test'), plugins: [vue()],
  resolve: { alias: [ { find: /^@tauri-apps\/(api\/(core|event)|plugin-dialog)$/, replacement: fixture } ] },
  server: { host: '127.0.0.1', port: 0, fs: { allow: [root, dependencyRoot] }, watch: { ignored: ['**/artifacts/**', '**/src-tauri/target/**'] } },
});
const portServer = createNetServer();
await new Promise(done => portServer.listen(0, '127.0.0.1', done));
const debugPort = portServer.address().port;
await new Promise(done => portServer.close(done));
const profile = await mkdtemp(join(tmpdir(), 'pam-modal-'));
let child, socket, evaluatePage, cdpPage, spawnError;
const delay = ms => new Promise(done => setTimeout(done, ms));
const results = [];
const report={kind:'Windows WebView2; simulated PAM services',profile,host,checks:results,exceptions:[],stderr:'',cleanup:{},outcome:'running'};
try {
  await server.listen();
  const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/modal-page.html`;
  child = spawn(host, [], { windowsHide: true, stdio: 'pipe', env: { ...process.env, PAM_MODAL_TEST_URL: `${url}?component`, PAM_MODAL_TEST_PROFILE: profile, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort}${process.env.PAM_NVDA_SPEECH_LOG ? ' --force-renderer-accessibility' : ''}${process.argv.includes('--first-use-only') && !process.argv.includes('--microphone-denied') ? ' --use-fake-ui-for-media-stream --use-fake-device-for-media-stream' : ''}` } });
  report.pid=child.pid;
  child.on('error', error => {spawnError=error;console.error(error);});
  child.stderr.on('data', data => {report.stderr=(report.stderr+data).slice(-16000);process.stderr.write(data);});
  let target;
  for (let i = 0; i < 200; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(t => t.type === 'page' && t.url.startsWith(url)); } catch {}
    if (target) break;
    if(spawnError)throw spawnError;
    if (child.exitCode !== null) throw Error(`Host exited: ${child.exitCode}`);
    await delay(100);
  }
  assert.ok(target, 'WebView2 debugging target available');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, reject) => { socket.onopen = done; socket.onerror = reject; });
  let seq = 0;
  const pending = new Map();
  socket.onmessage = event => { const r = JSON.parse(event.data); if (!r.id) { if (r.method === 'Runtime.exceptionThrown') {report.exceptions.push(r.params);console.error(JSON.stringify(r.params));} return; } const p = pending.get(r.id); if (!p) return; pending.delete(r.id); clearTimeout(p.timer); r.error ? p.reject(Error(JSON.stringify(r.error))) : p.resolve(r.result); };
  const cdp = (method, params = {}) => new Promise((done, reject) => { const id = ++seq; const timer = setTimeout(() => { pending.delete(id); reject(Error(`Timeout: ${method}`)); }, 10000); pending.set(id, { resolve: done, reject, timer }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
  evaluatePage=evaluate;cdpPage=cdp;
  await cdp('Runtime.enable');
  await cdp('Accessibility.enable');
  const wait = async expression => { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await delay(30); } throw Error(`Not ready: ${expression}; DOM=${await evaluate('document.body.innerHTML')}`); };
  if(process.env.PAM_WEBVIEW_INJECT_FAILURE==='1'){
    await wait('!!window.pamTestResources');
    await evaluate('new AudioContext()');
    throw Error('PAM-32 intentional runner failure');
  }
  const active = selector => evaluate(`document.activeElement?.matches(${JSON.stringify(selector)})`);
  const key = async (name, modifiers = 0) => {
    const codes = { Tab: 9, Enter: 13, Escape: 27, ArrowDown: 40, a: 65 };
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: name === 'a' ? 'KeyA' : name, windowsVirtualKeyCode: codes[name], modifiers, text: name === 'Enter' ? '\r' : undefined });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: name === 'a' ? 'KeyA' : name, windowsVirtualKeyCode: codes[name], modifiers });
    await delay(25);
  };
  const go = async selector => { for (let i = 0; i < 100; i++) { if (await active(selector)) return; await key('Tab'); } throw Error(`Keyboard cannot reach ${selector}; active=${await evaluate('document.activeElement.outerHTML')}`); };
  const enter = async selector => { await go(selector); await key('Enter'); };
  const fill = async (selector, value) => { await go(selector); await key('a', 2); await cdp('Input.insertText', { text: value }); };
  const check = (name, condition) => { assert.ok(condition, name); results.push(name); console.log(`PASS ${name}`); };
  const name = async title => { const ax = await cdp('Accessibility.getFullAXTree'); check(`AX dialog: ${title}`, ax.nodes.some(n => !n.ignored && n.role?.value === 'dialog' && n.name?.value === title)); };
  const ring = async () => {
    for (const shift of [0, 8]) for (let i = 0; i < 30; i++) { await key('Tab', shift); assert.ok(await evaluate('document.querySelector("dialog[open]")?.contains(document.activeElement)'), 'Focus escaped modal'); }
    check('Tab and Shift+Tab stay inside', true);
    await evaluate('document.querySelector("[data-dialog-fallback], #fallback").focus()');
    check('Background focus is inert', await evaluate('document.querySelector("dialog[open]").contains(document.activeElement)'));
  };
  if (!process.argv.includes('--first-use-only') && !process.argv.includes('--guided-only') && !process.argv.includes('--navigation-only') && !process.argv.includes('--status-only') && !process.argv.includes('--proposals-only')) {
  await wait('!!document.querySelector("#trigger")');
  await enter('#trigger'); await wait('!!document.querySelector("dialog[open]")');
  check('Component initial input', await active('#initial'));
  await name('Dialogue de composant'); await ring();
  await go('#last'); await key('Tab'); check('Last wraps to first', await active('#initial'));
  await key('Tab', 8); check('First wraps to last', await active('#last'));
  await go('#initial'); await key('Tab'); check('Disabled, hidden and closed details omitted', await active('#summary'));
  await enter('#veto'); await key('Escape'); check('Parent can veto closing', await evaluate('!!document.querySelector("dialog[open]")'));
  await enter('#veto'); await key('Escape'); await wait('!document.querySelector("dialog[open]")'); check('Escape restores trigger', await active('#trigger'));
  await enter('#trigger'); await enter('#remove'); await enter('#last'); await wait('!document.querySelector("dialog[open]")'); check('Removed trigger uses fallback', await active('#fallback'));
  await cdp('Page.navigate', { url: `${url}?component` }); await wait('!!document.querySelector("#trigger")');
  await enter('#trigger'); await enter('#busy'); await key('Escape'); check('Busy dialog retains focus and blocks Escape', await evaluate('!!document.querySelector("dialog[open]") && document.querySelector("dialog").contains(document.activeElement)'));
  await key('Tab'); await key('Tab', 8); check('No enabled controls: focus remains on dialog', await active('dialog'));
  await delay(600); await key('Escape'); await wait('!document.querySelector("dialog[open]")');
  await enter('#trigger');
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: 1, y: 1, button: 'left', clickCount: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 1, y: 1, button: 'left', clickCount: 1 });
  await wait('!document.querySelector("dialog[open]")'); check('Outside click restores trigger', await active('#trigger'));

  await cdp('Page.navigate', { url }); await wait('!!document.querySelector(".page-intro") && !document.querySelector(".voice-button")?.disabled');
  await enter('nav button:nth-of-type(2)');
  await enter('.page-intro button.primary'); await wait('!!document.querySelector(".discovery-item")');
  check('Picker initial search', await active('input[type=search]')); await name('Choisir sur cet ordinateur'); await ring();
  await key('Escape'); await wait('!document.querySelector("dialog[open]")'); check('Picker Escape restores add', await active('.page-intro button.primary'));
  await enter('.page-intro button.primary'); await enter('.discovery-item'); await wait('!!document.querySelector("#editor-title")');
  check('Detected application opens editor at name', await active('[data-dialog-initial-focus]')); await key('Escape'); await wait('!document.querySelector("dialog[open]")'); check('Picker-to-editor preserves original trigger', await active('.page-intro button.primary'));
  await enter('.page-intro button.primary'); await enter('.discovery-footer button'); await wait('!!document.querySelector("#editor-title")');
  check('Manual editor initial name', await active('[data-dialog-initial-focus]')); await name('Nouvelle application');
  if (process.env.PAM_MODAL_SCREENSHOT) await writeFile(process.env.PAM_MODAL_SCREENSHOT, Buffer.from((await cdp('Page.captureScreenshot')).data, 'base64'));
  await ring();
  await enter('.modal-footer button.primary'); check('Required validation keeps modal focus', await evaluate('document.querySelector("dialog").contains(document.activeElement)'));
  await fill('input[data-dialog-initial-focus]', 'Clavier'); await fill('textarea[required]', 'Application de test'); await fill('.path-field input', 'C:\\fixture.exe');
  await enter('.modal-footer button.primary'); await wait('!!document.querySelector("dialog [role=alert]")'); check('Save error keeps editor usable', await evaluate('document.querySelector("dialog").contains(document.activeElement)')); await ring();
  await enter('.modal-footer button.primary'); await wait('!document.querySelector("dialog[open]")'); check('Keyboard add succeeds and restores trigger', await active('.page-intro button.primary'));
  await enter('.application-card [aria-label="Modifier Clavier"]'); await wait('!!document.querySelector("#editor-title")'); await name('Modifier l’application');
  await fill('input[data-dialog-initial-focus]', 'Clavier modifié'); await enter('.modal-footer button.primary'); await wait('!document.querySelector("dialog[open]")'); check('Keyboard edit succeeds and restores same trigger', await active('.application-card [aria-label="Modifier Clavier modifié"]'));
  await enter('nav button:nth-of-type(1)'); await fill('.text-request input', 'Demande fixture'); await enter('.send-button'); await wait('!!document.querySelector(".turn-correction button")');
  await enter('.turn-correction button'); await wait('!!document.querySelector("#correction-title")'); check('Correction initial text', await active('textarea[data-dialog-initial-focus]')); await name('Corriger la demande'); await ring();
  await fill('textarea[data-dialog-initial-focus]', ''); await key('Tab');
  check('Correction empty form cannot submit and retains focus', await evaluate('document.querySelector("textarea[data-dialog-initial-focus]").value === "" && document.querySelector(".modal-footer button.primary").disabled && document.querySelector("dialog").contains(document.activeElement)'));
  await fill('textarea[data-dialog-initial-focus]', 'Correction fixture'); await enter('.modal-footer button.primary'); await wait('!!document.querySelector("dialog [role=alert]")'); check('Correction error retains focus', await evaluate('document.querySelector("dialog").contains(document.activeElement)')); await ring();
  await enter('.modal-footer button.primary'); await wait('!document.querySelector("dialog[open]")'); check('Keyboard correction succeeds and restores original trigger', await active('.turn-correction button'));
  await enter('.turn-correction button'); await key('Escape'); await wait('!document.querySelector("dialog[open]")'); check('Correction Escape restores trigger', await active('.turn-correction button'));
  await cdp('Page.navigate', { url: `${url}?availability` });
  await wait('!!document.querySelector("nav button:nth-of-type(2)")');
  await enter('nav button:nth-of-type(2)');
  await wait('!!document.querySelector(".application-card .result-error")');
  check('Unavailable application is announced with a repair action', await evaluate('document.querySelector(".application-card .result-error").textContent.includes("Indisponible") && [...document.querySelectorAll("[aria-label]")].some(b=>b.getAttribute("aria-label")==="Réparer Fixture")'));
  await enter('.application-card [role=switch]');
  await wait('document.querySelector(".application-card [role=switch]").getAttribute("aria-checked") === "false"');
  check('Disable uses the state endpoint and preserves target and formulations', await evaluate('window.pamAvailabilityFixture.calls.some(c=>c.method === "set_application_enabled" && Object.keys(c.payload).length === 2) && window.pamAvailabilityFixture.config.applications[0].arguments[0] === "--keep" && window.pamAvailabilityFixture.config.applications[0].aliases[0] === "Mon test" && window.pamAvailabilityFixture.config.commandAliases.length === 1'));
  await enter('.application-card [role=switch]');
  await wait('!!document.querySelector(".notice.error")');
  check('Unavailable reactivation keeps the switch disabled in the profile', await evaluate('document.querySelector(".application-card [role=switch]").getAttribute("aria-checked") === "false"'));
  await enter('[aria-label="Réparer Fixture"]'); await wait('!!document.querySelector("#editor-title")');
  await evaluate('[...document.querySelectorAll("dialog button")].find(b=>b.textContent.includes("Choisir une autre application Windows")).focus()');
  await key('Enter'); await wait('!!document.querySelector("#discovery-title")');
  await key('Escape'); await wait('!!document.querySelector("#editor-title")');
  check('Cancelling replacement restores the existing editor and name', await evaluate('document.querySelector("input[data-dialog-initial-focus]").value === "Fixture" && window.pamAvailabilityFixture.config.applications.length === 1'));
  await enter('.path-field button');
  await wait('document.querySelector(".path-field input").value === "C:\\\\repaired.exe"');
  await enter('.modal-footer button.primary'); await wait('!document.querySelector("dialog[open]") && !document.querySelector(".application-card .result-error")');
  await enter('.application-card [role=switch]');
  await wait('document.querySelector(".application-card [role=switch]").getAttribute("aria-checked") === "true"');
  check('Path repair and reactivation retain the original ID, arguments and formulations', await evaluate('window.pamAvailabilityFixture.config.applications[0].id === "11111111-1111-4111-8111-111111111111" && window.pamAvailabilityFixture.config.applications[0].arguments[0] === "--keep" && window.pamAvailabilityFixture.config.commandAliases[0].phrase === "Ouvre mon test"'));
  await enter('[aria-label="Modifier Fixture"]');
  await evaluate('[...document.querySelectorAll("dialog button")].find(b=>b.textContent.includes("Choisir une autre application Windows")).focus()');
  await key('Enter'); await wait('!!document.querySelector(".discovery-item:not([disabled])")');
  await enter('.discovery-item'); await wait('!!document.querySelector("#editor-title")');
  check('Catalogue replacement preserves the editor name', await evaluate('document.querySelector("input[data-dialog-initial-focus]").value === "Fixture" && !!document.querySelector(".detected-target")'));
  await enter('.modal-footer button.primary'); await wait('!document.querySelector("dialog[open]")');
  check('Catalogue replacement updates one existing record and preserves command formulations', await evaluate('window.pamAvailabilityFixture.config.applications.length === 1 && window.pamAvailabilityFixture.config.applications[0].windowsApp.appId === "Fixture.Detected" && window.pamAvailabilityFixture.config.commandAliases[0].applicationId === window.pamAvailabilityFixture.config.applications[0].id'));
  await cdp('Page.navigate', { url: `${url}?drafts` });
  await wait('!!document.querySelector(".page-intro") && !document.querySelector(".voice-button")?.disabled');
  await enter('nav button:nth-of-type(2)');
  await enter('.page-intro button.primary'); await enter('.discovery-footer button');
  await wait('!!document.querySelector("#editor-title")');
  await key('Escape'); await wait('!document.querySelector("dialog[open]")');
  check('PAM-19 unchanged application closes without confirmation', true);
  await enter('.page-intro button.primary'); await enter('.discovery-footer button');
  await wait('!!document.querySelector("#editor-title")');
  const longDescription='  Une description à conserver exactement. '.repeat(5);
  await fill('dialog textarea[required]', longDescription);
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: 1, y: 1, button: 'left', clickCount: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 1, y: 1, button: 'left', clickCount: 1 });
  await wait('!!document.querySelector("#discard-draft-title")');
  await name('Abandonner les modifications ?');
  check('PAM-19 dirty outside close opens confirmation with safe initial focus', await active('[data-keep-draft]'));
  for(const modifiers of [0,8])for(let i=0;i<8;i++){
    await key('Tab',modifiers);
    assert.ok(await evaluate('[...document.querySelectorAll("dialog[open]")].at(-1).contains(document.activeElement)'));
  }
  check('PAM-19 nested confirmation traps both keyboard directions',true);
  await key('Escape');await wait('!document.querySelector("#discard-draft-title")');
  check('PAM-19 Escape keeps exact long application draft and restores form focus', await evaluate(`document.querySelector('dialog textarea[required]').value === ${JSON.stringify(longDescription)} && document.querySelector('dialog').contains(document.activeElement)`));
  await key('Escape');await wait('!!document.querySelector("#discard-draft-title")');
  await enter('[data-discard-draft]');await wait('!document.querySelector("dialog[open]")');
  check('PAM-19 explicit discard closes application and restores add trigger',await active('.page-intro button.primary'));

  await enter('nav button:nth-of-type(3)');
  await enter('[aria-label="Exécuter automatiquement"]');
  await wait('!!document.querySelector("#settings-error")');
  check('PAM-19 failed preferences retain attempted switch value',await evaluate(`document.querySelector('[aria-label="Exécuter automatiquement"]').getAttribute('aria-checked') === 'true' && window.pamDraftFixture.config.autoExecute === false`));
  await enter('.command-aliases .section-heading button');
  const longPhrase='Une formulation personnelle à conserver exactement '.repeat(3);
  await fill('.alias-phrase input',longPhrase);
  await enter('.alias-form-footer button.primary');await wait('!!document.querySelector("#command-alias-error")');
  await enter('nav button:nth-of-type(1)');
  check('PAM-19 navigation announces retained preferences and formulation',await evaluate('document.querySelector(".notice").textContent.includes("brouillon")'));
  await enter('nav button:nth-of-type(3)');
  check('PAM-19 long formulation and preferences survive error and round-trip navigation',await evaluate(`document.querySelector('.alias-phrase input').value === ${JSON.stringify(longPhrase)} && document.querySelector('[aria-label="Exécuter automatiquement"]').getAttribute('aria-checked') === 'true'`));
  check('PAM-19 errors and helps are linked to editable fields',await evaluate(`document.querySelector('.alias-phrase input').getAttribute('aria-describedby').split(' ').includes('command-alias-error') && document.querySelector('.alias-phrase input').getAttribute('aria-describedby').includes(document.querySelector('.alias-phrase small').id) && document.querySelector('[aria-label="Exécuter automatiquement"]').getAttribute('aria-describedby').split(' ').includes('settings-error') && document.querySelector('[aria-label="Exécuter automatiquement"]').getAttribute('aria-describedby').includes('settings-auto-help')`));
  await enter('.command-alias-editor button.secondary');await wait('!!document.querySelector("#discard-draft-title")');await key('Escape');
  check('PAM-19 cancelling formulation close retains its exact draft',await evaluate(`document.querySelector('.alias-phrase input').value === ${JSON.stringify(longPhrase)}`));
  await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Quitter PAM").focus()');await key('Enter');await wait('!!document.querySelector("#discard-draft-title")');
  check('PAM-19 quitting with retained drafts asks before any desktop action',await evaluate('!window.pamDraftFixture.calls.some(c=>c.method==="desktop_action")'));
  await key('Escape');await wait('!document.querySelector("#discard-draft-title")');
  await evaluate('window.pamDraftFixture.failAlias=false; window.pamDraftFixture.failSettings=false');
  await enter('.alias-form-footer button.primary');await wait('!document.querySelector(".command-alias-editor")');
  await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.includes("Réessayer l’enregistrement")).focus()');await key('Enter');
  await wait('!document.querySelector("#settings-error")');
  check('PAM-19 retained drafts save successfully on explicit retry',await evaluate('window.pamDraftFixture.config.commandAliases.length === 1 && window.pamDraftFixture.config.autoExecute === true'));
  await enter('nav button:nth-of-type(1)');await fill('.text-request input','Demande initiale');await enter('.send-button');await wait('!!document.querySelector(".turn-correction button")');
  await enter('.turn-correction button');await wait('!!document.querySelector("#correction-title")');
  const longCorrection='  Une longue correction à conserver. '.repeat(30);
  await fill('textarea[data-dialog-initial-focus]',longCorrection);
  await evaluate(`const select=document.querySelector('dialog select');select.value=window.pamDraftFixture.config.applications[0].id;select.dispatchEvent(new Event('change',{bubbles:true}));`);
  await wait('!!document.querySelector("dialog .alias-choice input")');
  await evaluate('document.querySelector("dialog .alias-choice input").click()');
  await fill('dialog input[required]','Mon surnom');
  await enter('.modal-footer button.primary');await wait('!!document.querySelector("#correction-form-error")');
  check('PAM-19 partial correction announces saved learning and retains exact text',await evaluate(`document.querySelector('textarea[data-dialog-initial-focus]').value === ${JSON.stringify(longCorrection)} && document.querySelector('dialog [role=status]').textContent.includes('mémorisation') && window.pamDraftFixture.calls.filter(c=>c.method==='correct_request' && c.payload.saveAlias).length===1`));
  await key('Escape');await wait('!!document.querySelector("#discard-draft-title")');await enter('[data-keep-draft]');
  await enter('.modal-footer button.primary');await wait('!document.querySelector("dialog[open]")');
  check('PAM-19 correction retry keeps one alias and performs no second learning write',await evaluate('window.pamDraftFixture.config.applications[0].aliases.filter(a=>a==="Mon surnom").length === 1 && window.pamDraftFixture.calls.filter(c=>c.method==="correct_request" && c.payload.saveAlias).length === 1 && window.pamDraftFixture.calls.filter(c=>c.method==="correct_request").length === 2'));
  await cdp('Page.navigate', { url: `${url}?deletion` });await wait('!!document.querySelector(".page-intro") && !document.querySelector(".voice-button")?.disabled');
  await enter('nav button:nth-of-type(2)');await enter('[aria-label="Supprimer Fixture"]');await wait('!!document.querySelector("#delete-title")');
  await name('Supprimer cette application de PAM ?');await ring();
  check('PAM-20 confirmation describes exact app, names and two learned formulations',await evaluate('document.querySelector("dialog").textContent.includes("Mon éditeur") && document.querySelectorAll(".deletion-aliases li").length===2 && document.querySelector("dialog").textContent.includes("définitive") && !window.pamDeletionFixture.calls.some(c=>c.method.startsWith("delete_"))'));
  await key('Escape');await wait('!document.querySelector("dialog[open]")');check('PAM-20 Escape cancels without effects and restores delete trigger',await active('[aria-label="Supprimer Fixture"]'));
  await enter('[aria-label="Supprimer Fixture"]');await wait('!!document.querySelector("#delete-title")');check('PAM-20 cancellation receives initial focus',await active('[data-delete-cancel]'));
  await evaluate('window.pamDeletionFixture.fail=true');await enter('[data-delete-confirm]');await wait('!!document.querySelector("#delete-error")');
  check('PAM-20 failure stays open, preserves profile and blocks blind retry',await evaluate('document.querySelector("#delete-error").textContent.includes("pas confirmée") && document.querySelector("[data-delete-confirm]").disabled && window.pamDeletionFixture.config.applications.length===2 && window.pamDeletionFixture.config.commandAliases.length===3'));
  await enter('[data-delete-cancel]');await wait('!document.querySelector("dialog[open]")');
  await enter('[aria-label="Supprimer Fixture"]');await evaluate('window.pamDeletionFixture.fail=false;window.pamDeletionFixture.hold=true;document.querySelector("[data-delete-confirm]").click();document.querySelector("[data-delete-confirm]").click()');
  await wait('window.pamDeletionFixture.calls.filter(c=>c.method==="delete_application").length===2');await key('Escape');
  check('PAM-20 double confirm emits once; late Escape cannot cancel dispatched delete',await evaluate('!!document.querySelector("dialog[open]") && document.querySelector("[data-delete-cancel]").disabled && document.querySelector("dialog [role=status]").textContent.includes("plus disponible") && window.pamDeletionFixture.calls.filter(c=>c.method==="delete_application").length===2'));
  await evaluate('window.pamDeletionFixture.release()');await wait('!document.querySelector("dialog[open]")');
  check('PAM-20 success removes app and linked phrases, announces result and restores fallback',await evaluate('window.pamDeletionFixture.config.applications.length===1 && window.pamDeletionFixture.config.commandAliases.length===1 && document.querySelector(".notice[role=status]").textContent.includes("supprimées") && document.activeElement.matches("[data-dialog-fallback]")'));
  await enter('nav button:nth-of-type(3)');await enter('[aria-label="Supprimer la formulation Ouvre mon autre"]');await wait('!!document.querySelector("#delete-title")');await name('Supprimer cette formulation ?');
  check('PAM-20 individual confirmation identifies phrase, action and app while retaining app',await evaluate('document.querySelector("dialog").textContent.includes("Ouvre mon autre") && document.querySelector("dialog").textContent.includes("Autre") && document.querySelector("dialog").textContent.includes("seront conservées")'));
  await enter('[data-delete-cancel]');await wait('!document.querySelector("dialog[open]")');check('PAM-20 individual cancellation sends no request',await evaluate('!window.pamDeletionFixture.calls.some(c=>c.method==="delete_command_alias")'));
  await enter('[aria-label="Supprimer la formulation Ouvre mon autre"]');await evaluate('window.pamDeletionFixture.hold=false');await enter('[data-delete-confirm]');await wait('!document.querySelector("dialog[open]")');
  check('PAM-20 individual confirmed deletion preserves app identity and leaves no duplicate/orphan',await evaluate('window.pamDeletionFixture.config.commandAliases.length===0 && window.pamDeletionFixture.config.applications.length===1 && window.pamDeletionFixture.config.applications[0].id==="22222222-2222-4222-8222-222222222222"'));
  await enter('nav button:nth-of-type(2)');await enter('[aria-label="Supprimer Autre"]');await wait('!!document.querySelector("#delete-title")');check('PAM-20 zero associated formulations explicitly shown',await evaluate('document.querySelector("dialog").textContent.includes("0 formulation(s)") && document.querySelectorAll(".deletion-aliases li").length===0'));await key('Escape');
  }
  if (!process.argv.includes('--first-use-only') && !process.argv.includes('--guided-only') && !process.argv.includes('--navigation-only') && !process.argv.includes('--proposals-only')) {
  // Leave time to foreground this disposable host for a real screen reader.
  if (process.env.PAM_NVDA_SPEECH_LOG && process.argv.includes('--status-only')) await delay(15000);
  const nvdaOffset = process.env.PAM_NVDA_SPEECH_LOG ? (await readFile(process.env.PAM_NVDA_SPEECH_LOG, 'utf8')).trim().split('\n').length : 0;
  await cdp('Page.navigate', { url: `${url}?status` });
  await wait('!!window.pamStatusFixture && !!document.querySelector(".voice-card")');
  await wait('document.querySelector(".voice-card").textContent.includes("Démarrage")');
  check('PAM-21 starting runtime disables microphone and never invites capture',await evaluate('document.querySelector(".mic-button").disabled && !document.querySelector(".voice-card").textContent.includes("PRÊT")'));
  await evaluate('window.pamStatusFixture.phase="recovering"');
  await wait('document.querySelector(".runtime-pill").textContent.includes("reprise")');
  check('PAM-21 recovery is announced and the button stays unavailable',await evaluate('document.querySelector(".mic-button").disabled && document.querySelector(".request-status").textContent.includes("reprise")'));
  await evaluate('window.pamStatusFixture.phase="ready"');await wait('!document.querySelector(".mic-button").disabled');
  await enter('.text-request input');await fill('.text-request input','Annonce unique PAM-21');
  await evaluate('window.pamStatusFixture.hold=true');await key('Enter');
  await wait('document.querySelector(".request-status").textContent.includes("Préparation de la demande")');
  check('PAM-21 written request announces preparation without claiming voice transcription',await evaluate('!document.querySelector(".request-status").textContent.includes("Transcription")'));
  await evaluate('window.pamStatusFixture.activity="executing"');
  await wait('document.querySelector(".request-status").textContent.includes("Exécution de la demande")');
  check('PAM-21 sent action explains late cancellation and offers no false cancel',await evaluate('document.querySelector(".request-status").textContent.includes("annulation n’est plus garantie") && ![...document.querySelectorAll(".voice-card button")].some(b=>b.textContent.includes("Annuler"))'));
  await evaluate('window.pamStatusFixture.release();window.pamStatusFixture.hold=false;window.pamStatusFixture.activity="idle"');
  await wait('document.querySelector("[data-result-announcement]").textContent.includes("Proposition à valider")');
  await evaluate('window.pamStatusFixture.announcementMutations=0;new MutationObserver(()=>window.pamStatusFixture.announcementMutations++).observe(document.querySelector("[data-result-announcement]"),{subtree:true,childList:true,characterData:true})');
  const focusBefore=await evaluate('document.activeElement?.outerHTML');await delay(3200);
  check('PAM-21 completing the keyboard request retains the input focus',await active('.text-request input'));
  check('PAM-21 polling neither repeats the result nor moves keyboard focus',await evaluate(`window.pamStatusFixture.announcementMutations===0 && document.activeElement?.outerHTML===${JSON.stringify(focusBefore)}`));
  await evaluate('[...document.querySelectorAll(".approval button")].find(b=>b.textContent.trim()==="Exécuter").focus()');
  await key('Enter');await wait('document.querySelector("[data-result-announcement]").textContent.includes("Action de test effectuée")');await delay(2000);
  check('PAM-21 execution result reaches one atomic live region without a focus redirect',await evaluate('document.querySelectorAll("[data-result-announcement]").length===1 && document.querySelector("[data-result-announcement]").getAttribute("aria-atomic")==="true" && !document.activeElement.closest(".history")?.querySelector("[autofocus]")'));
  await evaluate('window.pamStatusFixture.fail=true');await fill('.text-request input','Erreur PAM-21');await key('Enter');
  await wait('document.querySelector("[data-error-announcement]").textContent.includes("invalid_request")');await delay(2000);
  check('PAM-21 recoverable error reaches the persistent alert',await evaluate('document.querySelector("[data-error-announcement]").getAttribute("role")==="alert" && document.querySelector(".voice-card").textContent.includes("ÉCHEC RÉCUPÉRABLE")'));
  await evaluate('window.pamStatusFixture.fail=false');await enter('nav button:nth-of-type(3)');
  await evaluate('window.pamStatusFixture.hold=true');await enter('[aria-label="Exécuter automatiquement"]');
  check('PAM-21 preference save announces a profile update, never vocal processing',await evaluate('document.querySelector(".request-status").textContent.includes("profil") && !document.querySelector(".request-status").textContent.includes("Transcription")'));
  await evaluate('window.pamStatusFixture.release();window.pamStatusFixture.hold=false;window.pamStatusFixture.phase="recovering"');
  await wait('document.querySelector(".runtime-pill").textContent.includes("reprise")');
  check('PAM-21 preferences use the same unavailable runtime description',await evaluate('![...document.querySelectorAll(".settings-card")].at(-1).textContent.includes("Moteurs disponibles")'));
  await evaluate('window.pamStatusFixture.phase="ready"');await wait('document.querySelector(".runtime-pill").textContent.includes("disponibles")');
  if (process.env.PAM_NVDA_SPEECH_LOG) {
    await delay(2000);
    const speech=(await readFile(process.env.PAM_NVDA_SPEECH_LOG,'utf8')).trim().split('\n').slice(nvdaOffset).map(JSON.parse).filter(e=>e.event==='speech').map(e=>e.text);
    for(const [label,phrase] of [['proposition','Proposition à valider.'],['résultat','Action de test effectuée.'],['erreur','invalid_request']]) {
      check(`PAM-21 NVDA announces ${label} exactly once`,speech.filter(text=>text.includes(phrase)).length===1);
    }
    check('PAM-21 NVDA receives runtime recovery and processing stages',speech.some(t=>t.includes('Moteurs en reprise')) && speech.some(t=>t.includes('Préparation de la demande')) && speech.some(t=>t.includes('Exécution de la demande')));
  }
  }
  if (!process.argv.includes('--first-use-only') && !process.argv.includes('--guided-only') && !process.argv.includes('--navigation-only') && !process.argv.includes('--status-only')) {
    await cdp('Page.navigate', {url:`${url}?proposals`});
    await wait('!!window.pamProposalFixture && !!document.querySelector(".deezer-controls") && [...document.querySelectorAll(".deezer-controls button")].some(b=>b.textContent.trim()==="Démarrer Flow" && !b.disabled)');
    await evaluate('window.pamProposalFixture.flow=()=>[...document.querySelectorAll(".deezer-controls button")].find(b=>b.textContent.trim()==="Démarrer Flow")');
    for(const mode of ['complete','partial','unknown','expired']) {
      await evaluate(`window.pamProposalFixture.mode=${JSON.stringify(mode)};window.pamProposalFixture.flow().focus()`);await key('Enter');
      await wait('document.activeElement.matches(".media-controls .turn-card")');
      check(`PAM-22 ${mode}: Flow reveals and focuses the nearby card`,await evaluate('document.querySelectorAll(".media-controls .turn-card").length===1 && ![...document.querySelectorAll(".history .turn-card")].some(p=>p.dataset.turnId===document.activeElement.dataset.turnId)'));
      check(`PAM-22 ${mode}: card is inside the viewport`,await evaluate('(()=>{const r=document.activeElement.getBoundingClientRect();return r.top>=0 && r.top<innerHeight && r.bottom>0})()'));
      const ax=await cdp('Accessibility.getFullAXTree');check(`PAM-22 ${mode}: accessible named article`,ax.nodes.some(n=>!n.ignored&&n.role?.value==='article'&&n.name?.value.includes('À valider : Flow Fixture')));
      if(mode==='expired') {
        await wait('document.querySelector(".media-controls .turn-card").textContent.includes("expirée")');
        check('PAM-22 expired: Execute is removed',await evaluate('!document.querySelector(".media-controls .approval")'));continue;
      }
      await key('Tab');check(`PAM-22 ${mode}: first Tab reaches Execute`,await evaluate('document.activeElement.textContent.trim()==="Exécuter"'));
      await key('Enter');await wait('!!document.querySelector(".media-controls .plan-results")');
      check(`PAM-22 ${mode}: terminal result has no replay`,await evaluate('!document.querySelector(".media-controls .approval")'));
      if(mode==='complete')check('PAM-22 accepted Flow never claims observed playback',await evaluate('document.querySelector(".media-controls .turn-card").textContent.includes("Commande acceptée") && document.querySelector(".media-controls .turn-card").textContent.includes("Effet non observé") && !document.querySelector("[data-result-announcement]").textContent.includes("Effectuée")'));
      if(mode==='partial')check('PAM-22 partial: every step and no blind retry',await evaluate('document.querySelectorAll(".media-controls .plan-results > li").length===3 && document.querySelector(".media-controls .turn-card").textContent.includes("ne peut pas être relancé")'));
      if(mode==='unknown')check('PAM-22 unknown: issued command remains uncertain',await evaluate('document.querySelector(".media-controls .plan-results").textContent.includes("Commande émise · issue inconnue")'));
    }
  }
  if (!process.argv.includes('--first-use-only') && !process.argv.includes('--guided-only') && !process.argv.includes('--status-only') && !process.argv.includes('--proposals-only'))
    await navigationChecks({ cdp, url, evaluate, wait, active, key, go, enter, fill, check, delay });
  if (process.argv.includes('--guided-only')) await guidedInputChecks({ cdp, url, evaluate, wait, key, enter, fill, check });
  if (process.argv.includes('--first-use-only')) await firstUseChecks({ cdp, url, evaluate, wait, key, enter, fill, check, delay, denied: process.argv.includes('--microphone-denied') });
  if(process.argv.length===2)await componentJourneyChecks({cdp,url,evaluate,wait,key,enter,fill,check,active});
  assert.equal(report.exceptions.length,0,'No unhandled WebView2 exceptions');
  report.runtime=await evaluate('navigator.userAgent');report.outcome='passed';
  console.log(JSON.stringify({ runtime: await evaluate('navigator.userAgent'), checks: results.length, results }, null, 2));
} catch(error) {
  report.outcome='failed';report.error=error.stack||String(error);
  if(evaluatePage)try{await writeFile(join(reportDirectory,'failure-dom.html'),await evaluatePage('document.documentElement.outerHTML'));}catch{}
  if(cdpPage)try{const shot=await cdpPage('Page.captureScreenshot');await writeFile(join(reportDirectory,'failure.png'),Buffer.from(shot.data,'base64'));}catch{}
  throw error;
} finally {
  const cleanupErrors=[];
  if(evaluatePage)try{report.cleanup.audioBefore=await evaluatePage('window.pamTestResources && ({tracks:window.pamTestResources.tracks.length,contexts:window.pamTestResources.contexts.length})');}catch{}
  if(evaluatePage)try{report.cleanup.audio=await evaluatePage('window.pamTestResources?.dispose()');}catch(error){cleanupErrors.push('Audio cleanup: '+error.message);}
  socket?.close();
  if(child?.pid&&child.exitCode===null&&child.signalCode===null){
    const killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
    await new Promise(done=>{killer.once('exit',done);killer.once('error',done);});
    for(let i=0;i<60&&child.exitCode===null&&child.signalCode===null;i++)await delay(50);
  }
  report.cleanup.hostExited=!child||!!spawnError||child.exitCode!==null||child.signalCode!==null;
  if(!report.cleanup.hostExited)cleanupErrors.push('Disposable host still running');
  try{await server.close();report.cleanup.serverClosed=true;}catch(error){cleanupErrors.push(error.message);}
  // WebView2 descendants may release their profile handles slightly later.
  assert.ok(dirname(resolve(profile)) === resolve(tmpdir()) && basename(profile).startsWith('pam-modal-'), 'Cleanup target must be this disposable profile.');
  try{await rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });try{await access(profile);cleanupErrors.push('Profile still exists');}catch(error){if(error.code!=='ENOENT')throw error;}report.cleanup.profileRemoved=true;}catch(error){cleanupErrors.push(error.message);}
  if(report.cleanup.audio&&(report.cleanup.audio.liveTracks||report.cleanup.audio.openContexts))cleanupErrors.push('Audio resources remain active');
  report.cleanup.errors=cleanupErrors;
  if(cleanupErrors.length)report.outcome='failed';
  await writeFile(join(reportDirectory,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log('WebView2 diagnostics: '+join(reportDirectory,'report.json'));
  assert.deepEqual(cleanupErrors,[],'Disposable runner cleanup');
}
