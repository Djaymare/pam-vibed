import type { Application, CommandAlias, Config } from './types';

export type DeletionKind = 'application' | 'formulation';
export interface DeletionScope {
  kind: DeletionKind;
  id: string;
  application: Application;
  aliases: CommandAlias[];
}
export function deletionScope(config: Config, kind: DeletionKind, id: string): DeletionScope {
  const aliases = config.commandAliases || [];
  const alias = aliases.find((item) => item.id === id);
  const application = config.applications.find(
    (item) => item.id === (kind === 'application' ? id : alias?.applicationId),
  );
  if (!application || (kind === 'formulation' && !alias))
    throw new Error('Élément déjà supprimé. Actualisez le profil.');
  return JSON.parse(
    JSON.stringify({
      kind,
      id,
      application,
      aliases:
        kind === 'application' ? aliases.filter((item) => item.applicationId === id) : [alias],
    }),
  );
}
// Stable across the Rust bridge's field order and JSON serialization in Node.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export async function deletionFingerprint(scope: DeletionScope) {
  const bytes = new TextEncoder().encode(canonical(scope));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
