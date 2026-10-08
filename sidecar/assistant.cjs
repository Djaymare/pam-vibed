const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const executeFile = promisify(execFile);

const LANGUAGES = new Set(['auto', 'fr', 'en', 'de', 'es', 'it', 'nl', 'pl']);
const MAX_AUDIO_BYTES = 44 + 16_000 * 30 * 2;
const DEFAULT_CONFIG = { version: 1, applications: [], language: 'fr', autoExecute: true, confidenceThreshold: 0.7 };

function ensure(condition, message) { if (!condition) throw new Error(message); }
function cleanText(value, label, max = 200) {
  ensure(typeof value === 'string' && value.trim().length > 0 && value.length <= max && !value.includes('\0'), `${label} invalide.`);
  return value.trim();
}
function configDigest(config) {
  return createHash('sha256').update(JSON.stringify(config.applications)).digest('hex');
}
async function atomicJson(destination, value) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  await fs.rename(temporary, destination);
}
async function readConfig(directory) {
  try {
    const config = JSON.parse(await fs.readFile(path.join(directory, 'applications.json'), 'utf8'));
    ensure(config.version === 1 && Array.isArray(config.applications), 'Configuration des applications incompatible.');
    ensure(LANGUAGES.has(config.language) && typeof config.autoExecute === 'boolean' &&
      Number.isFinite(config.confidenceThreshold) && config.confidenceThreshold >= 0.1 && config.confidenceThreshold <= 1,
      'Préférences invalides.');
    return config;
  } catch (error) {
    if (error.code === 'ENOENT') return structuredClone(DEFAULT_CONFIG);
    throw new Error(`Impossible de lire la configuration : ${error.message}`);
  }
}

async function validateApplication(value, existingId) {
  ensure(value && typeof value === 'object', 'Application invalide.');
  const name = cleanText(value.name, 'Nom', 60);
  const description = cleanText(value.description, 'Description', 240);
  const executable = cleanText(value.executable, 'Exécutable', 1024);
  ensure(path.win32.isAbsolute(executable) && executable.toLowerCase().endsWith('.exe'), 'Choisissez le chemin absolu d’un fichier .exe.');
  ensure((await fs.stat(executable)).isFile(), 'Cet exécutable est introuvable.');
  ensure(Array.isArray(value.arguments) && value.arguments.length <= 20 && value.arguments.every(argument =>
    typeof argument === 'string' && argument.length <= 2048 && !argument.includes('\0')), 'Arguments invalides (tableau de chaînes, 20 maximum).');
  const aliases = Array.isArray(value.aliases) ? value.aliases.map(alias => cleanText(alias, 'Alias', 40)) : [];
  ensure(aliases.length <= 6, 'Six alias maximum par application.');
  ensure(typeof value.enabled === 'boolean', 'État de l’application invalide.');
  return { id: existingId || randomUUID(), name, description, executable,
    arguments: value.arguments, aliases, enabled: value.enabled };
}

