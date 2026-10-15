const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createAssistant, toolName, validateWav, toolsFor, DEFAULT_CONFIG } = require('./assistant.cjs');

const application = { id: '4cd496e0-d621-4f7c-b2c1-4b1bb17f03c9', name: 'Bloc-notes',
  description: 'Ouvrir l’éditeur de texte.', executable: 'C:\\Windows\\notepad.exe', arguments: [], aliases: ['Notepad'], enabled: true };
const call = { name: toolName(application), arguments: {} };
function wav() {
  const buffer = Buffer.alloc(44 + 32000);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVE', 8); buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16000, 24); buffer.writeUInt32LE(32000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(buffer.length - 44, 40); return Array.from(buffer);
}
async function fixture(t, response, overrides = {}, assistantOptions = {}) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'pam-test-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temporary).startsWith('pam-test-'));
    await fs.rm(temporary, { recursive: true, force: true });
  });
  const config = { ...DEFAULT_CONFIG, applications: [structuredClone(application)], ...overrides };
  await fs.writeFile(path.join(temporary, 'applications.json'), JSON.stringify(config));
  const launched = [];
  const requests = [];
  let invocations = 0;
  const handle = createAssistant({ configDirectory: temporary, runtimeDirectory: temporary,
    ...(assistantOptions.now ? {setTimer:()=>0,clearTimer:()=>{}} : {}), ...assistantOptions,
    runEngine: async (_file, args, options) => {
      invocations++;
      assert.equal(options.shell, false); assert.equal(options.env.NEEDLE_TELEMETRY, '0');
      assert.ok(options.timeout > 0 && options.timeout <= 40_000);
      if (args.includes('--tools')) assert.ok(args.includes('--fail-input-overflow'));
      requests.push({ prompt: args.includes('--prompt') ? args[args.indexOf('--prompt') + 1] : null,
        models: args.filter((_arg, index) => args[index - 1] === '--model').map(file => path.basename(file)),
        timeout: options.timeout,
        tools: args.includes('--tools') ? JSON.parse(await fs.readFile(args[args.indexOf('--tools') + 1], 'utf8')) : [],
        keywords: args.includes('--audio-keywords') ? await fs.readFile(args[args.indexOf('--audio-keywords') + 1], 'utf8') : null });
      const result = typeof response === 'function' ? await response(invocations, args, options)
        : Array.isArray(response) ? response[invocations - 1] : response;
      assert.ok(result, 'Appel moteur inattendu.');
      return { stdout: JSON.stringify(result) };
    },
    launchApplication: async (app, args) => { launched.push({ app, args }); return { applicationName: app.name, success: true, message: 'Lancé' }; },
  });
  return { handle, launched, requests, config, directory: temporary, invocations: () => invocations };
}
test('un appel fiable lance uniquement l’application enregistrée', async t => {
  const f = await fixture(t, { success: true, confidence: 0.9, function_calls: [call] });
  const turn = await f.handle('process_text', { text: 'Ouvre le Bloc-notes' });
  assert.equal(turn.status, 'executed'); assert.equal(f.launched.length, 1);
  assert.equal(f.launched[0].app.id, application.id);
});
test('faible confiance : aucune exécution avant confirmation, confirmation non rejouable', async t => {
  const f = await fixture(t, { success: true, confidence: 0.3, function_calls: [call] });
  const turn = await f.handle('process_text', { text: 'Ouvre le Bloc-notes' });
  assert.equal(turn.status, 'pending'); assert.equal(f.launched.length, 0);
  assert.equal((await f.handle('confirm', { id: turn.id })).status, 'executed');
  assert.equal((await f.handle('confirm', { id: turn.id })).status, 'consumed'); assert.equal(f.launched.length, 1);
});
test('annuler une demande empêche son exécution', async t => {
  const f = await fixture(t, { confidence: 0.9, function_calls: [call] }, { autoExecute: false });
  const turn = await f.handle('process_text', { text: 'Ouvre le Bloc-notes' });
  await f.handle('discard', { id: turn.id }); assert.equal((await f.handle('confirm', { id: turn.id })).status, 'consumed');
  assert.equal(f.launched.length, 0);
});
test('changer une application invalide une confirmation existante', async t => {
  const f = await fixture(t, { confidence: 0.3, function_calls: [call] });
  const turn = await f.handle('process_text', { text: 'Ouvre le Bloc-notes' });
  f.config.applications[0].enabled = false;
  await fs.writeFile(path.join(f.directory, 'applications.json'), JSON.stringify(f.config));
  const invalidated = await f.handle('confirm', { id: turn.id });
  assert.equal(invalidated.status, 'invalidated'); assert.equal(invalidated.proposal.reason, 'configuration_changed');
  assert.equal(f.launched.length, 0);
});
test('valider tout le plan avant lancement : outil inconnu dans le deuxième appel', async t => {
  const f = await fixture(t, { confidence: 1, function_calls: [call, { name: 'run_shell', arguments: {} }] });
  await assert.rejects(f.handle('process_text', { text: 'Lance les applications' }), /outil inconnu/);
  assert.equal(f.launched.length, 0);
});
test('les arguments non déclarés et les objets input sont refusés', async t => {
  const f = await fixture(t, { confidence: 1, function_calls: [{ ...call, arguments: { executable: 'evil.exe' } }] });
  await assert.rejects(f.handle('process_text', { text: 'Ouvre' }), /non autorisé/);
  assert.equal(f.launched.length, 0);
});
test('les appels supprimés par Needle et les scores absents restent à valider', async t => {
  const f = await fixture(t, { confidence: 0.99, function_calls: [], suppressed_calls: [call] });
  assert.equal((await f.handle('process_text', { text: 'Ouvre' })).status, 'pending');
  assert.equal(f.launched.length, 0);
  const other = await fixture(t, { function_calls: [call] });
  assert.equal((await other.handle('process_text', { text: 'Ouvre' })).status, 'pending');
});
test('les champs non ancrés dans la demande ne sont jamais exécutés automatiquement', async t => {
  const f = await fixture(t, { confidence: 0.99, function_calls: [call], validation: { ungrounded: ['input'] } });
  assert.equal((await f.handle('process_text', { text: 'Ouvre' })).status, 'pending');
  assert.equal(f.launched.length, 0);
});
test('silence Whistle et demande hors périmètre ne déclenchent rien', async t => {
  const f = await fixture(t, [{ text: '', language: '' }, { function_calls: [], success: true }]);
  const silent = await f.handle('process_audio', { audio: wav() });
  assert.equal(silent.status, 'silence'); assert.equal(silent.confidence, null);
  assert.equal(f.invocations(), 1); assert.deepEqual(f.requests[0].models, ['whistle.cact']);
  assert.equal((await f.handle('process_text', { text: 'Quelle heure est-il ?' })).status, 'unsupported');
  assert.equal(f.launched.length, 0);
});
test('audio corrompu et durée excessive sont refusés avant le moteur', async t => {
  const f = await fixture(t, {});
  const invalid = wav(); invalid[24] = 0;
  await assert.rejects(f.handle('process_audio', { audio: invalid }), /Format attendu/);
  assert.throws(() => validateWav(new Array(960045).fill(0)), /30 secondes/);
  assert.equal(f.invocations(), 0);
});
test('les outils ne contiennent que les applications actives, avec input seulement si configuré', () => {
  const config = { ...DEFAULT_CONFIG, applications: [application, { ...application, id: 'other', enabled: false }] };
  const tools = toolsFor(config); assert.equal(tools.length, 1); assert.deepEqual(tools[0].parameters.properties, {});
  assert.equal(typeof toolsFor({ ...config, applications: [{ ...application, arguments: ['{input}'] }] })[0].parameters.properties.input, 'object');
});

