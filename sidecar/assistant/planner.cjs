// Owns one inference lease. Produces a validated turn; never launches applications.
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { LANGUAGES } = require('../config-schema.cjs');
const { languageIssue } = require('../languages.cjs');
const {
  ACTIONS: ALIAS_ACTIONS,
  findCommandAlias,
  saveCommandAlias,
} = require('../command-aliases.cjs');
const {
  needleToolName,
  needleTools,
  canonicalPrompt,
  requestIssue,
} = require('../needle-tools.cjs');
const { recognizeDeezerCommand, deezerCommandIssue } = require('../deezer-commands.cjs');
const { resolveMediaCommand } = require('../media-commands.cjs');
const { annotate } = require('../diagnostics.cjs');
const { ensure, cleanText } = require('./validation.cjs');
const { validateWav } = require('./audio.cjs');
const {
  toolsFor,
  toolName,
  actionToolName,
  labelVariants,
  matchedInvocation,
  resolveInvocation,
  validateCardinality,
  mediaTriggers,
  validateCalls,
} = require('./intent.cjs');
const { configDigest } = require('./config-repository.cjs');
const { confirmationReason } = require('./confirmation.cjs');
const { measure } = require('./performance.cjs');
function parseEngineOutput(stdout) {
  // Engine diagnostics may precede the JSON; never interpret diagnostics as calls.
  try {
    return JSON.parse(stdout.trim());
  } catch {}
  for (const line of stdout.trim().split(/\r?\n/).reverse()) {
    try {
      const result = JSON.parse(line);
      if (result && typeof result === 'object') return result;
    } catch {}
  }
  throw new Error('Le moteur Needle n’a pas renvoyé de JSON valide.');
}
async function correctRequest(payload, config, { proposals, saveConfig }) {
  ensure(
    typeof payload.id === 'string' && /^[0-9a-f-]{36}$/.test(payload.id),
    'Identifiant de demande invalide.',
  );
  cleanText(payload.text, 'Demande corrigée', 2000);
  const app = payload.applicationId
    ? config.applications.find((app) => app.id === payload.applicationId && app.enabled)
    : null;
  ensure(!payload.applicationId || app, 'Application corrigée introuvable ou désactivée.');
  let chosenCalls;
  if (payload.action !== undefined) {
    ensure(
      app && ALIAS_ACTIONS.has(payload.action),
      'Choisissez une application et une action de lancement ou de lecture.',
    );
    chosenCalls = validateCalls(
      [
        {
          name: actionToolName(app, payload.action),
          arguments:
            payload.action === 'open' && app.arguments.some((arg) => arg.includes('{input}'))
              ? { input: payload.input ?? '' }
              : (payload.arguments ?? {}),
        },
      ],
      config,
    );
  }
  ensure(
    payload.input === undefined ||
      (app &&
        app.arguments.some((arg) => arg.includes('{input}')) &&
        typeof payload.input === 'string' &&
        payload.input.length <= 2048 &&
        !payload.input.includes('\0')),
    'Texte transmis invalide.',
  );
  if (payload.saveAlias === true) {
    ensure(app, 'Choisissez une application pour enregistrer un alias.');
    const alias = cleanText(payload.alias, 'Alias', 40);
    const variants = labelVariants(alias);
    ensure(
      !config.applications.some(
        (other) =>
          other.id !== app.id &&
          [other.name, ...other.aliases]
            .flatMap(labelVariants)
            .some((label) => variants.includes(label)),
      ),
      'Cet alias désigne déjà une autre application.',
    );
    if (
      ![app.name, ...app.aliases].flatMap(labelVariants).some((label) => variants.includes(label))
    ) {
      ensure(app.aliases.length < 6, 'Six alias maximum par application.');
      app.aliases.push(alias);
    }
  }
  if (payload.saveCommandAlias === true) {
    ensure(chosenCalls, 'Choisissez explicitement l’action à mémoriser.');
    saveCommandAlias(
      {
        phrase: payload.commandPhrase,
        applicationId: app.id,
        action: payload.action,
        ...(payload.action.startsWith('deezer_') ? { arguments: payload.arguments ?? {} } : {}),
      },
      config,
      toolsFor(config),
    );
  }
  if (payload.saveAlias === true || payload.saveCommandAlias === true) await saveConfig(config);
  // Retire the old approval before preparing a replacement, even if inference fails.
  await proposals.invalidate(payload.id);
  if (chosenCalls) {
    const turn = {
      id: randomUUID(),
      transcript: payload.text.trim(),
      language: config.language,
      confidence: null,
      reasoning: 'Action choisie explicitement dans la correction.',
      durationMs: 0,
      calls: chosenCalls,
      results: [],
      status: 'pending',
      correctedFrom: payload.id,
    };
    return proposals.prepare(turn, configDigest(config));
  }
}
/**
 * Returns a validated Turn, or { turn, execute: true } when existing confidence
 * policy permits automatic execution. Only the dispatcher consumes that decision.
 * The inference lease is released before handing the plan to the executor.
 */
