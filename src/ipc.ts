import { invoke } from '@tauri-apps/api/core';
import { PROTOCOL_VERSION, type Method, type Methods, type DesktopAction } from './contracts.generated';
import { matches, validatePayload, validateResult } from './contract-runtime.js';
let serial = 0;
function invalid() { return new Error('Échange local incompatible. Redémarrez PAM puis réessayez.'); }
export async function request<M extends Method>(method: M, payload: Methods[M]['payload'] = {} as Methods[M]['payload']): Promise<Methods[M]['result']> {
  if (!validatePayload(method,payload)) throw invalid();
  const id=++serial, requestId=crypto.randomUUID();
  let response: unknown;
  try { response = await invoke('assistant_request',{request:{version:PROTOCOL_VERSION,id,requestId,method,payload}}); }
  catch(error) { if(matches(error,'PamError')) throw error; throw invalid(); }
  if (!response || typeof response !== 'object') throw invalid();
  const frame = response as Record<string,unknown>;
  // A late response never reaches a consumer or updates the interface. There is
  // no retry here: a lost result may already have produced an external effect.
  if(frame.version!==PROTOCOL_VERSION || frame.id!==id || frame.requestId!==requestId || frame.method!==method) throw invalid();
  if(frame.ok===false && matches(frame.error,'PamError') && (frame.error as {requestId:string}).requestId===requestId) throw frame.error;
  if(frame.ok!==true || !validateResult(method,frame.result)) throw invalid();
  return frame.result;
}
export type RequestFunction = typeof request;
export async function desktopAction(action: DesktopAction): Promise<void> {
  await request('desktop_action',{action});
}
export async function discoverApplications() {
  return request('discover_applications');
}