const deezer = { ...application, id: '0c5544ff-59a4-4f83-a482-69c8ec182592', name: 'Deezer',
  description: 'Plateforme d’écoute de musique en streaming', aliases: ['Diseur'] };
const vscode = { ...application, id: '082d8601-1e9c-49b9-811c-ad4dadec67a5', name: 'Visual Studio Code',
  description: 'Éditeur de code', aliases: ['VS Code'] };
const aliasConfig = { ...DEFAULT_CONFIG, applications: [deezer, vscode] };
function triggeredNames(config, text) {
  return toolsFor(config).filter(tool => tool.triggers.some(pattern => new RegExp(pattern, 'i').test(text))).map(tool => tool.name);
}

test('Diseur désigne Deezer, seul ou dans une demande de lancement, sans distinction de casse', () => {
  for (const text of ['Diseur', 'DISEUR !', 'Ouvre Diseur', 'Lance le Diseur.', 'Peux-tu ouvrir Diseur ?',
    'Ouvre l’application Diseur, s’il te plaît.', 'Please open Diseur.']) {
    assert.deepEqual(triggeredNames(aliasConfig, text), [toolName(deezer)], text);
  }
  assert.deepEqual(triggeredNames(aliasConfig, 'Ouvre VS   Code'), [toolName(vscode)]);
});

