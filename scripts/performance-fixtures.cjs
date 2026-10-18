const { DEFAULT_CONFIG } = require('../sidecar/config-schema.cjs');
function profile(count, kind = 'plain') {
  return {
    ...structuredClone(DEFAULT_CONFIG),
    applications: Array.from({ length: count }, (_, i) => ({
      id: `${(i + 1).toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`,
      name: i === 0 ? 'Bloc-notes' : `Atelier ${i + 1}`,
      aliases:
        kind === 'rich'
          ? Array.from({ length: 6 }, (_, j) => `Atelier synthétique ${i + 1} alias ${j + 1}`)
          : [],
      description:
        kind === 'rich'
          ? 'Application synthétique de benchmark pour gérer des notes, lire des documents et préparer des fichiers de démonstration. '
              .repeat(2)
              .slice(0, 240)
          : 'Notes de test.',
      executable: process.execPath,
      arguments: [],
      enabled: true,
      ...(kind === 'rich' ? { media: { sourceAppId: `fixture-${i + 1}.exe`, deezer: false } } : {}),
    })),
  };
}
function sessions(config) {
  return config.applications
    .filter((a) => a.media)
    .map((a) => ({
      sourceAppId: a.media.sourceAppId,
      playbackStatus: 'paused',
      capabilities: {
        play: true,
        pause: true,
        next: true,
        previous: true,
        stop: true,
        toggle: true,
      },
    }));
}
const SYSTEM =
  "locale: fr\nplatform: Windows\nOnly use registered tools. Input values must come from the user's request. A Deezer content or search link only displays a page, never starts a song or adds it next in the queue. Skip next plays the next item already in the queue, never inserts a requested song. Reject requests to play a specific song or queue it next when no tool offers that behavior.\n";
module.exports = { profile, sessions, SYSTEM };
