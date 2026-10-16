import { deezerContent, validActionField } from './actions';

/** Only content pages are converted. No network access, redirects, or playback. */
export function parseDeezerLink(text: string): { kind: string; id: string } {
  const value = text.trim();
  const match =
    /^https:\/\/(?:www\.)?deezer\.com\/(?:(?:[a-z]{2}(?:-[a-z]{2})?)\/)?([a-z]+)\/([1-9][0-9]{0,18})\/?(?:\?([^#\s]*))?$/.exec(
      value,
    );
  if (!match || value.length > 2048 || /[\x00-\x20\x7f]/.test(value))
    throw new Error(
      'Collez un lien HTTPS de deezer.com ou www.deezer.com vers un contenu, par exemple https://www.deezer.com/fr/track/3135556.',
    );
  const [, kind, id, query] = match;
  if (
    !Object.prototype.hasOwnProperty.call(deezerContent, kind) ||
    !validActionField('deezer_content', 'id', id)
  )
    throw new Error('Type de contenu ou identifiant Deezer non autorisé.');
  if (query !== undefined) {
    const allowed = new Set([
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_content',
      'utm_term',
      'deferredFl',
    ]);
    if (
      !query ||
      [...new URLSearchParams(query)].some(
        ([key, item]) => !allowed.has(key) || /[\x00-\x1f\x7f]/.test(item),
      )
    )
      throw new Error(
        'Ce lien contient des paramètres non prévus. Copiez le lien direct du contenu Deezer.',
      );
  }
  return { kind, id };
}