test('un alias n’est pas forcé dans un autre mot, une négation, du texte transmis ou plusieurs actions', () => {
  for (const text of ['Les diseurs', 'N’ouvre pas Diseur', 'Ne lance pas Diseur', 'Qui est Diseur ?',
    'Elle a dit « Ouvre Diseur »', 'Ouvre Diseur et VS Code', 'Ouvre Diseur puis le Bloc-notes',
    'Ouvre VS Code avec le texte Diseur']) {
    assert.deepEqual(triggeredNames(aliasConfig, text), [], text);
  }
});

test('les alias avec accents ou métacaractères restent des noms littéraux', () => {
  const app = { ...deezer, aliases: ['Musique préférée', 'Music (x64) + radio?', '.*'] };
  const config = { ...DEFAULT_CONFIG, applications: [app] };
  for (const text of ['Musique préférée', 'MUSIQUE PREFEREE', 'Ouvre Music (x64) + radio?', '.*']) {
    assert.deepEqual(triggeredNames(config, text), [toolName(app)], text);
  }
  assert.deepEqual(triggeredNames(config, 'n’importe quelle application'), []);
});

test('un nom partagé entre applications actives ne force pas un choix arbitraire', () => {
  const shared = { ...aliasConfig, applications: [deezer, { ...vscode, aliases: ['diseur'] }] };
  assert.deepEqual(triggeredNames(shared, 'Diseur'), []);
  assert.deepEqual(triggeredNames(shared, 'Deezer'), [toolName(deezer)]);
  assert.deepEqual(triggeredNames({ ...shared, applications: [deezer, { ...vscode, enabled: false }] }, 'Diseur'), [toolName(deezer)]);
  assert.deepEqual(triggeredNames({ ...aliasConfig, applications: [{ ...deezer, enabled: false }, vscode] }, 'Diseur'), []);
});

test('le texte conserve la demande originale et résout seulement une invocation explicite d’alias', async t => {
  const f = await fixture(t, { confidence: 0.3, function_calls: [{ name: toolName(deezer), arguments: {} }] }, aliasConfig);
  const text = 'Ouvre l’application DISEUR, s’il te plaît.';
  const turn = await f.handle('process_text', { text });
  assert.equal(turn.transcript, text); assert.equal(turn.calls[0].applicationId, deezer.id);
  assert.equal(f.requests[0].prompt, 'Open Deezer');
  assert.deepEqual(f.requests[0].tools.map(tool => tool.name), ['open_deezer']);
  assert.equal(turn.status, 'pending'); assert.equal(f.launched.length, 0);
  const complex = 'Ouvre VS Code avec le texte Diseur';
  await f.handle('process_text', { text: complex });
  assert.equal(f.requests[1].prompt, complex);
  assert.equal(f.requests[1].tools.length, 2);
});

test('une invocation d’alias interdit de proposer ou lancer une autre application active', async t => {
  const f = await fixture(t, { confidence: 1, function_calls: [{ name: toolName(vscode), arguments: {} }] }, aliasConfig);
  await assert.rejects(f.handle('process_text', { text: 'Diseur' }), /différente de celle demandée/);
  assert.equal(f.launched.length, 0);
});

