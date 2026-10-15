import { request } from '../../src/ipc';
export function checkTypedCalls() {
  void request('confirm', { id: 'fixture' });
  void request('settings', { language: 'fr', autoExecute: false, confidenceThreshold: 0.7 });
  // @ts-expect-error Unknown method names cannot enter the client.
  void request('unknown_method', {});
  // @ts-expect-error A confirmation is identified by id, not text.
  void request('confirm', { text: 'wrong payload' });
  // @ts-expect-error Native actions use the same closed contract.
  void request('desktop_action', { action: 'execute_shell' });
  // @ts-expect-error Each method retains its result type.
  const wrong: Promise<string> = request('status');
  return wrong;
}
