import type { Application, MediaSession } from './types';

export function applicationGuidance(
  application: Pick<Application, 'name' | 'media' | 'arguments'>,
  sessions: MediaSession[] = [],
) {
  const name = application.name.trim() || 'cette application';
  const session = sessions.find(
    (item) => item.sourceAppId.toLowerCase() === application.media?.sourceAppId.toLowerCase(),
  );
  const examples = [`Ouvre ${name}`];
  let description = `Ouvrir ${name}.`;
  let limit =
    'PAM ouvre cette application. Il ne pilote pas ses boutons ni ses fonctions internes.';
  if (application.media?.deezer) {
    description = `Ouvrir ${name}, afficher une recherche ou un contenu Deezer et demander Flow.`;
    examples.push(`Lance Flow sur ${name}`);
    limit =
      'Les liens Deezer transmettent une demande : PAM ne peut pas garantir le démarrage de la lecture. Les commandes du lecteur dépendent de sa disponibilité.';
  } else if (application.media) {
    description = `Ouvrir ${name} et demander les commandes de lecture prises en charge par son lecteur Windows.`;
    if (session?.capabilities?.pause) examples.push(`Mets ${name} en pause`);
    limit = session
      ? 'Seules les commandes annoncées par le lecteur sont disponibles ; elles sont revérifiées avant chaque action.'
      : 'Ouvrez le lecteur et lancez un média pour rendre ses commandes disponibles. L’ouverture de l’application reste possible.';
  }
  if (application.arguments.some((arg) => arg.includes('{input}')))
    limit +=
      ' Les textes, fichiers ou liens sont transmis uniquement par les arguments configurés.';
  return { description, examples, limit };
}

export const launchIdentity = (application: Application) =>
  JSON.stringify([
    application.id,
    application.executable,
    application.arguments,
    application.windowsApp?.appId,
  ]);
