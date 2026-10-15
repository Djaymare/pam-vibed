const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const executeFile = promisify(execFile);
const { createMedia, MEDIA_ACTIONS } = require('./media.cjs');
const { DEEZER_APP_ID, DEEZER_SOURCE_IDS, CONTENT, PAGES, validateDeezerArgs } = require('./deezer.cjs');
const { needleToolName, needleTools, canonicalPrompt, requestIssue } = require('./needle-tools.cjs');
const { ACTIONS: ALIAS_ACTIONS, findCommandAlias, saveCommandAlias } = require('./command-aliases.cjs');
const {recognizeDeezerCommand,deezerCommandIssue,deezerActionLabel} = require('./deezer-commands.cjs');
const {resolveMediaCommand} = require('./media-commands.cjs');
const { createTemporaryFiles } = require('./temporary-files.cjs');
const { createBudget, interruptedTurn } = require('./budget.cjs');
const { executionStore } = require('./execution.cjs');
const { proposalStore } = require('./proposals.cjs');
const { requestId, failure, annotate, maskMessage } = require('./diagnostics.cjs');

const { validateConfig, validateApplicationStructure, LANGUAGES, DEFAULT_CONFIG } = require('./config-schema.cjs');
const { createConfigStore } = require('./config-store.cjs');
const MAX_AUDIO_BYTES = 44 + 16_000 * 30 * 2;

function ensure(condition, message) { if (!condition) throw new Error(message); }
function cleanText(value, label, max = 200) {
  ensure(typeof value === 'string' && value.trim().length > 0 && value.length <= max && !value.includes('\0'), `${label} invalide.`);
  return value.trim();
}
function configDigest(config) {
  const hash=createHash('sha256').update(JSON.stringify(config.applications));
  if(config.commandAliases?.length)hash.update(JSON.stringify(config.commandAliases));
  return hash.digest('hex');
}
async function validateApplication(value, existingId, checkAvailability = true) {
  const application = validateApplicationStructure(value, existingId);
  if (checkAvailability) {
    const available = await applicationAvailability(application);
    ensure(available.available, available.reason);
  }
  return application;
}
async function applicationAvailability(application) {
  try { if ((await fs.stat(application.executable)).isFile()) return { available: true }; } catch {}
  return { available: false, reason: 'Exécutable indisponible. Réparez le chemin ou choisissez une autre application.' };
}

