// Windows DOM/AX/keyboard with real Vue, services simulated by modal-native.js.
export async function componentJourneyChecks({cdp,url,evaluate,wait,key,enter,fill,check,active}) {
  await cdp('Page.navigate',{url:`${url}?journeys`});
  await wait('!!window.pamJourneyFixture && !document.querySelector(".mic-button")?.disabled');
  await fill('.text-request input','Demande après navigation');
  await evaluate('window.pamJourneyFixture.hold=true');
  await enter('.send-button');
  await wait('window.pamJourneyFixture.calls.some(c=>c.method==="process_text")');
  await evaluate('document.querySelector(".text-request").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}))');
  check('PAM-32 pending request disables submission and direct duplicate sends once',await evaluate('document.querySelector(".send-button").disabled && window.pamJourneyFixture.calls.filter(c=>c.method==="process_text").length===1'));
  await enter('nav button:nth-of-type(2)');
  await wait('document.querySelector("nav button:nth-of-type(2)").getAttribute("aria-current")==="page"');
  check('PAM-32 pending navigation focuses the visible heading',await active('.page-intro h1'));
  await evaluate('window.pamJourneyFixture.release();window.pamJourneyFixture.hold=false');
  await enter('nav button:nth-of-type(1)');
  await wait('!document.querySelector(".send-button").disabled');
  check('PAM-32 late request cannot create an obsolete proposal or erase the draft',await evaluate('document.querySelectorAll(".history .turn-card").length===0 && document.querySelector(".text-request input").value==="Demande après navigation"'));
  await evaluate('window.pamJourneyFixture.mode="timeout"');await enter('.send-button');
  await wait('document.querySelector("[data-error-announcement]").textContent.includes("request_timeout")');
  check('PAM-32 typed timeout is accessible and leaves submission recoverable',await evaluate('document.querySelector("[data-error-announcement]").getAttribute("role")==="alert" && !document.querySelector(".send-button").disabled'));
  await evaluate('window.pamJourneyFixture.mode="success"');await enter('.send-button');
  await wait('document.querySelectorAll(".history .turn-card").length===1');
  check('PAM-32 explicit retry creates exactly one proposal after timeout',await evaluate('window.pamJourneyFixture.calls.filter(c=>c.method==="process_text").length===3'));
  await enter('.turn-correction button');await wait('!!document.querySelector("#correction-title")');
  check('PAM-32 correction starts in its text field',await active('textarea[data-dialog-initial-focus]'));
  for(const modifiers of [0,8])for(let i=0;i<10;i++){await key('Tab',modifiers);check('PAM-32 correction keyboard remains in the dialog',await evaluate('document.querySelector("dialog[open]").contains(document.activeElement)'));}
  const tree=await cdp('Accessibility.getFullAXTree');
  check('PAM-32 correction exposes a named dialog in Windows accessibility',tree.nodes.some(n=>!n.ignored&&n.role?.value==='dialog'&&n.name?.value));
  await key('Escape');await wait('!document.querySelector("dialog[open]")');
  check('PAM-32 correction cancel restores its trigger',await active('.turn-correction button'));
}
