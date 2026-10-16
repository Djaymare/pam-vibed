import { readFileSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parse, compileScript } from '@vue/compiler-sfc';
import ts from 'typescript';
import * as vue from 'vue';
export const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a; reject=b;}); return {promise,resolve,reject}; };
export const settle = async () => { for(let i=0;i<15;i++){await Promise.resolve(); await vue.nextTick();} };
export const config = (name='Initial') => ({version:2, applications:[{id:'fixture', name, enabled:true, executable:'fixture.exe', arguments:[],aliases:[],description:'Fixture'}],commandAliases:[],language:'fr',autoExecute:true,confidenceThreshold:0.7});
export const status = (name='Initial') => ({ready:true,config:config(name),proposals:[],checks:[],engine:null});
export const turn = (id='turn') => ({id, transcript:'Fixture',status:'pending',proposal:{state:'pending',createdAt:Date.now(),expiresAt:Date.now()+600000,reason:null},calls:[],results:[],durationMs:0,confidence:null,reasoning:''});
export function harness(t, options={}) {
  for (const name of ['document','Document','ShadowRoot']) {
    const previous=globalThis[name];globalThis[name]=name==='document'?{activeElement:null,visibilityState:'visible',hasFocus:()=>true}:class{};
    t.after(()=>{if(previous===undefined)delete globalThis[name];else globalThis[name]=previous;});
  }
  const calls=[], timers=new Map(), events=new Map(), errors=[];
  let sequence=0, disposed=0, starts=0, finishes=0;
  const window={setInterval(fn,ms){const id=++sequence;timers.set(id,{fn,ms});return id;},clearInterval(id){timers.delete(id);},setTimeout(fn,ms){const id=++sequence;timers.set(id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);}};
  const domEvents=new Map();
  for(const [target,prefix] of [[window,'window'],[globalThis.document,'document']]) {
    target.addEventListener=(name,fn)=>{const key=prefix+':'+name;const group=domEvents.get(key)||new Set();group.add(fn);domEvents.set(key,group);};
    target.removeEventListener=(name,fn)=>{const key=prefix+':'+name;const group=domEvents.get(key);group?.delete(fn);if(!group?.size)domEvents.delete(key);};
  }
  const request=async(method,payload={})=>{
    calls.push({method,payload});
    if(options.request) {const result=options.request(method,payload);if(result!==undefined)return result;}
    if(method==='supervisor_status')return {phase:'ready',activity:'idle'};
    if(method==='status')return status();
    if(method==='media_sessions'||method==='discover_applications')return [];
    if(method==='desktop_action')return undefined;
    throw Error('Unexpected method '+method);
  };
  const require=createRequire(import.meta.url), cache=new Map();
  function load(file) {
    file=resolve(file);
    if(cache.has(file))return cache.get(file);
    if(extname(file)==='.json')return JSON.parse(readFileSync(file,'utf8'));
    const source=readFileSync(file,'utf8');
    const content=extname(file)==='.vue'?compileScript(parse(source).descriptor,{id:file,inlineTemplate:true,templateOptions:{compilerOptions:{hoistStatic:false}}}).content:source;
    const code=ts.transpileModule(content,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
    const out={};cache.set(file,out);
    function injected(name) {
      if(name==='vue')return vue;
      if(name.endsWith('/ipc'))return {request,desktopAction:action=>request('desktop_action',{action})};
      if(name==='@tauri-apps/api/core')return {isTauri:()=>true};
      if(name==='@tauri-apps/api/event')return {listen:async(event,fn)=>{
        if(options.listen)await options.listen(event,fn);
        events.set(event,fn); let active=true;
        return ()=>{if(active){active=false;events.delete(event);}};
      }};
      if(name==='@tauri-apps/plugin-dialog')return {open:()=>options.open?.()};
      if(name.endsWith('/audio/recorder'))return {VoiceRecorder:class{
        async start(level,limit,captureOptions){starts++;this.limit=limit;this.level=level;options.audioStart?.({level,limit,options:captureOptions});await options.permission?.();}
        async finish(){finishes++;return options.finish?options.finish():new Uint8Array([1,2]);}
        async dispose(){disposed++;}
      }};
      if(name.endsWith('.vue') && !options.components)return {__esModule:true,default:vue.defineComponent({render:()=>vue.h('span')})};
      if(name.startsWith('.')) {let path=resolve(dirname(file),name);if(!['.ts','.js','.vue','.json'].includes(extname(path)))path+='.ts';return load(path);}
      return require(name);
    }
    new Function('require','exports','window','HTMLElement',code)(injected,out,window,class{});
    return out;
  }
  const rootPath=fileURLToPath(new URL('../../src/',import.meta.url));
  const feature=name=>load(resolve(rootPath,name));
  const node=(type,text='')=>({type,tagName:type.toUpperCase(),text,children:[],props:{},parent:null,
    addEventListener(){},removeEventListener(){},getRootNode(){return globalThis.document;},
    get options(){return this.children.filter(n=>n.type==='option');}});
  const renderer=vue.createRenderer({
    createElement:type=>node(type),createText:text=>node('#text',text),createComment:text=>node('#comment',text),
    setText:(n,text)=>n.text=text,setElementText:(n,text)=>{n.text=text;n.children=[];},
    parentNode:n=>n.parent,nextSibling:n=>n.parent?.children[n.parent.children.indexOf(n)+1]??null,
    patchProp:(n,key,_old,value)=>n.props[key]=value,
    insert(n,parent,anchor){if(n.parent)n.parent.children.splice(n.parent.children.indexOf(n),1);n.parent=parent;const i=parent.children.indexOf(anchor);parent.children.splice(i<0?parent.children.length:i,0,n);},
    remove(n){n.parent.children.splice(n.parent.children.indexOf(n),1);n.parent=null;},
  });
  let app, value, mounted=false;
  function mount(setup) {
    const root=node('root');
    app=renderer.createApp({setup(){value=setup(feature,vue);return typeof value==='function'?value:()=>null;}});
    app.config.errorHandler=error=>errors.push(error);
    app.mount(root);mounted=true;
    t.after(unmount);
    return {root,get value(){return value;}};
  }
  function unmount(){if(mounted){mounted=false;app.unmount();}}
  return {calls,timers,events,errors,request,feature,mount,unmount,window,document:globalThis.document,domEvents,dispatch:(name,target='window')=>{for(const fn of domEvents.get(target+':'+name)||[])fn();},get resources(){return {disposed,starts,finishes};}};
}
