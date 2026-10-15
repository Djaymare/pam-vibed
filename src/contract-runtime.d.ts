import type { Method, Methods } from './contracts.generated';
export function validatePayload<M extends Method>(method: M, payload: unknown): payload is Methods[M]['payload'];
export function validateResult<M extends Method>(method: M, result: unknown): result is Methods[M]['result'];
export function matches(value: unknown, schema: unknown): boolean;
export function validReference(value: unknown): boolean;
