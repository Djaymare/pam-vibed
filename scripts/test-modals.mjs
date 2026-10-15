import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createServer as createNetServer } from 'node:net';

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
const server = await createServer({ configFile: false, root, cacheDir: join(dependencyRoot, 'node_modules/.vite-modal-test'), plugins: [vue()],
  resolve: { alias: [ { find: /^@tauri-apps\/(api\/(core|event)|plugin-dialog)$/, replacement: fixture } ] },
  server: { host: '127.0.0.1', port: 0, fs: { allow: [root, dependencyRoot] } },
});
const portServer = createNetServer();
await new Promise(done => portServer.listen(0, '127.0.0.1', done));
const debugPort = portServer.address().port;
await new Promise(done => portServer.close(done));
const profile = await mkdtemp(join(tmpdir(), 'pam-modal-'));
let child, socket;
const delay = ms => new Promise(done => setTimeout(done, ms));
const results = [];
try {
  await server.listen();
  const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/modal-page.html`;
  child = spawn(host, [], { windowsHide: true, stdio: 'pipe', env: { ...process.env, PAM_MODAL_TEST_URL: `${url}?component`, PAM_MODAL_TEST_PROFILE: profile, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort}` } });
  child.on('error', error => console.error(error));
  child.stderr.on('data', data => process.stderr.write(data));
  let target;
  for (let i = 0; i < 200; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(t => t.type === 'page' && t.url.startsWith(url)); } catch {}
    if (target) break;
    if (child.exitCode !== null) throw Error(`Host exited: ${child.exitCode}`);
    await delay(100);
  }
  assert.ok(target, 'WebView2 debugging target available');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((done, reject) => { socket.onopen = done; socket.onerror = reject; });
  let seq = 0;
  const pending = new Map();
  socket.onmessage = event => { const r = JSON.parse(event.data); if (!r.id) { if (r.method === 'Runtime.exceptionThrown') console.error(JSON.stringify(r.params)); return; } const p = pending.get(r.id); if (!p) return; pending.delete(r.id); clearTimeout(p.timer); r.error ? p.reject(Error(JSON.stringify(r.error))) : p.resolve(r.result); };
  const cdp = (method, params = {}) => new Promise((done, reject) => { const id = ++seq; const timer = setTimeout(() => { pending.delete(id); reject(Error(`Timeout: ${method}`)); }, 10000); pending.set(id, { resolve: done, reject, timer }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
  await cdp('Runtime.enable');
  const wait = async expression => { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await delay(30); } throw Error(`Not ready: ${expression}; DOM=${await evaluate('document.body.innerHTML')}`); };
  const active = selector => evaluate(`document.activeElement?.matches(${JSON.stringify(selector)})`);
  const key = async (name, modifiers = 0) => {
    const codes = { Tab: 9, Enter: 13, Escape: 27, a: 65 };
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
  check('PAM-19 errors are linked to editable fields',await evaluate(`document.querySelector('.alias-phrase input').getAttribute('aria-describedby') === 'command-alias-error' && document.querySelector('[aria-label="Exécuter automatiquement"]').getAttribute('aria-describedby') === 'settings-error'`));
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
  console.log(JSON.stringify({ runtime: await evaluate('navigator.userAgent'), checks: results.length, results }, null, 2));
} finally {
  socket?.close();
  if (child && child.exitCode === null) { child.kill(); await Promise.race([new Promise(done => child.once('exit', done)), delay(3000)]); }
  await server.close();
  // WebView2 descendants may release their profile handles slightly later.
  assert.ok(dirname(resolve(profile)) === resolve(tmpdir()) && basename(profile).startsWith('pam-modal-'), 'Cleanup target must be this disposable profile.');
  await rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
