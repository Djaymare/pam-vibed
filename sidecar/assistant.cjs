const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const executeFile = promisify(execFile);
const { validatePayload } = require('./contracts.cjs');
const { createMedia } = require('./media.cjs');
const { createTemporaryFiles } = require('./temporary-files.cjs');
const { createBudget, interruptedTurn } = require('./budget.cjs');
const { proposalStore } = require('./proposals.cjs');
const { requestId, failure, annotate, maskMessage } = require('./diagnostics.cjs');
const { DEFAULT_CONFIG } = require('./config-schema.cjs');
const {
  createProfileRepository,
  editProfile,
  CONFIG_METHODS,
  configDigest,
  applicationAvailability,
} = require('./assistant/config-repository.cjs');
const { createExecutor, launch } = require('./assistant/executor.cjs');
const { createPlanner, correctRequest, parseEngineOutput } = require('./assistant/planner.cjs');
const { validateWav } = require('./assistant/audio.cjs');
const { toolsFor, validateCalls, toolName, actionToolName } = require('./assistant/intent.cjs');
const { ensure, cleanText } = require('./assistant/validation.cjs');
function createAssistant({
  runtimeDirectory,
  configDirectory,
  runEngine = executeFile,
  launchApplication = launch,
  engine,
  media = createMedia(),
  now,
  proposalNow = Date.now,
  setTimer,
  clearTimer,
  budgetMs = 40_000,
}) {
  const temporaryFiles = createTemporaryFiles(configDirectory);
  const proposals = proposalStore(configDirectory, { now: proposalNow });
  const profiles = createProfileRepository(configDirectory, proposals);
  const executions = createExecutor({ configDirectory, media, launchApplication });
  const executeCalls = executions.execute;
  const prepare = createPlanner({
    runtimeDirectory,
    configDirectory,
    runEngine,
    media,
    temporaryFiles,
  });
  let startupCleanup = proposals.initialize().then(() => temporaryFiles.collect());
  async function handle(method, payload, context) {
    const { budget } = context;
    await budget.run(() => startupCleanup, 'nettoyage initial');
    startupCleanup = null;
    const temporaryCleanup = await budget.run(() => temporaryFiles.collect(), 'nettoyage');
    if (method === 'export_config')
      return budget.run(() => profiles.exportConfig(), 'export du profil');
    if (method === 'preview_import')
      return budget.run(() => profiles.previewImport(payload.content), 'aperçu du profil');
    if (method === 'recover_config' || method === 'import_config') {
      const options = { budget, beforeReplace: () => proposals.reconcile(null) };
      const result = await budget.run(
        () =>
          method === 'recover_config'
            ? profiles.recover(payload, options)
            : profiles.importConfig(payload, options),
        'remplacement du profil',
      );
      return result;
    }
    let config, configError, loadedFingerprint, profileDiagnostic;
    try {
      ({ config, fingerprint: loadedFingerprint } = await budget.run(
        () => profiles.readState(),
        'configuration',
      ));
    } catch (error) {
      if (method !== 'status' || error.code !== 'invalid_profile') throw error;
      const diagnostic = failure(error, context, 'invalid_profile', 'profile');
      config = structuredClone(DEFAULT_CONFIG);
      configError = { ...error.details, message: maskMessage(error.details.message) };
      profileDiagnostic = diagnostic;
    }
    const saveConfig = (value) => profiles.save(value, { budget, fingerprint: loadedFingerprint });
    if (method === 'status') {
      const files = [
        'needle.exe',
        'models/needle3.cact',
        'models/whistle.cact',
        'npm/bin/npm-cli.js',
        'libneedle3.dll',
        'ffi/node_modules/@koromix/koffi-win32-x64/win32_x64/koffi.node',
      ];
      const checks = await Promise.all(
        files.map(async (file) => {
          try {
            return { file, available: (await fs.stat(path.join(runtimeDirectory, file))).isFile() };
          } catch {
            return { file, available: false };
          }
        }),
      );
      let manifest = null;
      try {
        manifest = JSON.parse(
          await fs.readFile(path.join(runtimeDirectory, 'manifest.json'), 'utf8'),
        );
      } catch {}
      const ready = !configError && checks.every((check) => check.available);
      if (ready && engine) {
        try {
          await budget.run(
            () => engine.warm({ timeout: budget.timeout() }),
            'chargement des moteurs',
          );
        } catch (error) {
          throw annotate(error, context, 'model_failure', 'inference');
        }
      }
      const applicationAvailabilityEntries = await Promise.all(
        config.applications.map(async (app) => [app.id, await applicationAvailability(app)]),
      );
      return {
        ready,
        checks,
        manifest,
        config,
        profileBackup: await profiles.recoveryInfo().catch(() => null),
        proposals: await proposals.reconcile(configError ? null : configDigest(config)),
        applicationAvailability: Object.fromEntries(applicationAvailabilityEntries),
        configDirectory,
        ...(configError ? { configError, error: profileDiagnostic } : {}),
        temporaryCleanup,
        engine: engine?.status() ?? null,
      };
    }
    if (method === 'restart_engine') {
      ensure(engine, 'Le moteur persistant est indisponible.');
      await engine.close();
      try {
        await budget.run(
          () => engine.warm({ timeout: budget.timeout() }),
          'chargement des moteurs',
        );
      } catch (error) {
        throw annotate(error, context, 'model_failure', 'inference');
      }
      return engine.status();
    }
    if (method === 'media_sessions')
      return budget.run(() => media.sessions({ budget }), 'sessions');
    if (method === 'prepare_action') {
      // A user click creates the same one-shot confirmation as a model proposal.
      const app = config.applications.find(
        (app) => app.id === payload.applicationId && app.enabled,
      );
      ensure(app, 'Application introuvable ou désactivée.');
      const calls = validateCalls(
        [{ name: actionToolName(app, payload.action), arguments: payload.arguments ?? {} }],
        config,
      );
      const turn = {
        id: randomUUID(),
        transcript:
          payload.label === undefined
            ? calls[0].actionLabel || `Ouvrir ${app.name}`
            : cleanText(payload.label, 'Libellé de l’action', 2000),
        language: config.language,
        confidence: null,
        reasoning: 'Action choisie explicitement.',
        durationMs: 0,
        calls,
        results: [],
        status: 'pending',
      };
      return proposals.prepare(turn, configDigest(config));
    }
    if (CONFIG_METHODS.has(method))
      return editProfile(method, payload, config, {
        budget,
        saveConfig,
        launchApplication,
        context,
      });
    if (method === 'confirm' || method === 'discard') {
      ensure(
        typeof payload.id === 'string' && /^[0-9a-f-]{36}$/.test(payload.id),
        'Identifiant de demande invalide.',
      );
      if (method === 'confirm') {
        const previous = await executions.read(payload.id);
        if (previous) {
          return previous.status === 'partial'
            ? previous
            : {
                ...previous,
                status: 'consumed',
                message: 'Cette confirmation a déjà été consommée. Aucun rejeu autorisé.',
              };
        }
      }
      const claimed = await proposals.claim(payload.id, configDigest(config), method === 'confirm');
      if (!claimed.executable) return claimed.turn;
      delete claimed.turn.message;
      return executeCalls(claimed.turn, config, context);
    }
    if (method === 'correct_request') {
      const corrected = await correctRequest(payload, config, { proposals, saveConfig });
      if (corrected) return corrected;
    }
    ensure(
      method === 'process_text' || method === 'process_audio' || method === 'correct_request',
      'Méthode inconnue.',
    );
    const prepared = await prepare(method, payload, config, context);
    if (prepared.execute) return executeCalls(prepared.turn, config, context);
    if (prepared.status === 'pending') await proposals.prepare(prepared, configDigest(config));
    return prepared;
  }
  return async (method, payload = {}, context = {}) => {
    context = { ...context, requestId: requestId(context.requestId) };
    if (!validatePayload(method, payload))
      throw annotate(new Error('Requête IPC invalide.'), context);
    const budget =
      context.budget ||
      createBudget({
        milliseconds: budgetMs,
        ...(now ? { now } : {}),
        ...(setTimer ? { setTimer, clearTimer } : {}),
      });
    try {
      return await handle(method, payload, { ...context, budget });
    } catch (error) {
      if (error.code !== 'budget_expired') throw annotate(error, context);
      const diagnostic = failure(error, context);
      return {
        ...interruptedTurn(
          {
            id: randomUUID(),
            transcript: typeof payload.text === 'string' ? payload.text : '',
            language: 'fr',
            confidence: null,
            reasoning: '',
            durationMs: budget.elapsed(),
            calls: [],
            results: [],
          },
          diagnostic.message,
        ),
        error: diagnostic,
      };
    }
  };
}
module.exports = {
  createAssistant,
  validateCalls,
  validateWav,
  toolsFor,
  parseEngineOutput,
  toolName,
  actionToolName,
  DEFAULT_CONFIG,
};
