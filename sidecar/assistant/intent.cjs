// Pure recognition, tool catalogue and plan validation; no filesystem or effects.
const { ensure } = require('./validation.cjs');
const { MEDIA_ACTIONS } = require('../media.cjs');
const { DEEZER_APP_ID, CONTENT, PAGES, validateDeezerArgs } = require('../deezer.cjs');
const { findCommandAlias } = require('../command-aliases.cjs');
const { canonicalPrompt } = require('../needle-tools.cjs');
const { recognizeDeezerCommand, deezerActionLabel } = require('../deezer-commands.cjs');
const { resolveMediaCommand } = require('../media-commands.cjs');
function toolName(application) {
  const readable =
    application.name
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 30) || 'application';
  return `open_${readable}_${application.id.slice(0, 8)}`;
}
function actionToolName(application, action) {
  return action === 'open' ? toolName(application) : `${action}_${toolName(application).slice(5)}`;
}
function labelVariants(label) {
  const normalized = label.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  return [...new Set([normalized, normalized.normalize('NFKD').replace(/\p{M}/gu, '')])];
}
function triggersFor(application, applications) {
  // A trigger constrains the entire Needle turn. Only force an unambiguous,
  // single application invocation; leave compound requests to the model.
  const labels = [
    ...new Set([application.name, ...application.aliases].flatMap(labelVariants)),
  ].filter(
    (label) =>
      !applications.some(
        (other) =>
          other.id !== application.id &&
          [other.name, ...other.aliases].flatMap(labelVariants).includes(label),
      ),
  );
  if (!labels.length) return [];
  const names = labels
    .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'))
    .join('|');
  const polite = "(?:s['’]il\\s+(?:te|vous)\\s+pla[iî]t|please)";
  const prefix =
    '(?:peux[-\\s]tu|pouvez[-\\s]vous|tu\\s+peux|vous\\s+pouvez|je\\s+(?:veux|voudrais|souhaite)|can\\s+you|could\\s+you)';
  const action =
    '(?:ouvre|ouvrez|ouvrir|lance|lancez|lancer|d[eé]marre|d[eé]marrez|d[eé]marrer|open|launch|start)';
  const article = "(?:l['’]|(?:le|la|les|the)\\s+)";
  const app = '(?:(?:application|app)\\s+)';
  const end = `\\s*(?:,?\\s*${polite})?\\s*[.!?]*\\s*$`;
  return [
    `^\\s*(?:${names})${end}`,
    `^\\s*(?:${polite}\\s*,?\\s*)?(?:${prefix}\\s+)?${action}\\s+(?:${article})?(?:${app})?(?:${names})${end}`,
  ];
}
function toolsFor(config, sessions) {
  const applications = config.applications.filter((app) => app.enabled);
  return applications.flatMap((app) => {
    const base = {
      name: toolName(app),
      description: `Ouvrir / lancer ${app.name}. ${app.description}${app.aliases.length ? ` Autres noms de cette même application : ${app.aliases.join(', ')}.` : ''}`,
      triggers: triggersFor(app, applications),
      parameters: {
        type: 'object',
        properties: app.arguments.some((argument) => argument.includes('{input}'))
          ? {
              input: {
                type: 'string',
                description:
                  'Texte, fichier ou URL explicitement demandé à transmettre à cette application.',
                maxLength: 2048,
                default: '',
              },
            }
          : {},
        required: [],
        additionalProperties: false,
      },
    };
    const extra = [];
    const add = (action, description, properties = {}, required = []) =>
      extra.push({
        name: actionToolName(app, action),
        action,
        applicationId: app.id,
        actionLabel: description,
        description: `${description} dans ${app.name}. ${app.aliases.length ? `Autres noms : ${app.aliases.join(', ')}.` : ''}`,
        triggers: mediaTriggers(app, applications, action),
        parameters: { type: 'object', properties, required, additionalProperties: false },
      });
    if (app.media?.sourceAppId) {
      const matching = sessions?.filter(
        (s) => s.sourceAppId?.toLowerCase() === app.media.sourceAppId.toLowerCase(),
      );
      for (const [action, label] of Object.entries(MEDIA_ACTIONS)) {
        if (
          sessions !== undefined &&
          (matching.length !== 1 ||
            matching[0].error ||
            matching[0].capabilities?.[action] !== true)
        )
          continue;
        add(`media_${action}`, label + (action === 'next' ? ' déjà présente dans la file' : ''));
      }
      if (app.media.deezer && app.windowsApp?.appId === DEEZER_APP_ID) {
        add(
          'deezer_content',
          'Afficher un contenu Deezer par identifiant, sans démarrer la lecture ni modifier la file',
          {
            kind: { type: 'string', enum: CONTENT, description: 'Type du contenu.' },
            id: {
              type: 'string',
              pattern: '^[1-9][0-9]{0,18}$',
              description:
                'Identifiant numérique explicitement fourni par l’utilisateur. Ne jamais inventer un identifiant.',
            },
          },
          ['kind', 'id'],
        );
        add(
          'deezer_search',
          'Rechercher une chanson, un artiste ou un contenu Deezer par son nom ; affiche les résultats, sans lancer de lecture',
          {
            query: {
              type: 'string',
              maxLength: 200,
              description: 'Titre, artiste ou recherche explicitement demandé.',
            },
          },
          ['query'],
        );
        add('deezer_page', 'Afficher une page Deezer', { page: { type: 'string', enum: PAGES } }, [
          'page',
        ]);
        add('deezer_reload', 'Recharger Deezer Music');
        add(
          'deezer_start',
          'Démarrer Flow ou les coups de cœur Deezer, sans sélectionner une chanson précise',
          { mix: { type: 'string', enum: ['flow', 'loved_tracks'] } },
          ['mix'],
        );
        add(
          'deezer_smarttracklist',
          'Afficher ou demander la lecture d’une sélection smarttracklist Deezer, dont l’identifiant doit être fourni explicitement',
          {
            id: {
              type: 'string',
              pattern: '^[A-Za-z0-9_-]{1,80}$',
              description:
                'Identifiant de sélection fourni par l’utilisateur, jamais un titre de chanson.',
            },
            mode: { type: 'string', enum: ['display', 'play'] },
          },
          ['id', 'mode'],
        );
      }
    }
    return [{ ...base, action: 'open', applicationId: app.id, actionLabel: 'Ouvrir' }, ...extra];
  });
}
function matchedInvocation(transcript, tools, config, mediaCommand) {
  const alias = findCommandAlias(transcript, config);
  const media = mediaCommand || resolveMediaCommand(transcript, config);
  const known =
    alias ||
    recognizeDeezerCommand(transcript, config) ||
    (media.applicationId && !media.issue ? media : null);
  if (known)
    return tools
      .filter((tool) => tool.applicationId === known.applicationId && tool.action === known.action)
      .map((tool) =>
        tool.action.startsWith('deezer_')
          ? { ...tool, boundArguments: known.arguments || {} }
          : tool,
      );
  return tools.filter(
    (tool) =>
      !tool.action.startsWith('deezer_') &&
      tool.triggers.some((pattern) => new RegExp(pattern, 'i').test(transcript)),
  );
}
function resolveInvocation(transcript, tools, config, mediaCommand) {
  // Text and speech share this resolution. Only rewrite a literal, unambiguous
  // application invocation; keep compound requests and their arguments intact.
  const matched = matchedInvocation(transcript, tools, config, mediaCommand);
  if (matched.length !== 1) return { prompt: transcript, requestTools: tools };
  const application = config.applications.find((app) => app.id === matched[0].applicationId);
  if (
    findCommandAlias(transcript, config) &&
    matched[0].action === 'open' &&
    application.arguments.some((argument) => argument.includes('{input}'))
  )
    return { prompt: transcript, requestTools: matched, singleAction: true };
  if (matched[0].action.startsWith('deezer_') && !matched[0].boundArguments)
    return { prompt: transcript, requestTools: matched };
  return {
    prompt: canonicalPrompt(matched[0], application),
    requestTools: matched,
    singleAction: true,
  };
}
function validateCardinality(transcript, calls, tools, singleAction) {
  // Quoted/input text cannot authorize extra effects. Repetitions are grounded
  // in literal opening clauses, never in the model's confidence or reasoning.
  const command = transcript
    .replace(/«[^»]*»|"[^"]*"|“[^”]*”/gu, ' ')
    .split(/\b(?:avec\s+(?:le\s+)?texte|with\s+(?:the\s+)?text)\b/iu)[0];
  const clauses = command
    .split(/\s+(?:et|puis|and|then)\s+|[;,]/iu)
    .filter((clause) => clause.trim());
  const words = {
    une: 1,
    un: 1,
    deux: 2,
    trois: 3,
    quatre: 4,
    cinq: 5,
    six: 6,
    sept: 7,
    huit: 8,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    seven: 7,
    eight: 8,
    once: 1,
    twice: 2,
  };
  const repeatPattern =
    /\b(?:(une?|deux|trois|quatre|cinq|six|sept|huit|one|two|three|four|five|seven|eight|[1-8])\s+(?:fois|times?)|once|twice)\b/giu;
  const limits = new Map();
  let maxCalls = 0;
  for (const clause of clauses) {
    const repeats = [...clause.matchAll(repeatPattern)];
    const literal = clause.replace(repeatPattern, ' ').replace(/\s+/g, ' ').trim();
    const matched = tools.filter(
      (tool) =>
        tool.action === 'open' &&
        tool.triggers.some((pattern) => new RegExp(pattern, 'i').test(literal)),
    );
    // Unsupported repetition wording grants no additional allowance.
    const token = repeats.length === 1 ? (repeats[0][1] || repeats[0][0]).toLowerCase() : '';
    const count = matched.length === 1 && repeats.length === 1 ? words[token] || Number(token) : 1;
    maxCalls += count;
    if (matched.length === 1)
      limits.set(matched[0].applicationId, (limits.get(matched[0].applicationId) || 0) + count);
  }
  ensure(
    calls.length <= (singleAction ? 1 : Math.max(1, maxCalls)),
    'Needle a proposé plusieurs appels pour une seule action ou un appel supplémentaire. Reformulez la demande.',
  );
  const openings = new Map();
  for (const call of calls.filter((call) => !call.action || call.action === 'open')) {
    const count = (openings.get(call.applicationId) || 0) + 1;
    ensure(
      count <= (limits.get(call.applicationId) || 1),
      'Needle a proposé une ouverture supplémentaire sans répétition explicite. Reformulez la demande.',
    );
    openings.set(call.applicationId, count);
  }
  for (const [applicationId, count] of limits) {
    ensure(
      count <= 1 || openings.get(applicationId) === count,
      'Needle n’a pas respecté le nombre d’ouvertures explicitement demandé. Reformulez la demande.',
    );
  }
}
function mediaTriggers(application, applications, action) {
  const phrases = {
    media_play: '(?:lecture|play|joue|reprends(?:\\s+la\\s+lecture)?)',
    media_pause: '(?:pause|mets\\s+en\\s+pause|mettre\\s+en\\s+pause)',
    media_next:
      '(?:(?:passe\\s+(?:[aà]\\s+)?(?:la\\s+)?)?(?:piste|chanson|morceau)\\s+suivant[e]?)',
    media_previous:
      '(?:(?:passe\\s+(?:[aà]\\s+)?(?:la\\s+)?)?(?:piste|chanson|morceau)\\s+pr[eé]c[eé]dent[e]?)',
    media_stop: '(?:arr[eê]te|stop)',
    media_toggle:
      '(?:bascule[r]?(?:\\s+(?:la\\s+)?lecture\\s*[/ ]\\s*pause)?|lecture\\s*/\\s*pause)',
    deezer_content:
      "(?:affiche[r]?|ouvre|ouvrir)\\s+(?:(?:la|le|un|une|l['’])\\s*)?(?:chanson|titre|track|album|artiste|artist|playlist|podcast|show|[ée]pisode|episode|profil|profile)\\s+[1-9][0-9]{0,18}",
    deezer_search: '(?:cherche[r]?|recherche[r]?)\\s+.+',
    deezer_start:
      '(?:d[eé]marre[r]?|lance[r]?|joue|[ée]coute[r]?|lis|lire)\\s+(?:(?:le|les|mes)\\s+)?(?:flow|coups\\s+de\\s+c(?:œur|oeur))',
    deezer_reload: '(?:recharge[r]?|reload)',
  };
  if (!phrases[action]) return [];
  const labels = [
    ...new Set([application.name, ...application.aliases].flatMap(labelVariants)),
  ].filter(
    (label) =>
      !applications.some(
        (other) =>
          other.id !== application.id &&
          [other.name, ...other.aliases].flatMap(labelVariants).includes(label),
      ),
  );
  if (!labels.length) return [];
  const names = labels
    .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'))
    .join('|');
  return [`^\\s*${phrases[action]}\\s+(?:(?:dans|sur|de)\\s+)?(?:${names})\\s*[.!?]*\\s*$`];
}
function validateCalls(calls, config) {
  ensure(
    Array.isArray(calls) && calls.length > 0 && calls.length <= 8,
    'Liste d’appels invalide (8 maximum).',
  );
  return calls.map((call) => {
    const tool = toolsFor(config).find((tool) => tool.name === call.name);
    const application = config.applications.find(
      (app) => app.enabled && app.id === tool?.applicationId,
    );
    ensure(application, `Needle a proposé un outil inconnu ou désactivé : ${call.name}.`);
    const args = call.arguments;
    ensure(
      args && typeof args === 'object' && !Array.isArray(args),
      'Arguments de l’outil invalides.',
    );
    if (tool.action !== 'open') {
      let arguments_;
      if (tool.action.startsWith('media_')) {
        ensure(Object.keys(args).length === 0, 'La commande multimédia n’accepte aucun argument.');
        arguments_ = {};
      } else arguments_ = validateDeezerArgs(tool.action, args);
      return {
        name: call.name,
        arguments: arguments_,
        applicationId: application.id,
        applicationName: application.name,
        action: tool.action,
        actionLabel: deezerActionLabel(tool.action, arguments_) || tool.actionLabel,
      };
    }
    const acceptsInput = application.arguments.some((argument) => argument.includes('{input}'));
    ensure(
      Object.keys(args).every((key) => acceptsInput && key === 'input'),
      'Needle a proposé un argument non autorisé.',
    );
    const input = args.input ?? '';
    ensure(
      typeof input === 'string' && input.length <= 2048 && !input.includes('\0'),
      'Texte transmis invalide.',
    );
    return {
      name: call.name,
      arguments: acceptsInput ? { input } : {},
      applicationId: application.id,
      applicationName: application.name,
    };
  });
}
module.exports = {
  toolName,
  actionToolName,
  labelVariants,
  toolsFor,
  matchedInvocation,
  resolveInvocation,
  validateCardinality,
  validateCalls,
  mediaTriggers,
};
