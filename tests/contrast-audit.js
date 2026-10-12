// Executes in the rendered WebView2 document. WCAG relative luminance uses
// computed foregrounds and composited ancestor backgrounds, never source hexes.
export function auditRendered() {
  const rgba = s => { const n=s.match(/[\d.]+/g)?.map(Number); return n?.length>=3?[...n.slice(0,3),n[3]??1]:[0,0,0,0]; };
  const over = (a,b) => a.slice(0,3).map((v,i)=>v*a[3]+b[i]*(1-a[3]));
  const luminance = a => a.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
  const ratio = (a,b) => (Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
  const background = el => { const chain=[];for(let p=el;p;p=p.parentElement)chain.unshift(p);return chain.reduce((b,p)=>over(rgba(getComputedStyle(p).backgroundColor),b),[255,255,255]); };
  const visible = el => { const s=getComputedStyle(el);return el.getClientRects().length && s.visibility==='visible' && +s.opacity>0 && +s.fontSize.replace('px','')>0 && !el.closest('option,script,style,[hidden]') && !el.closest('details:not([open])')?.contains(el) || el.matches('summary') && el.getClientRects().length; };
  const disabled = el => !!el.closest(':disabled');
  const texts=[], controls=[], icons=[], failures=[];
  const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
  for(let n=walker.nextNode();n;n=walker.nextNode()) {
    const el=n.parentElement,text=n.textContent.trim();if(!text||!visible(el)||disabled(el))continue;
    const s=getComputedStyle(el),bg=background(el);let fg=over(rgba(s.color),bg);
    for(let p=el;p;p=p.parentElement){const opacity=+getComputedStyle(p).opacity;if(opacity<1)fg=over([...fg,opacity],bg);}
    const size=parseFloat(s.fontSize),threshold=size>=24||(size>=18.6667&&+s.fontWeight>=700)?3:4.5;
    const item={text:text.slice(0,100),class:el.className,color:s.color,background:bg,fontSize:size,ratio:ratio(fg,bg),threshold};texts.push(item);
    if(item.ratio<threshold||size<12)failures.push(item);
  }
  for(const el of document.querySelectorAll('input,textarea')) {
    if(!visible(el)||disabled(el)||!el.placeholder||el.value)continue;
    const s=getComputedStyle(el,'::placeholder'),bg=background(el),r=ratio(over(rgba(s.color),bg),bg);
    const item={text:'placeholder: '+el.placeholder,ratio:r,threshold:4.5,fontSize:parseFloat(s.fontSize)};texts.push(item);if(r<4.5)failures.push(item);
  }
  for(const el of document.querySelectorAll('button,input,textarea,select,summary')) {
    if(!visible(el)||disabled(el))continue;
    const r=el.getBoundingClientRect();controls.push({tag:el.tagName,class:el.className,width:r.width,height:r.height,label:el.getAttribute('aria-label')||el.textContent.trim().slice(0,60),left:r.left,right:r.right});
  }
  for(const el of document.querySelectorAll('button:not(:disabled) svg')) {
    if(!el.getClientRects().length||getComputedStyle(el).visibility!=='visible')continue;
    const s=getComputedStyle(el),bg=background(el),r=ratio(over(rgba(s.color),bg),bg);
    const item={text:'control icon: '+el.parentElement.getAttribute('aria-label'),ratio:r,threshold:3};icons.push(item);if(r<3)failures.push(item);
  }
  const el=document.activeElement,s=el?getComputedStyle(el):null;
  // Outlines are offset outside the control, so compare with its surrounding
  // surface (the button fill is not behind those pixels).
  const focus=s?{tag:el.tagName,class:el.className,visible:el.matches(':focus-visible'),outline:s.outlineStyle,width:parseFloat(s.outlineWidth),ratio:ratio(rgba(s.outlineColor),background(el.parentElement)),rect:el.getBoundingClientRect().toJSON()}:null;
  return {texts,controls,icons,failures,focus,viewport:{width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth},forcedColors:matchMedia('(forced-colors:active)').matches};
}
