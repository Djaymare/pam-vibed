import catalog from '../sidecar/error-catalog.json';
import type { PamError } from './contracts.generated';
export type { PamError } from './contracts.generated';
export function microphoneCode(
  caught: unknown,
): 'microphone_denied' | 'microphone_missing' | undefined {
  if (caught instanceof DOMException && caught.name === 'NotAllowedError')
    return 'microphone_denied';
  if (caught instanceof DOMException && caught.name === 'NotFoundError')
    return 'microphone_missing';
}
export function describeError(caught: unknown): string {
  if (caught instanceof DOMException) {
    if (caught.name === 'NotReadableError')
      return 'Le microphone est occupé ou indisponible. Fermez l’autre capture, vérifiez son branchement puis testez-le.';
    if (caught.name === 'OverconstrainedError')
      return 'Le microphone choisi n’est plus disponible. Actualisez les entrées, choisissez-en une autre puis testez-la.';
    if (caught.name === 'AbortError')
      return 'L’accès au microphone a été interrompu. Vérifiez le branchement puis relancez son test.';
  }
  const mic = microphoneCode(caught);
  if (mic) return catalog[mic].message;
  if (
    caught &&
    typeof caught === 'object' &&
    'code' in caught &&
    typeof caught.code === 'string' &&
    Object.prototype.hasOwnProperty.call(catalog, caught.code)
  ) {
    const error = caught as PamError,
      definition = catalog[error.code as keyof typeof catalog];
    const reference =
      typeof error.requestId === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(error.requestId)
        ? ` · référence ${error.requestId}`
        : '';
    const stage = [
      'inference',
      'transcription',
      'microphone',
      'target',
      'transport',
      'queue',
      'profile',
      'validation',
      'sidecar',
      'diagnostics',
      'start',
      'write',
      'response',
      'host',
    ].includes(error.stage)
      ? error.stage
      : definition.stage;
    return `${definition.message} (${error.code} · ${stage}${reference})`;
  }
  const message =
    caught instanceof Error
      ? caught.message
      : typeof caught === 'string'
        ? caught
        : 'Une erreur locale est survenue. Réessayez.';
  return message.replace(
    /(?:[a-zA-Z]:[\\/]|\\\\)[^\r\n"<>]+|\/(?:home|Users|tmp|var)\/[^\r\n"<>]+/g,
    '[chemin masqué]',
  );
}