test('le vocal résout l’alias avant Needle, préserve la transcription et affiche uniquement le score Needle', async t => {
  const f = await fixture(t, [{ text: 'diseur', language: 'fr', confidence: 0.99 },
    { confidence: 0.3, reasoning: 'Ouvre Deezer', function_calls: [{ name: toolName(deezer), arguments: {} }] }], aliasConfig);
  const turn = await f.handle('process_audio', { audio: wav() });
  assert.equal(turn.transcript, 'diseur'); assert.equal(turn.calls[0].applicationId, deezer.id);
  assert.equal(turn.confidence, 0.3); assert.equal(turn.reasoning, 'Ouvre Deezer');
  assert.deepEqual(f.requests.map(request => request.models), [['whistle.cact'], ['needle3.cact']]);
  assert.ok(f.requests[0].keywords.split('\n').includes('Diseur'));
  assert.equal(f.requests[0].prompt, null); assert.deepEqual(f.requests[0].tools, []);
  assert.equal(f.requests[1].prompt, 'Open Deezer');
  assert.deepEqual(f.requests[1].tools.map(tool => tool.name), ['open_deezer']);
  assert.equal(turn.status, 'pending'); assert.equal(f.launched.length, 0);
});

test('texte et vocal donnent la même demande canonique et les mêmes outils à Needle', async t => {
  const needle = { confidence: 0.735, function_calls: [{ name: toolName(deezer), arguments: {} }] };
  const f = await fixture(t, [needle, { text: 'Diseur.', language: 'fr' }, needle], { ...aliasConfig, autoExecute: false });
  const text = await f.handle('process_text', { text: 'diseur' });
  const audio = await f.handle('process_audio', { audio: wav() });
  assert.equal(f.requests[0].prompt, f.requests[2].prompt);
  assert.deepEqual(f.requests[0].tools, f.requests[2].tools);
  assert.equal(text.confidence, audio.confidence); assert.deepEqual(text.calls, audio.calls);
  assert.equal(audio.transcript, 'Diseur.'); assert.equal(f.launched.length, 0);
});

test('le vocal ne réécrit ni les demandes composées, ni les négations, ni le texte à transmettre', async t => {
  for (const transcript of ['Ouvre Diseur et VS Code', 'Ne lance pas Diseur', 'Ouvre VS Code avec le texte Diseur']) {
    const f = await fixture(t, [{ text: transcript, language: 'fr' }, { confidence: 0.9, function_calls: [] }], aliasConfig);
    const turn = await f.handle('process_audio', { audio: wav() });
    assert.equal(f.requests[1].prompt, transcript); assert.equal(f.requests[1].tools.length, 2);
    assert.equal(turn.transcript, transcript); assert.equal(turn.status, 'unsupported'); assert.equal(f.launched.length, 0);
  }
});

test('un alias partagé ou désactivé ne réduit pas les outils dans une demande vocale', async t => {
  for (const applications of [[deezer, { ...vscode, aliases: ['Diseur'] }], [{ ...deezer, enabled: false }, vscode]]) {
    const f = await fixture(t, [{ text: 'diseur', language: 'fr' }, { confidence: 0.2, function_calls: [] }], { ...aliasConfig, applications });
    await f.handle('process_audio', { audio: wav() });
    assert.equal(f.requests[1].prompt, 'diseur');
    assert.deepEqual(f.requests[1].tools.map(tool => tool.name), applications.filter(app => app.enabled).map(app => app.id === deezer.id ? 'open_deezer' : 'open_visual_studio_code'));
    assert.equal(f.launched.length, 0);
  }
});

test('les accents et textes Unicode des demandes vocales libres restent transmis par l’audio', async t => {
  const transcript = 'Ouvre VS Code avec le texte été à Paris';
  const editor = { ...vscode, arguments: ['{input}'] };
  const f = await fixture(t, [{ text: transcript, language: 'fr' },
    { audio_text: transcript, audio_language: 'fr', confidence: 0.3,
      function_calls: [{ name: toolName(editor), arguments: { input: 'été à Paris' } }] }],
    { ...aliasConfig, applications: [deezer, editor] });
  const turn = await f.handle('process_audio', { audio: wav() });
  assert.deepEqual(f.requests[1].models, ['needle3.cact', 'whistle.cact']);
  assert.equal(f.requests[1].prompt, null); assert.equal(f.requests[1].tools.length, 2);
  assert.equal(turn.transcript, transcript); assert.equal(turn.calls[0].arguments.input, 'été à Paris');
  assert.equal(turn.status, 'pending'); assert.equal(f.launched.length, 0);
});

test('Needle ne peut pas lancer une autre application après la résolution d’un alias vocal', async t => {
  const f = await fixture(t, [{ text: 'diseur', language: 'fr' },
    { confidence: 1, function_calls: [{ name: toolName(vscode), arguments: {} }] }], aliasConfig);
  await assert.rejects(f.handle('process_audio', { audio: wav() }), /différente de celle demandée/);
  assert.equal(f.launched.length, 0);
});