function toolName(application) {
  const readable = application.name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'application';
  return `open_${readable}_${application.id.slice(0, 8)}`;
}
function actionToolName(application, action) { return action === 'open' ? toolName(application) : `${action}_${toolName(application).slice(5)}`; }
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
function toolsFor(config, sessions) {
  const applications = config.applications.filter(app => app.enabled);
  return applications.flatMap(app => {
    const base = {
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
    };
    const extra = [];
    const add = (action,description,properties = {},required = []) => extra.push({
      name:actionToolName(app,action), action, applicationId:app.id, actionLabel:description,
      description:`${description} dans ${app.name}. ${app.aliases.length ? `Autres noms : ${app.aliases.join(', ')}.` : ''}`,
      triggers:mediaTriggers(app,applications,action), parameters:{type:'object',properties,required,additionalProperties:false},
    });
    if (app.media?.sourceAppId) {
      const matching = sessions?.filter(s => s.sourceAppId?.toLowerCase() === app.media.sourceAppId.toLowerCase());
      for (const [action,label] of Object.entries(MEDIA_ACTIONS)) {
        if (sessions !== undefined && (matching.length !== 1 || matching[0].error || matching[0].capabilities?.[action] !== true)) continue;
        add(`media_${action}`,label + (action === 'next' ? ' déjà présente dans la file' : ''));
      }
      if (app.media.deezer && app.windowsApp?.appId === DEEZER_APP_ID) {
        add('deezer_content','Afficher un contenu Deezer par identifiant, sans démarrer la lecture ni modifier la file',{
          kind:{type:'string',enum:CONTENT,description:'Type du contenu.'},id:{type:'string',pattern:'^[1-9][0-9]{0,18}$',description:'Identifiant numérique explicitement fourni par l’utilisateur. Ne jamais inventer un identifiant.'}},['kind','id']);
        add('deezer_search','Rechercher une chanson, un artiste ou un contenu Deezer par son nom ; affiche les résultats, sans lancer de lecture',{
          query:{type:'string',maxLength:200,description:'Titre, artiste ou recherche explicitement demandé.'}},['query']);
        add('deezer_page','Afficher une page Deezer', {page:{type:'string',enum:PAGES}},['page']);
        add('deezer_reload','Recharger Deezer Music');
        add('deezer_start','Démarrer Flow ou les coups de cœur Deezer, sans sélectionner une chanson précise', {mix:{type:'string',enum:['flow','loved_tracks']}},['mix']);
        add('deezer_smarttracklist','Afficher ou demander la lecture d’une sélection smarttracklist Deezer, dont l’identifiant doit être fourni explicitement',{
          id:{type:'string',pattern:'^[A-Za-z0-9_-]{1,80}$',description:'Identifiant de sélection fourni par l’utilisateur, jamais un titre de chanson.'},
          mode:{type:'string',enum:['display','play']}},['id','mode']);
      }
    }
    return [{...base,action:'open',applicationId:app.id,actionLabel:'Ouvrir'},...extra];
  });
}
function matchedInvocation(transcript, tools, config,mediaCommand) {
  const alias=findCommandAlias(transcript,config);
  const media=mediaCommand || resolveMediaCommand(transcript,config);
  const known=alias || recognizeDeezerCommand(transcript,config) || (media.applicationId && !media.issue ? media : null);
  if(known)return tools.filter(tool=>tool.applicationId===known.applicationId && tool.action===known.action)
    .map(tool=>tool.action.startsWith('deezer_') ? {...tool,boundArguments:known.arguments || {}} : tool);
  return tools.filter(tool => !tool.action.startsWith('deezer_') && tool.triggers.some(pattern => new RegExp(pattern, 'i').test(transcript)));
}
function resolveInvocation(transcript, tools, config,mediaCommand) {
  // Text and speech share this resolution. Only rewrite a literal, unambiguous
  // application invocation; keep compound requests and their arguments intact.
  const matched = matchedInvocation(transcript,tools,config,mediaCommand);
  if (matched.length !== 1) return { prompt: transcript, requestTools: tools };
  const application = config.applications.find(app => app.id === matched[0].applicationId);
  if(findCommandAlias(transcript,config) && matched[0].action==='open' && application.arguments.some(argument=>argument.includes('{input}')))
    return {prompt:transcript,requestTools:matched,singleAction:true};
  if (matched[0].action.startsWith('deezer_') && !matched[0].boundArguments) return {prompt:transcript,requestTools:matched};
  return { prompt: canonicalPrompt(matched[0], application), requestTools: matched, singleAction:true };
}
function validateCardinality(transcript, calls, tools, singleAction) {
  // Quoted/input text cannot authorize extra effects. Repetitions are grounded
  // in literal opening clauses, never in the model's confidence or reasoning.
  const command = transcript.replace(/«[^»]*»|"[^"]*"|“[^”]*”/gu, ' ')
    .split(/\b(?:avec\s+(?:le\s+)?texte|with\s+(?:the\s+)?text)\b/iu)[0];
  const clauses = command.split(/\s+(?:et|puis|and|then)\s+|[;,]/iu).filter(clause=>clause.trim());
  const words = {une:1,un:1,deux:2,trois:3,quatre:4,cinq:5,six:6,sept:7,huit:8,
    one:1,two:2,three:3,four:4,five:5,seven:7,eight:8,once:1,twice:2};
  const repeatPattern = /\b(?:(une?|deux|trois|quatre|cinq|six|sept|huit|one|two|three|four|five|seven|eight|[1-8])\s+(?:fois|times?)|once|twice)\b/giu;
  const limits = new Map();
  let maxCalls = 0;
  for (const clause of clauses) {
    const repeats = [...clause.matchAll(repeatPattern)];
    const literal = clause.replace(repeatPattern,' ').replace(/\s+/g,' ').trim();
    const matched = tools.filter(tool=>tool.action==='open' && tool.triggers.some(pattern=>new RegExp(pattern,'i').test(literal)));
    // Unsupported repetition wording grants no additional allowance.
    const token = repeats.length===1 ? (repeats[0][1] || repeats[0][0]).toLowerCase() : '';
    const count = matched.length===1 && repeats.length===1 ? (words[token] || Number(token)) : 1;
    maxCalls += count;
    if(matched.length===1)limits.set(matched[0].applicationId,(limits.get(matched[0].applicationId)||0)+count);
  }
  ensure(calls.length <= (singleAction ? 1 : Math.max(1,maxCalls)),
    'Needle a proposé plusieurs appels pour une seule action ou un appel supplémentaire. Reformulez la demande.');
  const openings = new Map();
  for(const call of calls.filter(call=>!call.action || call.action==='open')) {
    const count=(openings.get(call.applicationId)||0)+1;
    ensure(count <= (limits.get(call.applicationId)||1),
      'Needle a proposé une ouverture supplémentaire sans répétition explicite. Reformulez la demande.');
    openings.set(call.applicationId,count);
  }
  for(const [applicationId,count] of limits) {
    ensure(count<=1 || openings.get(applicationId)===count,
      'Needle n’a pas respecté le nombre d’ouvertures explicitement demandé. Reformulez la demande.');
  }
}
function mediaTriggers(application, applications, action) {
  const phrases = {
    media_play:'(?:lecture|play|joue|reprends(?:\\s+la\\s+lecture)?)',
    media_pause:'(?:pause|mets\\s+en\\s+pause|mettre\\s+en\\s+pause)',
    media_next:'(?:(?:passe\\s+(?:[aà]\\s+)?(?:la\\s+)?)?(?:piste|chanson|morceau)\\s+suivant[e]?)',
    media_previous:'(?:(?:passe\\s+(?:[aà]\\s+)?(?:la\\s+)?)?(?:piste|chanson|morceau)\\s+pr[eé]c[eé]dent[e]?)',
    media_stop:'(?:arr[eê]te|stop)',
    media_toggle:'(?:bascule[r]?(?:\\s+(?:la\\s+)?lecture\\s*[/ ]\\s*pause)?|lecture\\s*/\\s*pause)',
    deezer_content:"(?:affiche[r]?|ouvre|ouvrir)\\s+(?:(?:la|le|un|une|l['’])\\s*)?(?:chanson|titre|track|album|artiste|artist|playlist|podcast|show|[ée]pisode|episode|profil|profile)\\s+[1-9][0-9]{0,18}",
    deezer_search:'(?:cherche[r]?|recherche[r]?)\\s+.+',
    deezer_start:'(?:d[eé]marre[r]?|lance[r]?|joue|[ée]coute[r]?|lis|lire)\\s+(?:(?:le|les|mes)\\s+)?(?:flow|coups\\s+de\\s+c(?:œur|oeur))',
    deezer_reload:'(?:recharge[r]?|reload)',
  };
  if (!phrases[action]) return [];
  const labels = [...new Set([application.name,...application.aliases].flatMap(labelVariants))]
    .filter(label => !applications.some(other => other.id !== application.id && [other.name,...other.aliases].flatMap(labelVariants).includes(label)));
  if (!labels.length) return [];
  const names = labels.map(label=>label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/ /g,'\\s+')).join('|');
  return [`^\\s*${phrases[action]}\\s+(?:(?:dans|sur|de)\\s+)?(?:${names})\\s*[.!?]*\\s*$`];
}