function toolName(application) {
  const readable = application.name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'application';
  return `open_${readable}_${application.id.slice(0, 8)}`;
}
function labelVariants(label) {
  const normalized = label.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  return [...new Set([normalized, normalized.normalize('NFKD').replace(/\p{M}/gu, '')])];
}
function triggersFor(application, applications) {
  // A trigger constrains the entire Needle turn. Only force an unambiguous,
  // single application invocation; leave compound requests to the model.
  const labels = [...new Set([application.name, ...application.aliases].flatMap(labelVariants))]
    .filter(label => !applications.some(other => other.id !== application.id &&
      [other.name, ...other.aliases].flatMap(labelVariants).includes(label)));
  if (!labels.length) return [];
  const names = labels.map(label => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')).join('|');
  const polite = "(?:s['’]il\\s+(?:te|vous)\\s+pla[iî]t|please)";
  const prefix = '(?:peux[-\\s]tu|pouvez[-\\s]vous|tu\\s+peux|vous\\s+pouvez|je\\s+(?:veux|voudrais|souhaite)|can\\s+you|could\\s+you)';
  const action = '(?:ouvre|ouvrez|ouvrir|lance|lancez|lancer|d[eé]marre|d[eé]marrez|d[eé]marrer|open|launch|start)';
  const article = "(?:l['’]|(?:le|la|les|the)\\s+)";
  const app = '(?:(?:application|app)\\s+)';
  const end = `\\s*(?:,?\\s*${polite})?\\s*[.!?]*\\s*$`;
  return [
    `^\\s*(?:${names})${end}`,
    `^\\s*(?:${polite}\\s*,?\\s*)?(?:${prefix}\\s+)?${action}\\s+(?:${article})?(?:${app})?(?:${names})${end}`,
  ];
}
function toolsFor(config) {
  const applications = config.applications.filter(app => app.enabled);
  return applications.map(app => ({
    name: toolName(app),
    description: `Ouvrir / lancer ${app.name}. ${app.description}${app.aliases.length ? ` Autres noms de cette même application : ${app.aliases.join(', ')}.` : ''}`,
    triggers: triggersFor(app, applications),
    parameters: {
      type: 'object',
      properties: app.arguments.some(argument => argument.includes('{input}'))
        ? { input: { type: 'string', description: 'Texte, fichier ou URL explicitement demandé à transmettre à cette application.', maxLength: 2048, default: '' } }
        : {},
      required: [],
      additionalProperties: false,
    },
  }));
}
function resolveInvocation(transcript, tools, config) {
  // Text and speech share this resolution. Only rewrite a literal, unambiguous
  // application invocation; keep compound requests and their arguments intact.
  const matched = tools.filter(tool => tool.triggers.some(pattern => new RegExp(pattern, 'i').test(transcript)));
  if (matched.length !== 1) return { prompt: transcript, requestTools: tools };
  const application = config.applications.find(app => toolName(app) === matched[0].name);
  return { prompt: `Ouvre ${labelVariants(application.name).at(-1)}`, requestTools: matched };
}

function validateCalls(calls, config) {
  ensure(Array.isArray(calls) && calls.length > 0 && calls.length <= 8, 'Liste d’appels invalide (8 maximum).');
  return calls.map(call => {
    const application = config.applications.find(app => app.enabled && toolName(app) === call.name);
    ensure(application, `Needle a proposé un outil inconnu ou désactivé : ${call.name}.`);
    const args = call.arguments;
    ensure(args && typeof args === 'object' && !Array.isArray(args), 'Arguments de l’outil invalides.');
    const acceptsInput = application.arguments.some(argument => argument.includes('{input}'));
    ensure(Object.keys(args).every(key => acceptsInput && key === 'input'), 'Needle a proposé un argument non autorisé.');
    const input = args.input ?? '';
    ensure(typeof input === 'string' && input.length <= 2048 && !input.includes('\0'), 'Texte transmis invalide.');
    return { name: call.name, arguments: acceptsInput ? { input } : {}, applicationId: application.id, applicationName: application.name };
  });
}

function validateWav(bytes) {
  ensure(Array.isArray(bytes) && bytes.length > 44 && bytes.length <= MAX_AUDIO_BYTES &&
    bytes.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255), 'Audio invalide ou supérieur à 30 secondes.');
  const wav = Buffer.from(bytes);
  ensure(wav.toString('ascii', 0, 4) === 'RIFF' && wav.toString('ascii', 8, 12) === 'WAVE' &&
    wav.toString('ascii', 12, 16) === 'fmt ' && wav.readUInt32LE(16) === 16 && wav.readUInt16LE(20) === 1 &&
    wav.readUInt16LE(22) === 1 && wav.readUInt32LE(24) === 16000 && wav.readUInt32LE(28) === 32000 &&
    wav.readUInt16LE(32) === 2 && wav.readUInt16LE(34) === 16 && wav.toString('ascii', 36, 40) === 'data' &&
    wav.readUInt32LE(40) === wav.length - 44 && wav.readUInt32LE(4) === wav.length - 8 && (wav.length - 44) % 2 === 0,
    'Format attendu : WAV PCM 16 bits, mono, 16 kHz.');
  return wav;
}

function parseEngineOutput(stdout) {
  // Engine diagnostics may precede the JSON; never interpret diagnostics as calls.
  try { return JSON.parse(stdout.trim()); } catch {}
  for (const line of stdout.trim().split(/\r?\n/).reverse()) {
    try { const result = JSON.parse(line); if (result && typeof result === 'object') return result; } catch {}
  }
  throw new Error('Le moteur Needle n’a pas renvoyé de JSON valide.');
}