test('une transcription absente ou invalide arrête le vocal avant Needle', async t => {
  for (const response of [{ audio_text: 'Diseur' }, { text: 'Diseur\0' }, { text: 'a'.repeat(2001) }]) {
    const f = await fixture(t, response, aliasConfig);
    await assert.rejects(f.handle('process_audio', { audio: wav() }), /transcription|Transcription/);
    assert.equal(f.invocations(), 1); assert.equal(f.launched.length, 0);
    assert.deepEqual((await fs.readdir(f.directory)).filter(name => name.startsWith('turn-')), []);
  }
});

test('la langue détectée par Whistle est conservée et son score ne déclenche aucune exécution', async t => {
  const f = await fixture(t, [{ text: 'Open Diseur', language: 'en', confidence: 1 },
    { confidence: null, function_calls: [{ name: toolName(deezer), arguments: {} }] }], { ...aliasConfig, language: 'auto' });
  const turn = await f.handle('process_audio', { audio: wav() });
  assert.equal(turn.language, 'en'); assert.equal(turn.confidence, null);
  assert.equal(turn.status, 'pending'); assert.equal(f.launched.length, 0);
});

test('le budget de 40 secondes est partagé entre Whistle et Needle', async t => {
  let elapsed=0;
  const f = await fixture(t, invocation => {
    if (invocation === 1) { elapsed+=1500; return { text: 'diseur', language: 'fr' }; }
    return { confidence: 0.3, function_calls: [{ name: toolName(deezer), arguments: {} }] };
  }, aliasConfig, {now:()=>elapsed});
  await f.handle('process_audio', { audio: wav() });
  assert.equal(f.requests[0].timeout, 40_000); assert.equal(f.requests[1].timeout, 38_500);
});

test('un budget épuisé pendant Whistle empêche le démarrage de Needle et nettoie l’audio', async t => {
  let elapsed=0;
  const f = await fixture(t, () => { elapsed+=40_001; return { text: 'diseur', language: 'fr' }; }, aliasConfig,{now:()=>elapsed});
  const turn=await f.handle('process_audio', { audio: wav() });
  assert.equal(turn.status,'partial');assert.match(turn.message,/délai global/);assert.deepEqual(turn.results,[]);
  assert.equal(f.invocations(), 1); assert.equal(f.launched.length, 0);
  assert.deepEqual((await fs.readdir(f.directory)).filter(name => name.startsWith('turn-')), []);
});
test('une configuration corrompue n’est pas écrasée', async t => {
  const f = await fixture(t, {}); const file = path.join(f.directory, 'applications.json');
  await fs.writeFile(file, 'broken'); assert.match((await f.handle('status')).configError.message, /Profil invalide/);
  await assert.rejects(f.handle('process_text', {text:'Ouvre Bloc-notes'}), /Profil invalide/);
  assert.equal(await fs.readFile(file, 'utf8'), 'broken');
});
test('les erreurs moteur nettoient les fichiers contenant l’audio', async t => {
  const f = await fixture(t, { success: false, error: 'Model failed' });
  await assert.rejects(f.handle('process_audio', { audio: wav() }), /Model failed/);
  assert.deepEqual((await fs.readdir(f.directory)).filter(name => name.startsWith('turn-')), []);
});

test('une erreur Needle après transcription nettoie l’audio sans exécuter de commande', async t => {
  const f = await fixture(t, [{ text: 'diseur', language: 'fr' }, { success: false, error: 'Needle failed' }], aliasConfig);
  await assert.rejects(f.handle('process_audio', { audio: wav() }), /Needle failed/);
  assert.equal(f.launched.length, 0);
  assert.deepEqual((await fs.readdir(f.directory)).filter(name => name.startsWith('turn-')), []);
});