function validateCalls(calls, config) {
  ensure(Array.isArray(calls) && calls.length > 0 && calls.length <= 8, 'Liste d’appels invalide (8 maximum).');
  return calls.map(call => {
    const tool = toolsFor(config).find(tool => tool.name === call.name);
    const application = config.applications.find(app => app.enabled && app.id === tool?.applicationId);
    ensure(application, `Needle a proposé un outil inconnu ou désactivé : ${call.name}.`);
    const args = call.arguments;
    ensure(args && typeof args === 'object' && !Array.isArray(args), 'Arguments de l’outil invalides.');
    if (tool.action !== 'open') {
      let arguments_;
      if (tool.action.startsWith('media_')) { ensure(Object.keys(args).length === 0, 'La commande multimédia n’accepte aucun argument.'); arguments_ = {}; }
      else arguments_ = validateDeezerArgs(tool.action,args);
      return {name:call.name,arguments:arguments_,applicationId:application.id,applicationName:application.name,action:tool.action,actionLabel:deezerActionLabel(tool.action,arguments_) || tool.actionLabel};
    }
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

async function launch(application, args, { budget, beforeEffect } = {}) {
  ensure(!application.windowsApp, 'Le lancement d’une application du catalogue Windows nécessite l’hôte natif de PAM pour vérifier sa disponibilité.');
  ensure((await fs.stat(application.executable)).isFile(), `Exécutable de ${application.name} introuvable.`);
  const argv = application.arguments.map(argument => argument.replaceAll('{input}', args.input ?? ''));
  await beforeEffect?.();
  budget?.check('lancement');
  await new Promise((resolve, reject) => {
    const child = spawn(application.executable, argv, { shell: false, windowsHide: true, detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
  return { applicationName: application.name, success: true, message: `${application.name} lancé.` };
}

function createAssistant({ runtimeDirectory, configDirectory, runEngine = executeFile, launchApplication = launch, engine, media = createMedia(), now, proposalNow = Date.now, setTimer, clearTimer, budgetMs = 40_000 }) {
  const temporaryFiles = createTemporaryFiles(configDirectory);
  const profiles = createConfigStore(configDirectory);
  const proposals = proposalStore(configDirectory, { now: proposalNow });
  let startupCleanup = proposals.initialize().then(() => temporaryFiles.collect());
  const executions = executionStore(configDirectory);
  async function executeCalls(turn, config, context) {
    // Validate the whole plan before any executable is launched.
    const validated = validateCalls(turn.calls, config);
    const { budget, onProgress = () => {} } = context;
    turn.results = validated.map((call, index) => ({index, name:call.name, applicationId:call.applicationId, applicationName:call.applicationName,
      outcome:'not_started', success:false, message:'Action non démarrée.'}));
    const publish = async (complete = false) => {
      await executions.save(turn, complete);
      onProgress(structuredClone(turn));
    };
    await publish();
    for (const [index, call] of validated.entries()) {
      if (budget.remaining() <= 0) break;
      const application = config.applications.find(app => app.id === call.applicationId);
      let emitted = false;
      const beforeEffect = async () => {
        budget.check('avant effet');
        turn.results[index] = {...turn.results[index],outcome:'unknown',message:'Commande émise ; résultat non confirmé.'};
        // Persist intent before emission. A crash between these steps is
        // conservatively unknown and never grants permission to replay.
        await publish();
        budget.check('avant effet');
        emitted = true;
      };
      try {
        const result = await budget.run(() => call.action && call.action !== 'open'
          ? media.execute(application,call.action,call.arguments,{budget,beforeEffect})
          : launchApplication(application,call.arguments,{budget,beforeEffect}), 'exécution');
        if (!result.success) {
          const diagnostic=failure(new Error(result.message),context,'action_failure');
          result.message=diagnostic.message; result.error=diagnostic;
        }
        turn.results[index] = {...turn.results[index],...result,outcome:result.success ? 'performed' : 'failed'};
      } catch (error) {
        const timedOut = error.code === 'budget_expired' || error.outcome === 'unknown';
        const diagnostic = failure(error, context, 'action_failure', timedOut ? 'host' : 'target');
        turn.results[index] = {...turn.results[index],success:false,
          outcome:timedOut ? (emitted ? 'unknown' : 'not_started') : 'failed',message:diagnostic.message,error:diagnostic};
      }
      await publish();
      if (budget.remaining() <= 0 || turn.results[index].outcome === 'unknown') break;
    }
    turn.status = turn.results.every(result=>result.outcome==='performed') ? 'executed'
      : turn.results.some(result=>['unknown','not_started'].includes(result.outcome)) ? 'partial' : 'failed';
    turn.durationMs = budget.elapsed();
    if (turn.status==='partial') turn.message='La demande s’est arrêtée avant confirmation de toutes les actions. Vérifiez les résultats avant de reformuler.';
    await publish(true);
    return turn;
  }
  async function handle(method, payload, context) {
    const { budget } = context;
    await budget.run(() => startupCleanup, 'nettoyage initial');
    startupCleanup = null;
    const temporaryCleanup = await budget.run(() => temporaryFiles.collect(), 'nettoyage');
    if (method === 'export_config') return budget.run(() => profiles.exportConfig(), 'export du profil');
    if (method === 'preview_import') return budget.run(() => profiles.previewImport(payload.content), 'aperçu du profil');
    if (method === 'recover_config' || method === 'import_config') {
      const options = { budget, beforeReplace: () => proposals.reconcile(null) };
      const result = await budget.run(() => method === 'recover_config' ? profiles.recover(payload, options) : profiles.importConfig(payload, options), 'remplacement du profil');
      return result;
    }
    let config, configError, loadedFingerprint, profileDiagnostic;
    try { ({ config, fingerprint: loadedFingerprint } = await budget.run(() => profiles.readState(), 'configuration')); }
    catch (error) {
      if (method !== 'status' || error.code !== 'invalid_profile') throw error;
      const diagnostic = failure(error,context,'invalid_profile','profile');
      config = structuredClone(DEFAULT_CONFIG); configError = {...error.details,message:maskMessage(error.details.message)}; profileDiagnostic=diagnostic;
    }
    const saveConfig = async value => {
      const validated = validateConfig(value);
      await profiles.write(validated, { budget, expectedFingerprint: loadedFingerprint });
      await proposals.reconcile(configDigest(validated));
    };
    if (method === 'status') {
      const files = ['needle.exe', 'models/needle3.cact', 'models/whistle.cact', 'npm/bin/npm-cli.js', 'libneedle3.dll', 'ffi/node_modules/@koromix/koffi-win32-x64/win32_x64/koffi.node'];
      const checks = await Promise.all(files.map(async file => {
        try { return { file, available: (await fs.stat(path.join(runtimeDirectory, file))).isFile() }; }
        catch { return { file, available: false }; }
      }));
      let manifest = null;
      try { manifest = JSON.parse(await fs.readFile(path.join(runtimeDirectory, 'manifest.json'), 'utf8')); } catch {}
      const ready = !configError && checks.every(check => check.available);
      if (ready && engine) {
        try { await budget.run(() => engine.warm({timeout:budget.timeout()}), 'chargement des moteurs'); }
        catch(error) { throw annotate(error,context,'model_failure','inference'); }
      }
      const applicationAvailabilityEntries = await Promise.all(config.applications.map(async app => [app.id, await applicationAvailability(app)]));
      return { ready, checks, manifest, config, profileBackup: await profiles.recoveryInfo().catch(() => null), proposals: await proposals.reconcile(configError ? null : configDigest(config)), applicationAvailability: Object.fromEntries(applicationAvailabilityEntries), configDirectory, ...(configError ? { configError, error:profileDiagnostic } : {}), temporaryCleanup, engine: engine?.status() ?? null };
    }
    if (method === 'restart_engine') {
      ensure(engine, 'Le moteur persistant est indisponible.');
      await engine.close();
      try { await budget.run(() => engine.warm({timeout:budget.timeout()}), 'chargement des moteurs'); }
      catch(error) { throw annotate(error,context,'model_failure','inference'); }
      return engine.status();
    }
    if (method === 'media_sessions') return budget.run(() => media.sessions({budget}), 'sessions');
    if (method === 'prepare_action') {
      // A user click creates the same one-shot confirmation as a model proposal.
      const app = config.applications.find(app => app.id === payload.applicationId && app.enabled);
      ensure(app, 'Application introuvable ou désactivée.');
      const calls = validateCalls([{name:actionToolName(app,payload.action),arguments:payload.arguments ?? {}}],config);
      const turn = {id:randomUUID(),transcript:payload.label === undefined ? (calls[0].actionLabel || `Ouvrir ${app.name}`) : cleanText(payload.label,'Libellé de l’action',2000),language:config.language,
        confidence:null,reasoning:'Action choisie explicitement.',durationMs:0,calls,results:[],status:'pending'};
      return proposals.prepare(turn, configDigest(config));
    }
    if (method === 'set_application_enabled') {
      ensure(typeof payload.enabled === 'boolean', 'État de l’application invalide.');
      const application = config.applications.find(app => app.id === payload.id);
      ensure(application, 'Application à modifier introuvable.');
      if (payload.enabled) await validateApplication(application, application.id);
      application.enabled = payload.enabled;
      await saveConfig(config);
      return config;
    }
    if (method === 'save_application') {
      const id = payload.id;
      ensure(id === undefined || config.applications.some(app => app.id === id), 'Application à modifier introuvable.');
      const previous = config.applications.find(app => app.id === id);
      const application = validateApplicationStructure(payload, id);
      ensure(!config.applications.some(app => app.id !== application.id && app.name.toLowerCase() === application.name.toLowerCase()), 'Ce nom est déjà utilisé.');
      ensure(!application.windowsApp || !config.applications.some(app => app.id !== application.id &&
        app.windowsApp?.appId.toLowerCase() === application.windowsApp.appId.toLowerCase()), 'Cette application Windows est déjà ajoutée.');
      ensure(id || config.applications.length < 32, '32 applications maximum pour ce prototype.');
      config.applications = [...config.applications.filter(app => app.id !== application.id), application];
      // Reference/schema errors retain PAM-05's deterministic precedence.
      validateConfig(config);
      if (!previous || payload.enabled || previous.executable !== payload.executable) await validateApplication(application, application.id);
      await saveConfig(config);
      return config;
    }
    if (method === 'test_application') {
      // Explicit user action on a draft. No inference, registration or approval
      // creation, and no arbitrary input from Needle is accepted here.
      const application = await validateApplication({ ...payload, description: payload.description?.trim() || 'Tester le lancement.' });
      const needsInput = application.arguments.some(argument => argument.includes('{input}'));
      ensure(payload.input === undefined || (typeof payload.input === 'string' && payload.input.length <= 2048 && !payload.input.includes('\0')), 'Texte du test invalide.');
      ensure(!needsInput || payload.input?.trim(), 'Renseignez le texte, le fichier ou l’URL à transmettre pour le test.');
      try {
        const result = await budget.run(() => launchApplication(application, needsInput ? { input: payload.input } : {}, {budget}), 'test de lancement');
        return { ...result, message: `Commande de lancement envoyée à ${application.name}. Vérifiez que l’application s’est ouverte.` };
      } catch (error) { const diagnostic=failure(error,context,'action_failure'); return { applicationName: application.name, success: false, message: diagnostic.message,error:diagnostic }; }
    }
    if (method === 'delete_application') {
      ensure(config.applications.some(app => app.id === payload.id), 'Application introuvable.');
      config.applications = config.applications.filter(app => app.id !== payload.id);
      config.commandAliases=config.commandAliases.filter(alias=>alias.applicationId!==payload.id);
      await saveConfig(config);
      return config;
    }
    if (method === 'save_command_alias') {
      saveCommandAlias(payload,config,toolsFor(config));
      await saveConfig(config);
      return config;
    }
    if (method === 'delete_command_alias') {
      ensure(config.commandAliases.some(alias=>alias.id===payload.id),'Formulation introuvable.');
      config.commandAliases=config.commandAliases.filter(alias=>alias.id!==payload.id);
      await saveConfig(config);
      return config;
    }
    if (method === 'settings') {
      ensure(LANGUAGES.has(payload.language), 'Langue invalide.');
      ensure(typeof payload.autoExecute === 'boolean', 'Préférence d’exécution invalide.');
      ensure(Number.isFinite(payload.confidenceThreshold) && payload.confidenceThreshold >= 0.1 && payload.confidenceThreshold <= 1, 'Seuil de confiance invalide.');
      Object.assign(config, { language: payload.language, autoExecute: payload.autoExecute, confidenceThreshold: payload.confidenceThreshold });
      await saveConfig(config);
      return config;
    }
    if (method === 'confirm' || method === 'discard') {
      ensure(typeof payload.id === 'string' && /^[0-9a-f-]{36}$/.test(payload.id), 'Identifiant de demande invalide.');
      if (method === 'confirm') {
        const previous = await executions.read(payload.id);
        if (previous) {
          return previous.status === 'partial' ? previous : { ...previous, status: 'consumed', message: 'Cette confirmation a déjà été consommée. Aucun rejeu autorisé.' };
        }
      }
      const claimed = await proposals.claim(payload.id, configDigest(config), method === 'confirm');
      if (!claimed.executable) return claimed.turn;
      delete claimed.turn.message;
      return executeCalls(claimed.turn, config, context);
    }
    if (method === 'correct_request') {
      ensure(typeof payload.id === 'string' && /^[0-9a-f-]{36}$/.test(payload.id), 'Identifiant de demande invalide.');
      cleanText(payload.text, 'Demande corrigée', 2000);
      const app = payload.applicationId ? config.applications.find(app => app.id === payload.applicationId && app.enabled) : null;
      ensure(!payload.applicationId || app, 'Application corrigée introuvable ou désactivée.');
      let chosenCalls;
      if(payload.action!==undefined) {
        ensure(app && ALIAS_ACTIONS.has(payload.action),'Choisissez une application et une action de lancement ou de lecture.');
        chosenCalls=validateCalls([{name:actionToolName(app,payload.action),arguments:payload.action==='open' && app.arguments.some(arg=>arg.includes('{input}')) ? {input:payload.input ?? ''} : payload.arguments ?? {}}],config);
      }
      ensure(payload.input === undefined || (app && app.arguments.some(arg => arg.includes('{input}')) && typeof payload.input === 'string' && payload.input.length <= 2048 && !payload.input.includes('\0')), 'Texte transmis invalide.');
      if (payload.saveAlias === true) {
        ensure(app, 'Choisissez une application pour enregistrer un alias.');
        const alias = cleanText(payload.alias, 'Alias', 40);
        const variants = labelVariants(alias);
        ensure(!config.applications.some(other => other.id !== app.id && [other.name, ...other.aliases].flatMap(labelVariants).some(label => variants.includes(label))), 'Cet alias désigne déjà une autre application.');
        if (![app.name, ...app.aliases].flatMap(labelVariants).some(label => variants.includes(label))) {
          ensure(app.aliases.length < 6, 'Six alias maximum par application.');
          app.aliases.push(alias);
        }
      }
      if(payload.saveCommandAlias===true) {
        ensure(chosenCalls,'Choisissez explicitement l’action à mémoriser.');
        saveCommandAlias({phrase:payload.commandPhrase,applicationId:app.id,action:payload.action,...(payload.action.startsWith('deezer_')?{arguments:payload.arguments ?? {}}:{})},config,toolsFor(config));
      }
      if(payload.saveAlias===true || payload.saveCommandAlias===true)await saveConfig(config);
      // Retire the old approval before preparing a replacement, even if inference fails.
      await proposals.invalidate(payload.id);
      if(chosenCalls) {
        const turn={id:randomUUID(),transcript:payload.text.trim(),language:config.language,confidence:null,reasoning:'Action choisie explicitement dans la correction.',
          durationMs:0,calls:chosenCalls,results:[],status:'pending',correctedFrom:payload.id};
        return proposals.prepare(turn, configDigest(config));
      }
    }
    ensure(method === 'process_text' || method === 'process_audio' || method === 'correct_request', 'Méthode inconnue.');
    let sessions;
    if (config.applications.some(app => app.enabled && app.media)) {
      try { sessions = await budget.run(() => media.sessions({budget}), 'sessions'); }
      catch (error) { if(error.code==='budget_expired')throw error; sessions = []; }
    }
    const tools = toolsFor(config,sessions);
    ensure(tools.length > 0, 'Ajoutez et activez au moins une application avant de faire une demande.');
    await fs.mkdir(configDirectory, { recursive: true });
    const lease = await temporaryFiles.createTurn();
    const temporary = lease.directory;
    async function infer(args) {
      try {
      const timeout = budget.timeout();
      const { stdout } = await budget.run(() => runEngine(path.join(runtimeDirectory, 'needle.exe'), args, {
        timeout, maxBuffer: 1024 * 1024, windowsHide: true, encoding: 'utf8', shell: false,
        env: { ...process.env, NEEDLE_TELEMETRY: '0', DO_NOT_TRACK: '1' },
      }), 'inférence');
      const response = parseEngineOutput(stdout);
      ensure(response.success !== false, response.error || 'Le moteur a refusé la demande.');
      return response;
      } catch(error) { throw annotate(error,context,'model_failure',args.includes('--audio') && !args.includes('--tools') ? 'transcription' : 'inference'); }
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
        durationMs: budget.elapsed(), calls: [], results: [], status: 'unsupported' };
      if (!transcript) return { ...turn, status: 'silence' };
      const alias=findCommandAlias(transcript,config);
      if(alias) {
        const target=config.applications.find(app=>app.id===alias.applicationId && app.enabled);
        if(!target)return {...turn,message:'L’application de cette formulation mémorisée est désactivée ou supprimée.'};
        if(!tools.some(tool=>tool.applicationId===alias.applicationId && tool.action===alias.action))
          return {...turn,message:'L’action mémorisée n’est pas disponible actuellement pour ce lecteur. Vérifiez sa session et ses capacités.'};
        turn.commandAliasId=alias.id;
      }
      if(!alias && !(method==='correct_request' && payload.applicationId)) {
        const issue=deezerCommandIssue(transcript,config);
        if(issue)return {...turn,message:issue};
      }
      const selectedApplicationId=method==='correct_request' ? payload.applicationId : undefined;
      const deezerApps = config.applications.filter(app => app.enabled && app.media?.deezer);
      const namedDeezer = deezerApps.some(app => [app.name,...app.aliases].flatMap(labelVariants).some(label =>
        new RegExp(`(?:^|[^\\p{L}\\p{N}])${label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?:$|[^\\p{L}\\p{N}])`,'iu').test(transcript)));
      if (namedDeezer && /(?:ajout|ins[eè]r|mets|mettre|programme).*?(?:file|queue|en\s+prochain|(?:jouer|lire|[ée]couter)\s+(?:ensuite|apr[eè]s))/iu.test(transcript))
        return {...turn,message:'Le protocole Deezer vérifié ne permet pas d’insérer une chanson précise en prochaine position. Choisissez cette action dans Deezer. « Piste suivante » lit le prochain élément déjà présent.'};
      if (namedDeezer && /(?:joue|jouer|lance|lancer|[ée]coute|[ée]couter|lis|lire|play)\s+(?:(?:la|le|une?|the)\s+)?(?:chanson|titre|morceau|piste|song|track)\s+(?!suivant|pr[eé]c[eé]dent|next|previous)/iu.test(transcript))
        return {...turn,message:'Le protocole Deezer vérifié peut afficher ou rechercher une chanson, mais ne permet pas d’en démarrer la lecture précise. Choisissez la lecture dans Deezer.'};
      const mediaCommand=!alias && !recognizeDeezerCommand(transcript,config) ? resolveMediaCommand(transcript,config,sessions || [],selectedApplicationId) : undefined;
      if(mediaCommand?.issue)return {...turn,message:mediaCommand.issue};
      const explicit = matchedInvocation(transcript,toolsFor(config),config,mediaCommand);
      if (!(method === 'correct_request' && payload.applicationId) && explicit.length === 1 && explicit[0].action.startsWith('media_') && !tools.some(tool => tool.name === explicit[0].name))
        return {...turn, message:'Le lecteur demandé ne propose actuellement pas cette commande. Vérifiez sa session et ses capacités dans Applications.'};
      let { prompt, requestTools, singleAction } = resolveInvocation(transcript, tools, config,mediaCommand);
      if (method === 'correct_request' && payload.applicationId) {
        const app = config.applications.find(app => app.id === payload.applicationId);
        requestTools = tools.filter(tool => tool.applicationId === app.id);
        // The selected application is an explicit user correction. Preserve any
        // free-form input in a separate, user-editable field instead of inferring it.
        if (explicit.length === 1 && (!explicit[0].action.startsWith('deezer_') || explicit[0].boundArguments)) {
          let selected = requestTools.find(tool => tool.action === explicit[0].action);
          if (!selected) return {...turn, message:'L’application choisie ne propose actuellement pas cette commande.'};
          if(explicit[0].boundArguments)selected={...selected,boundArguments:explicit[0].boundArguments};
          prompt = canonicalPrompt(selected, app);
          requestTools = [selected];
          singleAction = true;
        } else if (!app.media) {
          prompt = canonicalPrompt(tools.find(tool => tool.applicationId === app.id && tool.action === 'open'), app);
          singleAction = true;
        }
      }
      const toolsPath = path.join(temporary, 'tools.json');
      const systemPath = path.join(temporary, 'system.txt');
      const resolvedDeezer=requestTools.length===1 && !!requestTools[0].boundArguments;
      await fs.writeFile(toolsPath, JSON.stringify(needleTools(requestTools, config)));
      // Deezer bindings contain no model-generated parameters. The original
      // request, protocol limits and exact bound arguments are checked locally.
      await fs.writeFile(systemPath, resolvedDeezer ? 'locale: en\nOnly use registered tools.' :
        `locale: ${language}\nplatform: Windows\nOnly use registered tools. Input values must come from the user's request. A Deezer content or search link only displays a page, never starts a song or adds it next in the queue. Skip next plays the next item already in the queue, never inserts a requested song. Reject requests to play a specific song or queue it next when no tool offers that behavior.\n`);
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
        if (!turn.transcript) return { ...turn, status: 'silence', durationMs: budget.elapsed() };
      }
      const confidence = typeof response.confidence === 'number' && Number.isFinite(response.confidence) &&
        response.confidence >= 0 && response.confidence <= 1 ? response.confidence : null;
      turn.confidence = confidence;
      turn.reasoning = typeof response.reasoning === 'string' ? response.reasoning : '';
      turn.durationMs = budget.elapsed();
      ensure(Array.isArray(response.function_calls), 'Réponse Needle invalide : function_calls manquant.');
      const suppressed = response.function_calls.length === 0 && Array.isArray(response.suppressed_calls) && response.suppressed_calls.length > 0;
      const calls = suppressed ? response.suppressed_calls : response.function_calls;
      if (calls.length === 0) return turn;
      const modelNames = new Map([...toolsFor(config),...requestTools].map(tool => [needleToolName(tool, config), tool.name]));
      turn.calls = validateCalls(calls.map(call => {
        const name=modelNames.get(call.name) ?? call.name;
        const bound=requestTools.find(tool=>tool.name===name)?.boundArguments;
        if(bound)ensure(calls.length===1 && call.arguments && typeof call.arguments==='object' && !Array.isArray(call.arguments) && Object.keys(call.arguments).length===0,
          'Needle a modifié les paramètres d’une commande reconnue. Reformulez la demande.');
        return {...call,name,arguments:bound || call.arguments};
      }), config);
      ensure(turn.calls.every(call => requestTools.some(tool => tool.name === call.name)),
        'Needle a proposé une application différente de celle demandée.');
      const issue = requestIssue(transcript, config, turn.calls, selectedApplicationId,alias);
      if (issue) return {...turn, calls:[], message:issue};
      validateCardinality(transcript,turn.calls,tools,singleAction);
      if (turn.calls.some(call => ['deezer_content','deezer_search'].includes(call.action)) && /(?:^|\s)(?:joue|jouer|[ée]coute|[ée]couter|play)(?:\s|$)/iu.test(transcript)) {
        return {...turn,calls:[],message:'Le protocole Deezer vérifié peut afficher ou rechercher une chanson, mais ne permet pas d’en démarrer la lecture précise. Choisissez la lecture dans Deezer.'};
      }
      const simpleResume = deezerApps.some(app => mediaTriggers(app,config.applications,'media_play').some(pattern => new RegExp(pattern,'i').test(transcript)));
      if (namedDeezer && /^\s*(?:joue|jouer|[ée]coute|[ée]couter|play|lis|lire)\s/iu.test(transcript) && !simpleResume && !resolvedDeezer &&
        !/(?:repren|reprise|lecture|\bflow\b|coups?\s+de\s+c(?:œur|oeur)|smarttracklist)/iu.test(transcript) &&
        turn.calls.some(call => ['media_play','deezer_start'].includes(call.action)))
        return {...turn,calls:[],message:'Le protocole Deezer vérifié ne permet pas de jouer une chanson précise. Affichez sa page ou recherchez son titre, puis choisissez la lecture dans Deezer.'};
      for (const call of turn.calls.filter(call => call.action === 'deezer_start')) {
        const requested = call.arguments.mix === 'flow' ? /\bflow\b/iu : /coups?\s+de\s+c(?:œur|oeur)/iu;
        ensure(resolvedDeezer || requested.test(transcript),'La sélection Deezer proposée ne figure pas dans votre demande.');
      }
      for (const call of turn.calls.filter(call => ['deezer_content','deezer_smarttracklist'].includes(call.action))) {
        const id = call.arguments.id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
        ensure((alias?.arguments?.id === call.arguments.id && resolvedDeezer) || new RegExp(`(?:^|[^\\p{L}\\p{N}_-])${id}(?:$|[^\\p{L}\\p{N}_-])`,'u').test(transcript),
          'L’identifiant Deezer proposé ne figure pas dans votre demande. Fournissez un lien ou un identifiant, ou demandez une recherche par titre.');
      }
      if (method === 'correct_request') {
        turn.correctedFrom = payload.id;
        if (payload.applicationId && !config.applications.find(app => app.id === payload.applicationId).media) {
          const app = config.applications.find(app => app.id === payload.applicationId);
          const acceptsInput = app.arguments.some(arg => arg.includes('{input}'));
          ensure(payload.input === undefined || (acceptsInput && typeof payload.input === 'string' && payload.input.length <= 2048 && !payload.input.includes('\0')), 'Texte transmis invalide.');
          turn.calls = validateCalls([{ name: toolName(app), arguments: acceptsInput ? { input: payload.input ?? '' } : {} }], config);
        }
      }
      const ungrounded = Array.isArray(response.validation?.ungrounded) && response.validation.ungrounded.length > 0;
      if (method !== 'correct_request' && config.autoExecute && !suppressed && !ungrounded && confidence !== null && confidence >= config.confidenceThreshold) {
        await executeCalls(turn, config, context);
      } else {
        turn.status = 'pending';
        await proposals.prepare(turn, configDigest(config));
      }
      return turn;
    } finally {
      await lease.release();
    }
  }
  return async (method, payload = {}, context = {}) => {
    context = {...context,requestId:requestId(context.requestId)};
    const budget = context.budget || createBudget({milliseconds:budgetMs, ...(now ? {now} : {}), ...(setTimer ? {setTimer,clearTimer} : {})});
    try { return await handle(method,payload,{...context,budget}); }
    catch (error) {
      if(error.code!=='budget_expired')throw annotate(error,context);
      const diagnostic = failure(error,context);
      return {...interruptedTurn({id:randomUUID(),transcript:typeof payload.text==='string'?payload.text:'',language:'fr',confidence:null,
        reasoning:'',durationMs:budget.elapsed(),calls:[],results:[]},diagnostic.message),error:diagnostic};
    }
  };
}

module.exports = { createAssistant, validateCalls, validateWav, toolsFor, parseEngineOutput, toolName, actionToolName, DEFAULT_CONFIG };
