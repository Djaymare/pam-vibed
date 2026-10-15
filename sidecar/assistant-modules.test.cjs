const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { toolsFor, resolveInvocation, toolName } = require('./assistant/intent.cjs');
const { createPlanner } = require('./assistant/planner.cjs');
const { createExecutor } = require('./assistant/executor.cjs');
const { createBudget } = require('./budget.cjs');

const config = () => ({ version: 2, language: 'fr', autoExecute: true, confidenceThreshold: 0.7, commandAliases: [], applications: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Editeur', description: 'Ouvrir un éditeur.', executable: 'C:\\fixture.exe', arguments: [], aliases: [], enabled: true }] });
async function directory(t) { const d = await fs.mkdtemp(path.join(os.tmpdir(), 'pam-modules-')); t.after(() => fs.rm(d, { recursive: true, force: true })); return d; }

test('recognition is pure and exposes a constrained single application plan', () => {
  const c = config(), before = structuredClone(c);
  const resolved = resolveInvocation('ouvre Editeur', toolsFor(c), c);
  assert.equal(resolved.singleAction, true);
  assert.deepEqual(resolved.requestTools.map(t => t.applicationId), [c.applications[0].id]);
  assert.deepEqual(c, before);
});

test('planner produces an executable decision without an effect and releases its inference lease', async t => {
  const d = await directory(t), c = config(); let releases = 0, inference = 0;
  const prepare = createPlanner({ runtimeDirectory: d, configDirectory: d,
    temporaryFiles: { createTurn: async () => ({ directory: d, release: async () => { releases++; } }) },
    media: { sessions: async () => [] },
    runEngine: async () => { inference++; return { stdout: JSON.stringify({ success: true, confidence: 1, function_calls: [{ name: toolName(c.applications[0]), arguments: {} }] }) }; },
  });
  const result = await prepare('process_text', { text: 'ouvre Editeur' }, c, { budget: createBudget({ milliseconds: 1000 }) });
  assert.equal(result.execute, true); assert.equal(inference, 1); assert.equal(releases, 1);
  assert.deepEqual(result.turn.results, []);
  assert.equal(result.turn.calls.length, 1);
  assert.equal((await fs.readdir(d)).some(f => /execution/.test(f)), false);
});

test('executor validates every call before journaling or emitting any effect', async t => {
  const d = await directory(t), c = config(); let effects = 0;
  const executor = createExecutor({ configDirectory: d, media: {}, launchApplication: async () => { effects++; return { success: true }; } });
  const turn = { id: '22222222-2222-4222-8222-222222222222', calls: [{ name: toolName(c.applications[0]), arguments: {} }, { name: 'unknown', arguments: {} }] };
  await assert.rejects(executor.execute(turn, c, { budget: createBudget({ milliseconds: 1000 }) }), /inconnu/);
  assert.equal(effects, 0); assert.deepEqual(await fs.readdir(d), []);
});

test('Tauri resources cover the transitive production sidecar imports after extraction', async () => {
  const root = path.resolve(__dirname, '..');
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
  const resources = Object.keys(manifest.bundle.resources).map(p => path.resolve(root, 'src-tauri', p));
  const visited = new Set();
  async function visit(file) {
    if (visited.has(file)) return; visited.add(file);
    assert.ok(resources.some(p => p === file || file.startsWith(p + path.sep)), `Resource missing: ${path.relative(root, file)}`);
    if (!file.endsWith('.cjs')) return;
    const code = await fs.readFile(file, 'utf8');
    for (const match of code.matchAll(/require\(['"](\.[^'"]+)['"]\)/g)) await visit(path.resolve(path.dirname(file), match[1]));
  }
  await visit(path.join(root, 'sidecar/main.cjs'));
  assert.ok(visited.has(path.join(root, 'sidecar/assistant/planner.cjs')));
});

test('deployed sidecar resource tree starts without imports from the checkout', async t => {
  const d = await directory(t), root = path.resolve(__dirname, '..');
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
  for (const [source, destination] of Object.entries(manifest.bundle.resources)) {
    if (!destination.startsWith('sidecar/')) continue;
    const target = path.join(d, destination);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.cp(path.resolve(root, 'src-tauri', source), target, { recursive: true });
  }
  const reply = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(d, 'sidecar/main.cjs'), path.join(d, 'missing-runtime'), path.join(d, 'profile')], { windowsHide: true, stdio: ['pipe','pipe','pipe'], env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' } });
    let output = '', error = '';
    const timer = setTimeout(() => { child.kill(); reject(Error('Deployed sidecar timeout')); }, 10000);
    child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { error += data; });
    child.on('error', reject); child.on('close', code => { clearTimeout(timer); if (code !== 0) reject(Error(error)); else { try { resolve(JSON.parse(output)); } catch (e) { reject(e); } } });
    child.stdin.end(JSON.stringify({ version: 1, id: 1, requestId: '33333333-3333-4333-8333-333333333333', method: 'status', payload: {} }));
  });
  assert.equal(reply.ok, true); assert.equal(reply.result.ready, false);
  assert.equal(reply.result.config.version, 2); assert.deepEqual(reply.result.config.applications, []);
});