async function launch(application, args) {
  ensure((await fs.stat(application.executable)).isFile(), `Exécutable de ${application.name} introuvable.`);
  const argv = application.arguments.map(argument => argument.replaceAll('{input}', args.input ?? ''));
  await new Promise((resolve, reject) => {
    const child = spawn(application.executable, argv, { shell: false, windowsHide: true, detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
  return { applicationName: application.name, success: true, message: `${application.name} lancé.` };
}

function createAssistant({ runtimeDirectory, configDirectory, runEngine = executeFile, launchApplication = launch, engine }) {
  const configPath = path.join(configDirectory, 'applications.json');
  const pendingDirectory = path.join(configDirectory, 'pending');
  async function executeCalls(calls, config) {
    // Validate the whole plan before any executable is launched.
    const validated = validateCalls(calls, config);
    const results = [];
    for (const call of validated) {
      const application = config.applications.find(app => app.id === call.applicationId);
      try { results.push(await launchApplication(application, call.arguments)); }
      catch (error) { results.push({ applicationName: application.name, success: false, message: error.message }); }
    }
    return results;
  }
  return async function handle(method, payload = {}) {
    const config = await readConfig(configDirectory);
    try {
      for (const name of await fs.readdir(pendingDirectory)) {
        if (!/^[0-9a-f-]{36}\.json$/.test(name)) continue;
        const file = path.join(pendingDirectory, name);
        const metadata = await fs.stat(file);
        if (Date.now() - metadata.mtimeMs >= 10 * 60_000) await fs.unlink(file);
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (method === 'status') {
      const files = ['needle.exe', 'models/needle3.cact', 'models/whistle.cact', 'npm/bin/npm-cli.js', 'libneedle3.dll', 'ffi/node_modules/@koromix/koffi-win32-x64/win32_x64/koffi.node'];
      const checks = await Promise.all(files.map(async file => {
        try { return { file, available: (await fs.stat(path.join(runtimeDirectory, file))).isFile() }; }
        catch { return { file, available: false }; }
      }));
      let manifest = null;
      try { manifest = JSON.parse(await fs.readFile(path.join(runtimeDirectory, 'manifest.json'), 'utf8')); } catch {}
      const ready = checks.every(check => check.available);
      if (ready && engine) await engine.warm();
      return { ready, checks, manifest, config, configDirectory, engine: engine?.status() ?? null };
    }
    if (method === 'restart_engine') {
      ensure(engine, 'Le moteur persistant est indisponible.');
      await engine.close(); await engine.warm();
      return engine.status();
    }
    if (method === 'save_application') {
      const id = payload.id;
      ensure(id === undefined || config.applications.some(app => app.id === id), 'Application à modifier introuvable.');
      const application = await validateApplication(payload, id);
      ensure(!config.applications.some(app => app.id !== application.id && app.name.toLowerCase() === application.name.toLowerCase()), 'Ce nom est déjà utilisé.');
      ensure(id || config.applications.length < 32, '32 applications maximum pour ce prototype.');
      config.applications = [...config.applications.filter(app => app.id !== application.id), application];
      await atomicJson(configPath, config);
      return config;
    }
    if (method === 'delete_application') {
      ensure(config.applications.some(app => app.id === payload.id), 'Application introuvable.');
      config.applications = config.applications.filter(app => app.id !== payload.id);
      await atomicJson(configPath, config);
      return config;
    }
    if (method === 'settings') {
      ensure(LANGUAGES.has(payload.language), 'Langue invalide.');
      ensure(typeof payload.autoExecute === 'boolean', 'Préférence d’exécution invalide.');
      ensure(Number.isFinite(payload.confidenceThreshold) && payload.confidenceThreshold >= 0.1 && payload.confidenceThreshold <= 1, 'Seuil de confiance invalide.');
      Object.assign(config, { language: payload.language, autoExecute: payload.autoExecute, confidenceThreshold: payload.confidenceThreshold });
      await atomicJson(configPath, config);
      return config;
    }
    if (method === 'confirm' || method === 'discard') {
      ensure(typeof payload.id === 'string' && /^[0-9a-f-]{36}$/.test(payload.id), 'Identifiant de demande invalide.');
      const file = path.join(pendingDirectory, `${payload.id}.json`);
      const pending = JSON.parse(await fs.readFile(file, 'utf8'));
      // Consume before executing, so the same approval cannot launch twice.
      await fs.unlink(file);
      if (method === 'discard') return { status: 'cancelled' };
      ensure(Date.now() - pending.createdAt < 10 * 60_000, 'Cette demande a expiré. Relancez votre demande.');
      ensure(pending.configDigest === configDigest(config), 'Les applications ont changé. Relancez votre demande.');
      const results = await executeCalls(pending.calls, config);
      return { ...pending.turn, status: results.every(result => result.success) ? 'executed' : 'failed', results };
    }
    if (method === 'correct_request') {
      ensure(typeof payload.id === 'string' && /^[0-9a-f-]{36}$/.test(payload.id), 'Identifiant de demande invalide.');
      cleanText(payload.text, 'Demande corrigée', 2000);
      const app = payload.applicationId ? config.applications.find(app => app.id === payload.applicationId && app.enabled) : null;
      ensure(!payload.applicationId || app, 'Application corrigée introuvable ou désactivée.');
      ensure(payload.input === undefined || (app && app.arguments.some(arg => arg.includes('{input}')) && typeof payload.input === 'string' && payload.input.length <= 2048 && !payload.input.includes('\0')), 'Texte transmis invalide.');
      if (payload.saveAlias === true) {
        ensure(app, 'Choisissez une application pour enregistrer un alias.');
        const alias = cleanText(payload.alias, 'Alias', 40);
        const variants = labelVariants(alias);
        ensure(!config.applications.some(other => other.id !== app.id && [other.name, ...other.aliases].flatMap(labelVariants).some(label => variants.includes(label))), 'Cet alias désigne déjà une autre application.');
        if (![app.name, ...app.aliases].flatMap(labelVariants).some(label => variants.includes(label))) {
          ensure(app.aliases.length < 6, 'Six alias maximum par application.');
          app.aliases.push(alias); await atomicJson(configPath, config);
        }
      }
      // Retire the old approval before preparing a replacement, even if inference fails.
      try { await fs.unlink(path.join(pendingDirectory, `${payload.id}.json`)); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    ensure(method === 'process_text' || method === 'process_audio' || method === 'correct_request', 'Méthode inconnue.');
    const tools = toolsFor(config);
    ensure(tools.length > 0, 'Ajoutez et activez au moins une application avant de faire une demande.');
    await fs.mkdir(configDirectory, { recursive: true });
    const temporary = await fs.mkdtemp(path.join(configDirectory, 'turn-'));
    const startedAt = Date.now();
    async function infer(args) {
      // Both stages share the same budget, within the sidecar's 45s lifetime.
      const timeout = 40_000 - (Date.now() - startedAt);
      ensure(timeout > 0, 'Le moteur Cactus a dépassé le délai de 40 secondes.');
      const { stdout } = await runEngine(path.join(runtimeDirectory, 'needle.exe'), args, {
        timeout, maxBuffer: 1024 * 1024, windowsHide: true, encoding: 'utf8', shell: false,
        env: { ...process.env, NEEDLE_TELEMETRY: '0', DO_NOT_TRACK: '1' },
      });
      const response = parseEngineOutput(stdout);
      ensure(response.success !== false, response.error || 'Le moteur a refusé la demande.');
      return response;
    }
    try {
      let transcript = '';
      let language = config.language;
      let speechArgs = null;
      if (method === 'process_audio') {
        const audioPath = path.join(temporary, 'clip.wav');
        await fs.writeFile(audioPath, validateWav(payload.audio));
        const keywordsPath = path.join(temporary, 'keywords.txt');
        await fs.writeFile(keywordsPath, config.applications.filter(app => app.enabled).flatMap(app => [app.name, ...app.aliases]).join('\n'));
        speechArgs = ['--model', path.join(runtimeDirectory, 'models/whistle.cact'), '--audio', audioPath,
          '--audio-keywords', keywordsPath];
        if (config.language !== 'auto') speechArgs.push('--audio-language', config.language);
        const speech = await infer(speechArgs);
        ensure(typeof speech.text === 'string', 'Le moteur n’a pas renvoyé la transcription Whistle.');
        ensure(speech.text.length <= 2000 && !speech.text.includes('\0'), 'Transcription Whistle invalide.');
        transcript = speech.text.trim();
        if (LANGUAGES.has(speech.language) && speech.language !== 'auto') language = speech.language;
      } else transcript = cleanText(payload.text, 'Demande', 2000);
      const turn = { id: randomUUID(), transcript, language, confidence: null, reasoning: '',
        durationMs: Date.now() - startedAt, calls: [], results: [], status: 'unsupported' };
      if (!transcript) return { ...turn, status: 'silence' };
      let { prompt, requestTools } = resolveInvocation(transcript, tools, config);
      if (method === 'correct_request' && payload.applicationId) {
        const app = config.applications.find(app => app.id === payload.applicationId);
        requestTools = tools.filter(tool => tool.name === toolName(app));
        // The selected application is an explicit user correction. Preserve any
        // free-form input in a separate, user-editable field instead of inferring it.
        prompt = `Ouvre ${labelVariants(app.name).at(-1)}`;
      }
      const toolsPath = path.join(temporary, 'tools.json');
      const systemPath = path.join(temporary, 'system.txt');
      await fs.writeFile(toolsPath, JSON.stringify(requestTools));
      await fs.writeFile(systemPath, `locale: ${language}\nplatform: Windows\nOnly open registered applications. Input values must come from the user's request.\n`);
      const needleArgs = ['--model', path.join(runtimeDirectory, 'models/needle3.cact'), '--tools', toolsPath,
        '--system', systemPath, '--max', '256', '--fail-input-overflow'];
      // The Windows runner's narrow --prompt argv loses non-ASCII characters.
      // Preserve free-form speech and input values by passing the WAV directly
      // when the resolved prompt still needs Unicode. Canonical ASCII names
      // take the same text path as typed requests.
      const useAudioTransport = speechArgs && !runEngine.unicode && /[^\x00-\x7f]/.test(prompt);
      if (useAudioTransport) needleArgs.push(...speechArgs);
      else needleArgs.push('--prompt', prompt);
      const response = await infer(needleArgs);
      if (useAudioTransport) {
        ensure(typeof response.audio_text === 'string', 'Le moteur n’a pas renvoyé la transcription Whistle.');
        ensure(response.audio_text.length <= 2000 && !response.audio_text.includes('\0'), 'Transcription Whistle invalide.');
        turn.transcript = response.audio_text.trim();
        if (LANGUAGES.has(response.audio_language) && response.audio_language !== 'auto') turn.language = response.audio_language;
        if (!turn.transcript) return { ...turn, status: 'silence', durationMs: Date.now() - startedAt };
      }
      const confidence = typeof response.confidence === 'number' && Number.isFinite(response.confidence) &&
        response.confidence >= 0 && response.confidence <= 1 ? response.confidence : null;
      turn.confidence = confidence;
      turn.reasoning = typeof response.reasoning === 'string' ? response.reasoning : '';
      turn.durationMs = Date.now() - startedAt;
      ensure(Array.isArray(response.function_calls), 'Réponse Needle invalide : function_calls manquant.');
      const suppressed = response.function_calls.length === 0 && Array.isArray(response.suppressed_calls) && response.suppressed_calls.length > 0;
      const calls = suppressed ? response.suppressed_calls : response.function_calls;
      if (calls.length === 0) return turn;
      turn.calls = validateCalls(calls, config);
      ensure(turn.calls.every(call => requestTools.some(tool => tool.name === call.name)),
        'Needle a proposé une application différente de celle demandée.');
      if (method === 'correct_request') {
        turn.correctedFrom = payload.id;
        if (payload.applicationId) {
          const app = config.applications.find(app => app.id === payload.applicationId);
          const acceptsInput = app.arguments.some(arg => arg.includes('{input}'));
          ensure(payload.input === undefined || (acceptsInput && typeof payload.input === 'string' && payload.input.length <= 2048 && !payload.input.includes('\0')), 'Texte transmis invalide.');
          turn.calls = validateCalls([{ name: toolName(app), arguments: acceptsInput ? { input: payload.input ?? '' } : {} }], config);
        }
      }
      const ungrounded = Array.isArray(response.validation?.ungrounded) && response.validation.ungrounded.length > 0;
      if (method !== 'correct_request' && config.autoExecute && !suppressed && !ungrounded && confidence !== null && confidence >= config.confidenceThreshold) {
        turn.results = await executeCalls(turn.calls, config);
        turn.status = turn.results.every(result => result.success) ? 'executed' : 'failed';
      } else {
        turn.status = 'pending';
        await atomicJson(path.join(pendingDirectory, `${turn.id}.json`), {
          createdAt: Date.now(), configDigest: configDigest(config), calls: turn.calls, turn,
        });
      }
      return turn;
    } finally {
      ensure(path.resolve(temporary).startsWith(path.resolve(configDirectory) + path.sep) &&
        path.basename(temporary).startsWith('turn-'), 'Dossier temporaire hors de la configuration.');
      await fs.rm(temporary, { recursive: true, force: true });
    }
  };
}

module.exports = { createAssistant, validateCalls, validateWav, toolsFor, parseEngineOutput, toolName, DEFAULT_CONFIG };
