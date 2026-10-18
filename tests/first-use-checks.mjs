import {writeFile} from 'node:fs/promises';
export async function firstUseChecks({cdp,url,evaluate,wait,key,enter,fill,check,delay,denied}) {
  await cdp('Page.navigate',{url:`${url}?first-use`});
  await wait('!!window.pamFirstUseFixture && !!document.querySelector(".first-use") && !!document.querySelector(".shortcut-settings")');
  // The safety note now names Needle's score explicitly (PAM-29). Keep the
  // plain-language assertion on the three actionable steps, not that note.
  check('PAM-26 empty profile shows the three plain-language steps',await evaluate('window.pamFirstUseFixture.config.applications.length===0 && document.querySelector(".first-use ol").children.length===3 && !/Whistle|Needle|GSMTC|JSON/.test(document.querySelector(".first-use ol").innerText)'));
  await enter('.shortcut-settings select');
  await key('ArrowDown');await key('Tab');
  await enter('.shortcut-settings .secondary');
  await wait('!document.querySelector(".content > .shortcut-settings")');
  check('PAM-26 occupied shortcut can be replaced without blocking empty-profile startup',await evaluate('document.querySelector(".desktop-toolbar").textContent.includes("Ctrl + Alt + Espace") && window.pamFirstUseFixture.config.applications.length===0 && document.activeElement.matches(".page-intro h1")'));
  await enter('.first-use li:first-child > button');await wait('!!document.querySelector(".discovery-item")');
  await enter('.discovery-item');await wait('!!document.querySelector("#editor-title")');
  check('PAM-26 chosen app has a modest description and optional technical fields stay closed',await evaluate('document.querySelector("textarea[required]").value==="Ouvrir Détectée." && !document.querySelector(".application-options").open && !/Whistle|Needle|GSMTC|JSON/.test(document.querySelector("dialog").innerText)'));
  await enter('.launch-test button');await wait('!!document.querySelector(".launch-test + .notice")');
  check('PAM-26 keyboard launch test reports an explicit result before saving',await evaluate('document.querySelector(".launch-test + .notice").textContent.includes("Ouverture de test demandée")'));
  await enter('.modal-footer .primary');await wait('!document.querySelector("dialog[open]") && !!document.querySelector("#first-use-application")');
  await enter('.first-use li:nth-child(2) button');await wait('!document.querySelector(".first-use li:nth-child(3) button").disabled');
  if(process.env.PAM_MODAL_SCREENSHOT)await writeFile(process.env.PAM_MODAL_SCREENSHOT,Buffer.from((await cdp('Page.captureScreenshot')).data,'base64'));
  // Auto-grant the synthetic browser device in this disposable profile. Real
  // microphone permissions and hardware belong to test-microphone.mjs.
  if (!denied) {
    await enter('.microphone-panel button');await wait('window.pamFirstUseFixture.tracks.length>0');await delay(5500);
    check('PAM-26 synthetic microphone test runs locally and stops every track',await evaluate('window.pamFirstUseFixture.tracks.every(t=>t.readyState==="ended") && /[Mm]icrophone coupé/.test(document.querySelector("#microphone-message").textContent)'));
  } else {
  await cdp('Browser.setPermission',{permission:{name:'microphone'},setting:'denied',origin:new URL(url).origin});
  await enter('.microphone-panel button');await wait('document.querySelector(".microphone-panel").textContent.includes("refusé")');
  check('PAM-26 denied microphone explains recovery while written input remains accessible',await evaluate('document.querySelector(".microphone-panel").textContent.includes("Windows") && !document.querySelector("#written-request").readOnly'));
  }
  await enter('.first-use li:nth-child(3) button');
  check('PAM-26 example focuses the written request without dispatching an effect',await evaluate('document.activeElement.id==="written-request" && document.activeElement.value==="Ouvre Détectée" && !window.pamFirstUseFixture.calls.some(c=>c.method==="process_text")'));
  await key('Enter');await wait('!!document.querySelector(".approval .primary")');
  check('PAM-26 first phrase identifies the app and the action before confirmation',await evaluate('document.querySelector(".plan-steps").textContent.includes("Détectée") && document.querySelector(".approval").textContent.includes("Vérifiez")'));
  await enter('.approval .primary');await wait('!!document.querySelector(".plan-results")');
  check('PAM-26 first simulated action completes and retires the guide',await evaluate('document.querySelector(".plan-results").textContent.includes("Action simulée effectuée") && !document.querySelector(".first-use")'));
  await cdp('Page.navigate',{url:`${url}?first-use`});await wait('!!window.pamFirstUseFixture && !!document.querySelector(".first-use")');
  check('PAM-26 profile and replacement shortcut survive a fresh page',await evaluate('window.pamFirstUseFixture.config.applications[0].name==="Détectée" && window.pamFirstUseFixture.shortcut==="ctrl_alt_space" && !document.querySelector(".content > .shortcut-settings")'));
  await evaluate('window.pamFirstUseFixture.available=false');
  // Poll via the user refresh entrypoint, retaining the configured app.
  await enter('nav button:nth-of-type(2)');await enter('nav button:nth-of-type(1)');
  await delay(15500);await wait('document.querySelector(".first-use").textContent.includes("indisponible")');
  check('PAM-26 unavailable app offers repair and disable without losing phrases',await evaluate('document.querySelector(".first-use").textContent.includes("Réparer ou modifier Détectée") && document.querySelector(".first-use").textContent.includes("Désactiver Détectée") && document.querySelector(".first-use li:nth-child(2) button").disabled'));
  await enter('.first-use li:first-child .notice button:nth-of-type(2)');await wait('!window.pamFirstUseFixture.config.applications[0].enabled');
  check('PAM-26 disabling unavailable app keeps the existing identity and description',await evaluate('window.pamFirstUseFixture.config.applications.length===1 && window.pamFirstUseFixture.config.applications[0].description==="Ouvrir Détectée."'));
}
