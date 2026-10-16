import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/** Runs in the real disposable WebView2 host through the shared keyboard driver. */
export async function navigationChecks({ cdp, url, evaluate, wait, active, key, go, enter, fill, check, delay }) {
  const speechFile = process.env.PAM_NVDA_SPEECH_LOG;
  if (speechFile) await delay(15000); // Allow the OS test driver to foreground this host.
  const offset = speechFile ? (await readFile(speechFile, 'utf8')).trim().split('\n').length : 0;
  await cdp('Page.navigate', { url });
  await wait('!!document.querySelector(".page-intro") && !document.querySelector(".mic-button").disabled');
  await cdp('Page.bringToFront');
  if (speechFile) await delay(5000);
  await key('Tab');
  check('PAM-23 skip link is the first keyboard stop', await active('.skip-link'));
  await key('Enter');
  check('PAM-23 skip link focuses the visible level-one heading', await active('.page-intro h1'));
  await enter('nav button:nth-of-type(2)');
  check('PAM-23 changing view focuses its heading', await active('.page-intro h1'));
  check('PAM-23 exactly one current navigation item', await evaluate('document.querySelectorAll("nav [aria-current=page]").length===1 && document.querySelector("nav [aria-current=page]").textContent.includes("Applications")'));
  check('PAM-23 application names follow the page heading without skipping a level', await evaluate('[...document.querySelectorAll(".application-body h2")].length>0 && !document.querySelector(".application-body h3")'));
  await go('nav [aria-current=page]'); await delay(1200);
  await enter('.page-intro button.primary');
  await wait('!!document.querySelector(".discovery-item")');
  check('PAM-23 view focus never steals focus from the picker', await active('input[type=search]'));
  await enter('.discovery-footer button');
  await wait('!!document.querySelector("#editor-title")');
  const associations = async () => {
    const issues = await evaluate(`(() => {
      const issues=[], ids=[...document.querySelectorAll('[id]')].map(e=>e.id);
      if(ids.length!==new Set(ids).size) issues.push('duplicate id');
      for(const el of document.querySelectorAll('input,textarea,select')) {
        if(!el.id) issues.push('missing id');
        if(!el.labels?.length && !el.getAttribute('aria-label')) issues.push('missing label '+el.id);
        for(const id of (el.getAttribute('aria-describedby')||'').split(/\\s+/).filter(Boolean))
          if(!document.getElementById(id)) issues.push('missing description '+id);
        for(const help of el.closest('label')?.querySelectorAll('small')||[])
          if(!(el.getAttribute('aria-describedby')||'').split(' ').includes(help.id)) issues.push('unlinked help '+el.id);
      }
      return issues;
    })()`);
    assert.deepEqual(issues, []);
  };
  await associations(); check('PAM-23 editor IDs, labels and helps resolve uniquely', true);
  check('PAM-23 Browse is outside the executable label', await evaluate('!document.querySelector(".path-field button").closest("label") && document.querySelector(".path-field input").labels.length===1'));
  await enter('.modal-footer button.primary');
  check('PAM-23 required error belongs only to its field', await evaluate('document.querySelector("input[data-dialog-initial-focus]").getAttribute("aria-invalid")==="true" && document.querySelector(".path-field input").getAttribute("aria-describedby").includes("-error")'));
  await fill('input[data-dialog-initial-focus]', 'Navigation test');
  await fill('textarea[required]', 'Application jetable');
  await go('textarea[required]'); await delay(1000);
  await fill('.path-field input', 'C:\\fixture.exe');
  await enter('.advanced summary');
  await fill('.code-input', 'broken');
  await enter('.modal-footer button.primary');
  check('PAM-23 malformed JSON is linked only to the arguments field', await evaluate('document.querySelector(".code-input").getAttribute("aria-invalid")==="true" && document.querySelector("input[data-dialog-initial-focus]").getAttribute("aria-invalid")==="false" && document.querySelector(".code-input").getAttribute("aria-describedby").includes(document.querySelector(".code-input").id+"-error")'));
  await go('.code-input'); await delay(1500);
  await fill('.code-input', '[]'); await key('Tab');
  check('PAM-23 fixing JSON clears stale invalid state and field error', await evaluate('document.querySelector(".code-input").getAttribute("aria-invalid")==="false" && document.getElementById(document.querySelector(".code-input").id+"-error").hidden'));
  await enter('.modal-footer button.primary');
  await wait('!!document.querySelector("#application-form-error")');
  check('PAM-23 storage failure describes the form without marking every field invalid', await evaluate('document.querySelector("dialog form").getAttribute("aria-describedby")==="application-form-error" && !document.querySelector("dialog [aria-invalid=true]")'));
  await associations();
  await enter('.modal-footer button.primary'); await wait('!document.querySelector("dialog[open]")');
  check('PAM-23 keyboard save returns to a connected trigger', await active('.page-intro button.primary'));
  await enter('nav button:nth-of-type(3)');
  check('PAM-23 settings focus is on visible content', await active('.page-intro h1'));
  await associations(); check('PAM-23 settings and transfer fields have labels and descriptions', true);
  await enter('.command-aliases .section-heading button');
  check('PAM-23 opening an inline form focuses its first field', await active('.alias-phrase input'));
  await associations();
  await enter('.command-alias-editor button[type=button]');
  check('PAM-23 closing an inline form restores its trigger', await active('.command-aliases .section-heading button'));
  await enter('nav button:nth-of-type(1)');
  check('PAM-23 leaving settings retains a connected focus and current page', await evaluate('document.activeElement.isConnected && document.activeElement.matches(".page-intro h1") && document.querySelector("nav [aria-current=page]").getAttribute("aria-label")==="Assistant"'));
  const ax = await cdp('Accessibility.getFullAXTree');
  check('PAM-23 essential icon actions have accessible names', ax.nodes.some(n=>!n.ignored && n.role?.value==='button' && n.name?.value==='Commencer l’enregistrement') && ax.nodes.some(n=>!n.ignored && n.role?.value==='button' && n.name?.value==='Envoyer la demande'));
  check('PAM-23 visible headings do not skip a level', await evaluate('(()=>{let previous=0;return [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter(h=>h.getClientRects().length).every(h=>{const level=Number(h.tagName[1]),ok=level<=previous+1;previous=level;return ok})})()'));
  if (speechFile) {
    await delay(2000);
    const speech = (await readFile(speechFile,'utf8')).trim().split('\n').slice(offset).map(JSON.parse).filter(e=>e.event==='speech').map(e=>e.text).join('\n');
    check('PAM-23 NVDA announces current page', /page (courante|actuelle)|current page/i.test(speech));
    check('PAM-23 NVDA announces field and associated help', speech.includes('Cette description aide Needle') && speech.includes('quoi sert'));
    check('PAM-23 NVDA announces the matching JSON error', speech.includes('tableau JSON de textes'));
  }
  await cdp('Page.navigate', { url: `${url}?proposals` });
  await wait('!!document.querySelector(".deezer-controls")');
  await associations(); check('PAM-23 media and Deezer field associations resolve uniquely', true);
  await fill('.deezer-controls input[inputmode=numeric]', 'bad'); await key('Tab');
  check('PAM-23 Deezer pattern error is attached to the content ID', await evaluate('document.querySelector(".deezer-controls input[inputmode=numeric]").getAttribute("aria-invalid")==="true"'));
  await fill('.text-request input', 'Correction accessible'); await key('Enter');
  await wait('!!document.querySelector(".turn-correction button")');
  await enter('.turn-correction button'); await wait('!!document.querySelector("#correction-title")');
  await associations(); check('PAM-23 correction labels and helpers resolve uniquely', true);
  await evaluate('(()=>{const selects=document.querySelectorAll("dialog select");selects[0].value=selects[0].options[1].value;selects[0].dispatchEvent(new Event("change",{bubbles:true}))})()');
  await wait('document.querySelectorAll("dialog select").length>1');
  await evaluate('(()=>{const s=document.querySelectorAll("dialog select")[1];s.value="deezer_search";s.dispatchEvent(new Event("change",{bubbles:true}))})()');
  await wait('!!document.querySelector(".command-arguments input")');
  await associations(); check('PAM-23 dynamic command fields retain unique labels and linked help', true);
  await go('.command-arguments input');
  check('PAM-23 dynamically added fields remain reachable by keyboard inside the dialog', await active('.command-arguments input'));
}