test('corriger une transcription retire l’ancien plan et impose une nouvelle validation', async t => {
  const f = await fixture(t, { confidence: 0.99, function_calls: [call] }, { autoExecute: false });
  const original = await f.handle('process_text', { text: 'texte erroné' });
  await f.handle('settings', { language: 'fr', autoExecute: true, confidenceThreshold: 0.7 });
  const corrected = await f.handle('correct_request', { id: original.id, text: 'Ouvre Notepad' });
  assert.equal(corrected.status, 'pending'); assert.equal(corrected.correctedFrom, original.id);
  assert.equal(corrected.transcript, 'Ouvre Notepad'); assert.equal(f.launched.length, 0);
  assert.equal((await f.handle('confirm', { id: original.id })).status, 'invalidated');
  assert.equal((await f.handle('confirm', { id: corrected.id })).status, 'executed');
  assert.equal(f.launched.length, 1);
});

test('le choix explicite d’une application limite Needle sans enregistrer automatiquement un alias', async t => {
  const other = { ...application, id: 'ba123456-1111-4111-a111-123456789123', name: 'Deezer', aliases: [] };
  const f = await fixture(t, { confidence: 0.99, function_calls: [{ name: toolName(other), arguments: {} }] }, { applications: [application, other] });
  const corrected = await f.handle('correct_request', { id: application.id, text: 'Dis heure', applicationId: other.id, alias: 'Dis heure' });
  assert.equal(corrected.status, 'pending'); assert.equal(corrected.calls[0].applicationId, other.id);
  assert.equal(f.requests[0].prompt, 'Open Deezer'); assert.equal(f.requests[0].tools.length, 1);
  assert.deepEqual((await f.handle('status')).config.applications[1].aliases, []);
  assert.equal(f.launched.length, 0);
});

test('un alias approuvé lors d’une correction devient utilisable dans les demandes suivantes', async t => {
  const f = await fixture(t, { confidence: 0.99, function_calls: [call] });
  const corrected = await f.handle('correct_request', { id: application.id, text: 'bloc note', applicationId: application.id, saveAlias: true, alias: 'bloc note' });
  assert.equal(corrected.status, 'pending'); assert.equal(f.launched.length, 0);
  assert.ok((await f.handle('status')).config.applications[0].aliases.includes('bloc note'));
  assert.equal((await f.handle('confirm', { id: corrected.id })).status, 'executed');
  const following = await f.handle('process_text', { text: 'bloc note' });
  assert.equal(following.calls[0].applicationId, application.id);
  assert.equal(f.requests[1].prompt, 'Open Bloc-notes');
});

test('une collision d’alias ou une application désactivée laisse le plan initial utilisable', async t => {
  const other = { ...application, id: 'ba123456-1111-4111-a111-123456789123', name: 'Deezer', aliases: ['Musique'], enabled: false };
  const f = await fixture(t, { confidence: 0.1, function_calls: [call] }, { applications: [application, other] });
  const original = await f.handle('process_text', { text: 'Bloc-notes' });
  await assert.rejects(f.handle('correct_request', { id: original.id, text: 'Musique', applicationId: application.id, saveAlias: true, alias: 'musique' }), /déjà une autre/);
  await assert.rejects(f.handle('correct_request', { id: original.id, text: 'Deezer', applicationId: other.id }), /désactivée/);
  assert.equal((await f.handle('confirm', { id: original.id })).status, 'executed');
  assert.equal(f.launched.length, 1);
});

test('une correction explicite transmet seulement l’entrée vérifiée par l’utilisateur', async t => {
  const inputApp = { ...application, arguments: ['{input}'] };
  const f = await fixture(t, { confidence: 1, function_calls: [{ ...call, arguments: { input: 'inventé par le modèle' } }] }, { applications: [inputApp] });
  const corrected = await f.handle('correct_request', { id: application.id, text: 'Ouvre mon texte', applicationId: application.id, input: 'été à Paris' });
  assert.deepEqual(corrected.calls[0].arguments, { input: 'été à Paris' });
  await f.handle('confirm', { id: corrected.id });
  assert.equal(f.launched[0].args.input, 'été à Paris');
});

test('une panne pendant la correction ne laisse aucun ancien plan exécutable', async t => {
  const f = await fixture(t, invocation => {
    if (invocation === 2) throw new Error('Moteur arrêté');
    return { confidence: 0.1, function_calls: [call] };
  });
  const original = await f.handle('process_text', { text: 'Bloc-notes' });
  await assert.rejects(f.handle('correct_request', { id: original.id, text: 'Notepad' }), /Moteur arrêté/);
  assert.equal((await f.handle('confirm', { id: original.id })).status, 'invalidated');
  assert.equal(f.launched.length, 0);
});