function createPlanner({ runtimeDirectory, configDirectory, runEngine, media, temporaryFiles }) {
  return async function prepare(method, payload, config, context) {
    const { budget } = context;
    const { sessions, tools } = await measure(context, 'discovery', async () => {
      let sessions;
      if (config.applications.some((app) => app.enabled && app.media)) {
        try {
          sessions = await budget.run(() => media.sessions({ budget }), 'sessions');
        } catch (error) {
          if (error.code === 'budget_expired') throw error;
          sessions = [];
        }
      }
      return { sessions, tools: toolsFor(config, sessions) };
    });
    ensure(
      tools.length > 0,
      'Ajoutez et activez au moins une application avant de faire une demande.',
    );
    await fs.mkdir(configDirectory, { recursive: true });
    const lease = await temporaryFiles.createTurn();
    const temporary = lease.directory;
    async function infer(args) {
      try {
        const timeout = budget.timeout();
        const { stdout } = await measure(
          context,
          args.includes('--tools') ? 'routing' : 'transcription',
          () =>
            budget.run(
              () =>
                runEngine(path.join(runtimeDirectory, 'needle.exe'), args, {
                  timeout,
                  maxBuffer: 1024 * 1024,
                  windowsHide: true,
                  encoding: 'utf8',
                  shell: false,
                  env: { ...process.env, NEEDLE_TELEMETRY: '0', DO_NOT_TRACK: '1' },
                }),
              'inférence',
            ),
        );
        const response = parseEngineOutput(stdout);
        ensure(response.success !== false, response.error || 'Le moteur a refusé la demande.');
        return response;
      } catch (error) {
        if (['catalog_capacity', 'request_capacity'].includes(error.code)) throw error;
        throw annotate(
          error,
          context,
          'model_failure',
          args.includes('--audio') && !args.includes('--tools') ? 'transcription' : 'inference',
        );
      }
    }
    try {
      let transcript = '';
      let language = config.language;
      let speechArgs = null;
      if (method === 'process_audio') {
        const audioPath = path.join(temporary, 'clip.wav');
        await fs.writeFile(audioPath, validateWav(payload.audio));
        const keywordsPath = path.join(temporary, 'keywords.txt');
        await fs.writeFile(
          keywordsPath,
          config.applications
            .filter((app) => app.enabled)
            .flatMap((app) => [app.name, ...app.aliases])
            .join('\n'),
        );
        speechArgs = [
          '--model',
          path.join(runtimeDirectory, 'models/whistle.cact'),
          '--audio',
          audioPath,
          '--audio-keywords',
          keywordsPath,
        ];
        if (config.language !== 'auto') speechArgs.push('--audio-language', config.language);
        const speech = await infer(speechArgs);
        ensure(
          typeof speech.text === 'string',
          'Le moteur n’a pas renvoyé la transcription Whistle.',
        );
        ensure(
          speech.text.length <= 2000 && !speech.text.includes('\0'),
          'Transcription Whistle invalide.',
        );
        transcript = speech.text.trim();
        if (LANGUAGES.has(speech.language) && speech.language !== 'auto')
          language = speech.language;
      } else transcript = cleanText(payload.text, 'Demande', 2000);
      const turn = {
        id: randomUUID(),
        transcript,
        language,
        confidence: null,
        reasoning: '',
        durationMs: budget.elapsed(),
        calls: [],
        results: [],
        status: 'unsupported',
      };
      if (!transcript) return { ...turn, status: 'silence' };
      const unsupportedLanguage = languageIssue(config.language, language, method);
      if (unsupportedLanguage) return { ...turn, message: unsupportedLanguage };
      const alias = findCommandAlias(transcript, config);
      if (alias) {
        const target = config.applications.find(
          (app) => app.id === alias.applicationId && app.enabled,
        );
        if (!target)
          return {
            ...turn,
            message: 'L’application de cette formulation mémorisée est désactivée ou supprimée.',
          };
        if (
          !tools.some(
            (tool) => tool.applicationId === alias.applicationId && tool.action === alias.action,
          )
        )
          return {
            ...turn,
            message:
              'L’action mémorisée n’est pas disponible actuellement pour ce lecteur. Vérifiez sa session et ses capacités.',
          };
        turn.commandAliasId = alias.id;
      }
      if (!alias && !(method === 'correct_request' && payload.applicationId)) {
        const issue = deezerCommandIssue(transcript, config);
        if (issue) return { ...turn, message: issue };
      }
      const selectedApplicationId =
        method === 'correct_request' ? payload.applicationId : undefined;
      const deezerApps = config.applications.filter((app) => app.enabled && app.media?.deezer);
      const namedDeezer = deezerApps.some((app) =>
        [app.name, ...app.aliases]
          .flatMap(labelVariants)
          .some((label) =>
            new RegExp(
              `(?:^|[^\\p{L}\\p{N}])${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^\\p{L}\\p{N}])`,
              'iu',
            ).test(transcript),
          ),
      );
      if (
        namedDeezer &&
        /(?:ajout|ins[eè]r|mets|mettre|programme).*?(?:file|queue|en\s+prochain|(?:jouer|lire|[ée]couter)\s+(?:ensuite|apr[eè]s))/iu.test(
          transcript,
        )
      )
        return {
          ...turn,
          message:
            'Le protocole Deezer vérifié ne permet pas d’insérer une chanson précise en prochaine position. Choisissez cette action dans Deezer. « Piste suivante » lit le prochain élément déjà présent.',
        };
      if (
        namedDeezer &&
        /(?:joue|jouer|lance|lancer|[ée]coute|[ée]couter|lis|lire|play)\s+(?:(?:la|le|une?|the)\s+)?(?:chanson|titre|morceau|piste|song|track)\s+(?!suivant|pr[eé]c[eé]dent|next|previous)/iu.test(
          transcript,
        )
      )
        return {
          ...turn,
          message:
            'Le protocole Deezer vérifié peut afficher ou rechercher une chanson, mais ne permet pas d’en démarrer la lecture précise. Choisissez la lecture dans Deezer.',
        };
      const mediaCommand =
        !alias && !recognizeDeezerCommand(transcript, config)
          ? resolveMediaCommand(transcript, config, sessions || [], selectedApplicationId)
          : undefined;
      if (mediaCommand?.issue) return { ...turn, message: mediaCommand.issue };
      const explicit = matchedInvocation(transcript, toolsFor(config), config, mediaCommand);
      if (
        !(method === 'correct_request' && payload.applicationId) &&
        explicit.length === 1 &&
        explicit[0].action.startsWith('media_') &&
        !tools.some((tool) => tool.name === explicit[0].name)
      )
        return {
          ...turn,
          message:
            'Le lecteur demandé ne propose actuellement pas cette commande. Vérifiez sa session et ses capacités dans Applications.',
        };
      let { prompt, requestTools, singleAction } = resolveInvocation(
        transcript,
        tools,
        config,
        mediaCommand,
      );
      if (method === 'correct_request' && payload.applicationId) {
        const app = config.applications.find((app) => app.id === payload.applicationId);
        requestTools = tools.filter((tool) => tool.applicationId === app.id);
        // The selected application is an explicit user correction. Preserve any
        // free-form input in a separate, user-editable field instead of inferring it.
        if (
          explicit.length === 1 &&
          (!explicit[0].action.startsWith('deezer_') || explicit[0].boundArguments)
        ) {
          let selected = requestTools.find((tool) => tool.action === explicit[0].action);
          if (!selected)
            return {
              ...turn,
              message: 'L’application choisie ne propose actuellement pas cette commande.',
            };
          if (explicit[0].boundArguments)
            selected = { ...selected, boundArguments: explicit[0].boundArguments };
          prompt = canonicalPrompt(selected, app);
          requestTools = [selected];
          singleAction = true;
        } else if (!app.media) {
          prompt = canonicalPrompt(
            tools.find((tool) => tool.applicationId === app.id && tool.action === 'open'),
            app,
          );
          singleAction = true;
        }
      }
      const toolsPath = path.join(temporary, 'tools.json');
      const systemPath = path.join(temporary, 'system.txt');
      const resolvedDeezer = requestTools.length === 1 && !!requestTools[0].boundArguments;
      await fs.writeFile(toolsPath, JSON.stringify(needleTools(requestTools, config)));
      // Deezer bindings contain no model-generated parameters. The original
      // request, protocol limits and exact bound arguments are checked locally.
      await fs.writeFile(
        systemPath,
        resolvedDeezer
          ? 'locale: en\nOnly use registered tools.'
          : `locale: ${language}\nplatform: Windows\nOnly use registered tools. Input values must come from the user's request. A Deezer content or search link only displays a page, never starts a song or adds it next in the queue. Skip next plays the next item already in the queue, never inserts a requested song. Reject requests to play a specific song or queue it next when no tool offers that behavior.\n`,
      );
      const needleArgs = [
        '--model',
        path.join(runtimeDirectory, 'models/needle3.cact'),
        '--tools',
        toolsPath,
        '--system',
        systemPath,
        '--max',
        '256',
        '--fail-input-overflow',
      ];
      // The Windows runner's narrow --prompt argv loses non-ASCII characters.
      // Preserve free-form speech and input values by passing the WAV directly
      // when the resolved prompt still needs Unicode. Canonical ASCII names
      // take the same text path as typed requests.
      // eslint-disable-next-line no-control-regex -- The runner cannot carry non-ASCII prompt arguments.
      const useAudioTransport = speechArgs && !runEngine.unicode && /[^\x00-\x7f]/.test(prompt);
      if (useAudioTransport) needleArgs.push(...speechArgs);
      else needleArgs.push('--prompt', prompt);
      let response;
      try {
        response = await infer(needleArgs);
      } catch (error) {
        if (['catalog_capacity', 'request_capacity'].includes(error.code))
          return { ...turn, message: error.message, durationMs: budget.elapsed() };
        throw error;
      }
      if (useAudioTransport) {
        ensure(
          typeof response.audio_text === 'string',
          'Le moteur n’a pas renvoyé la transcription Whistle.',
        );
        ensure(
          response.audio_text.length <= 2000 && !response.audio_text.includes('\0'),
          'Transcription Whistle invalide.',
        );
        turn.transcript = response.audio_text.trim();
        // Needle's inference locale is not a transcription language detection.
        if (!turn.transcript) return { ...turn, status: 'silence', durationMs: budget.elapsed() };
      }
      const confidence =
        typeof response.confidence === 'number' &&
        Number.isFinite(response.confidence) &&
        response.confidence >= 0 &&
        response.confidence <= 1
          ? response.confidence
          : null;
      turn.confidence = confidence;
      turn.reasoning = typeof response.reasoning === 'string' ? response.reasoning : '';
      turn.durationMs = budget.elapsed();
      ensure(
        Array.isArray(response.function_calls),
        'Réponse Needle invalide : function_calls manquant.',
      );
      const suppressed =
        response.function_calls.length === 0 &&
        Array.isArray(response.suppressed_calls) &&
        response.suppressed_calls.length > 0;
      const calls = suppressed ? response.suppressed_calls : response.function_calls;
      if (calls.length === 0) return turn;
      const modelNames = new Map(
        [...toolsFor(config), ...requestTools].map((tool) => [
          needleToolName(tool, config),
          tool.name,
        ]),
      );
      turn.calls = validateCalls(
        calls.map((call) => {
          const name = modelNames.get(call.name) ?? call.name;
          const bound = requestTools.find((tool) => tool.name === name)?.boundArguments;
          if (bound)
            ensure(
              calls.length === 1 &&
                call.arguments &&
                typeof call.arguments === 'object' &&
                !Array.isArray(call.arguments) &&
                Object.keys(call.arguments).length === 0,
              'Needle a modifié les paramètres d’une commande reconnue. Reformulez la demande.',
            );
          return { ...call, name, arguments: bound || call.arguments };
        }),
        config,
      );
      ensure(
        turn.calls.every((call) => requestTools.some((tool) => tool.name === call.name)),
        'Needle a proposé une application différente de celle demandée.',
      );
      const issue = requestIssue(transcript, config, turn.calls, selectedApplicationId, alias);
      if (issue) return { ...turn, calls: [], message: issue };
      validateCardinality(transcript, turn.calls, tools, singleAction);
      if (
        turn.calls.some((call) => ['deezer_content', 'deezer_search'].includes(call.action)) &&
        /(?:^|\s)(?:joue|jouer|[ée]coute|[ée]couter|play)(?:\s|$)/iu.test(transcript)
      ) {
        return {
          ...turn,
          calls: [],
          message:
            'Le protocole Deezer vérifié peut afficher ou rechercher une chanson, mais ne permet pas d’en démarrer la lecture précise. Choisissez la lecture dans Deezer.',
        };
      }
      const simpleResume = deezerApps.some((app) =>
        mediaTriggers(app, config.applications, 'media_play').some((pattern) =>
          new RegExp(pattern, 'i').test(transcript),
        ),
      );
      if (
        namedDeezer &&
        /^\s*(?:joue|jouer|[ée]coute|[ée]couter|play|lis|lire)\s/iu.test(transcript) &&
        !simpleResume &&
        !resolvedDeezer &&
        !/(?:repren|reprise|lecture|\bflow\b|coups?\s+de\s+c(?:œur|oeur)|smarttracklist)/iu.test(
          transcript,
        ) &&
        turn.calls.some((call) => ['media_play', 'deezer_start'].includes(call.action))
      )
        return {
          ...turn,
          calls: [],
          message:
            'Le protocole Deezer vérifié ne permet pas de jouer une chanson précise. Affichez sa page ou recherchez son titre, puis choisissez la lecture dans Deezer.',
        };
      for (const call of turn.calls.filter((call) => call.action === 'deezer_start')) {
        const requested =
          call.arguments.mix === 'flow' ? /\bflow\b/iu : /coups?\s+de\s+c(?:œur|oeur)/iu;
        ensure(
          resolvedDeezer || requested.test(transcript),
          'La sélection Deezer proposée ne figure pas dans votre demande.',
        );
      }
      for (const call of turn.calls.filter((call) =>
        ['deezer_content', 'deezer_smarttracklist'].includes(call.action),
      )) {
        const id = call.arguments.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        ensure(
          (alias?.arguments?.id === call.arguments.id && resolvedDeezer) ||
            new RegExp(`(?:^|[^\\p{L}\\p{N}_-])${id}(?:$|[^\\p{L}\\p{N}_-])`, 'u').test(transcript),
          'L’identifiant Deezer proposé ne figure pas dans votre demande. Fournissez un lien ou un identifiant, ou demandez une recherche par titre.',
        );
      }
      if (method === 'correct_request') {
        turn.correctedFrom = payload.id;
        if (
          payload.applicationId &&
          !config.applications.find((app) => app.id === payload.applicationId).media
        ) {
          const app = config.applications.find((app) => app.id === payload.applicationId);
          const acceptsInput = app.arguments.some((arg) => arg.includes('{input}'));
          ensure(
            payload.input === undefined ||
              (acceptsInput &&
                typeof payload.input === 'string' &&
                payload.input.length <= 2048 &&
                !payload.input.includes('\0')),
            'Texte transmis invalide.',
          );
          turn.calls = validateCalls(
            [
              {
                name: toolName(app),
                arguments: acceptsInput ? { input: payload.input ?? '' } : {},
              },
            ],
            config,
          );
        }
      }
      const ungrounded =
        Array.isArray(response.validation?.ungrounded) && response.validation.ungrounded.length > 0;
      const reason = confirmationReason(method, turn, config, {
        suppressed,
        ungrounded,
        tools,
      });
      if (!reason) {
        return { turn, execute: true };
      } else {
        turn.status = 'pending';
        turn.message = reason;
      }
      return turn;
    } finally {
      await lease.release();
    }
  };
}
module.exports = { createPlanner, correctRequest, parseEngineOutput };
