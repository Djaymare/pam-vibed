const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createAssistant, DEFAULT_CONFIG, toolName } = require('./assistant.cjs');
const { TTL_MS } = require('./proposals.cjs');

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pam-proposals-'));
  t.after(async () => {
    assert.equal(path.dirname(directory), os.tmpdir());
    assert.ok(path.basename(directory).startsWith('pam-proposals-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const app = { id: randomUUID(), name: 'Fixture', description: 'Fixture', executable: 'C:\\fixture.exe', arguments: [], aliases: [], enabled: true };
  const config = { ...DEFAULT_CONFIG, autoExecute: false, applications: [app] };
  const save = () => fs.writeFile(path.join(directory, 'applications.json'), JSON.stringify(config));
  await save();
  let time = Date.now(), effects = 0, failInference = false;
  const make = () => createAssistant({ configDirectory: directory, runtimeDirectory: directory, proposalNow: () => time,
    runEngine: async () => { if (failInference) throw Error('Inference fixture failed'); return { stdout: JSON.stringify({ confidence: 1, function_calls: [{ name: toolName(app), arguments: {} }] }) }; },
    launchApplication: async (_app, _args, options) => { await options.beforeEffect(); effects++; return { success: true, message: 'Fixture effect' }; } });
  const handle = make();
  await handle('status');
  return { directory, app, config, save, make, handle, prepare: () => handle('process_text', { text: 'Ouvre Fixture' }),
    advance: ms => time += ms, time: () => time, effects: () => effects, fail: () => failInference = true };
}
test('PAM-10 : échéance exacte, collecte puis confirmation expirée sans chemin interne', async t => {
  const f = await fixture(t), turn = await f.prepare();
  assert.equal(turn.proposal.expiresAt - turn.proposal.createdAt, TTL_MS);
  f.advance(TTL_MS - 1);
  assert.equal((await f.handle('status')).proposals[0].state, 'pending');
  f.advance(1);
  assert.equal((await f.handle('status')).proposals[0].state, 'expired');
  const expired = await f.handle('confirm', { id: turn.id });
  assert.equal(expired.status, 'expired'); assert.equal(expired.proposal.reason, 'expired');
  assert.match(expired.message, /Reformulez/); assert.doesNotMatch(JSON.stringify(expired), /ENOENT|pam-proposals-/);
  assert.equal((await f.handle('confirm', { id: turn.id })).status, 'expired'); assert.equal(f.effects(), 0);
  const unknown = await f.handle('confirm', { id: randomUUID() });
  assert.equal(unknown.proposal.state, 'unknown'); assert.equal(unknown.proposal.reason, 'unknown_proposal');
});
test('PAM-10 : applications et alias invalident les propositions, sans les réactiver après restauration', async t => {
  const f = await fixture(t), turn = await f.prepare();
  f.config.applications[0].aliases.push('Test alias'); await f.save();
  const next = await f.handle('status');
  assert.equal(next.proposals.find(p => p.id === turn.id).reason, 'configuration_changed');
  f.config.applications[0].aliases = []; await f.save();
  assert.equal((await f.handle('confirm', { id: turn.id })).status, 'invalidated');
  const second = await f.prepare();
  await f.handle('save_command_alias', { phrase: 'Mon raccourci', applicationId: f.app.id, action: 'open' });
  assert.equal((await f.handle('confirm', { id: second.id })).status, 'invalidated');
  const third = await f.prepare(); await f.handle('set_application_enabled', { id: f.app.id, enabled: false });
  assert.equal((await f.handle('confirm', { id: third.id })).status, 'invalidated'); assert.equal(f.effects(), 0);
});
test('PAM-10 : plus de vingt propositions et confirmations concurrentes ne perdent ni ne rejouent un plan', async t => {
  const f = await fixture(t), turns = [];
  for (let i = 0; i < 25; i++) turns.push(await f.prepare());
  assert.equal((await f.handle('status')).proposals.filter(p => p.state === 'pending').length, 25);
  const replies = await Promise.all([f.handle('confirm', { id: turns[0].id }), f.handle('confirm', { id: turns[0].id })]);
  assert.deepEqual(replies.map(r => r.status).sort(), ['consumed', 'executed']); assert.equal(f.effects(), 1);
  assert.equal((await f.handle('confirm', { id: turns[0].id })).status, 'consumed'); assert.equal(f.effects(), 1);
});
test('PAM-10 : correction échouée retire le plan avant l’inférence et expose sa cause', async t => {
  const f = await fixture(t), turn = await f.prepare(); f.fail();
  await assert.rejects(f.handle('correct_request', { id: turn.id, text: 'Ouvre le test' }), /Inference fixture failed/);
  const state = (await f.handle('status')).proposals.find(p => p.id === turn.id);
  assert.equal(state.state, 'invalidated'); assert.equal(state.reason, 'corrected');
  assert.equal((await f.handle('confirm', { id: turn.id })).status, 'invalidated'); assert.equal(f.effects(), 0);
});
test('PAM-10 : redémarrage purge la permission, conserve la cause et ne produit aucun effet', async t => {
  const f = await fixture(t), turn = await f.prepare(), restarted = f.make();
  const status = await restarted('status');
  assert.equal(status.proposals.find(p => p.id === turn.id).reason, 'restarted');
  assert.equal((await restarted('confirm', { id: turn.id })).status, 'invalidated'); assert.equal(f.effects(), 0);
});
test('PAM-10 : ancien fichier expiré migré avant nettoyage, encore distinct d’un inconnu', async t => {
  const f = await fixture(t), id = randomUUID();
  await fs.mkdir(path.join(f.directory, 'pending'));
  await fs.writeFile(path.join(f.directory, 'pending', `${id}.json`), JSON.stringify({ createdAt: f.time() - TTL_MS,
    configDigest: '', turn: { id, transcript: 'Legacy', language: 'fr', confidence: null, reasoning: '', durationMs: 0, calls: [], results: [], status: 'pending' } }));
  const restarted = f.make(), result = await restarted('confirm', { id });
  assert.equal(result.status, 'expired'); assert.equal(result.proposal.reason, 'expired'); assert.equal(f.effects(), 0);
  await assert.rejects(fs.stat(path.join(f.directory, 'pending', `${id}.json`)), { code: 'ENOENT' });
});
test('PAM-10 : profil corrompu invalide les propositions sans modifier le fichier', async t => {
  const f = await fixture(t), turn = await f.prepare(), profile = path.join(f.directory, 'applications.json');
  await fs.writeFile(profile, '{broken');
  const status = await f.handle('status'); assert.ok(status.configError);
  assert.equal(status.proposals.find(p => p.id === turn.id).reason, 'profile_invalid');
  assert.equal(await fs.readFile(profile, 'utf8'), '{broken'); await f.save();
  assert.equal((await f.handle('confirm', { id: turn.id })).status, 'invalidated'); assert.equal(f.effects(), 0);
});
