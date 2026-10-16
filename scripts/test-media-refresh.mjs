// Real Windows GSMTC with a dedicated silent MediaPlayer and the production Vue component.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { harness, settle } from '../tests/fixtures/vue-harness.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  require = createRequire(import.meta.url);
assert.equal(process.platform, 'win32', 'Requires Windows GSMTC');
const { nativeRequest } = require('../sidecar/native.cjs'),
  { createMedia } = require('../sidecar/media.cjs');
const executable =
  process.env.PAM_NATIVE_EXE ||
  join(root, 'src-tauri/target/x86_64-pc-windows-msvc/debug/examples/media.exe');
const player =
  process.env.PAM_MEDIA_TEST_PLAYER ||
  join(
    root,
    'tests/fixtures/media-player/target/x86_64-pc-windows-msvc/debug/pam-media-fixture.exe',
  );
const native = (r) => nativeRequest(r, executable),
  media = createMedia(native);
const profile = await mkdtemp(join(tmpdir(), 'pam-media-refresh-')),
  prefix = 'PAM-25 fixture ' + randomUUID();
const report = {
  date: new Date().toISOString(),
  executable,
  player,
  checks: [],
  personalPlayersCommanded: 0,
};
let child,
  mounted = false,
  stderr = '';
const cleanups = [];
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
async function until(probe, message) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const v = await probe();
    if (v) return v;
    if (child?.exitCode !== null) throw Error('Native player stopped: ' + stderr);
    await delay(100);
  }
  throw Error(message + ' ' + stderr);
}
const h = harness(
  { after: (fn) => cleanups.push(fn) },
  {
    components: true,
    request: (method) => (method === 'media_sessions' ? media.sessions() : undefined),
  },
);
try {
  const wav = Buffer.alloc(44 + 16000 * 2 * 60);
  wav.write('RIFF');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(wav.length - 44, 40);
  const file = join(profile, 'silence.wav');
  await writeFile(file, wav);
  const before = await media.sessions();
  child = spawn(player, [pathToFileURL(file).href, prefix], { windowsHide: true, stdio: 'pipe' });
  child.on('error', (error) => {
    stderr += error.message;
  });
  child.stdin.on('error', () => {});
  child.stderr.on('data', (data) => {
    stderr += data;
  });
  const initial = await until(async () => {
    const list = await media.sessions();
    report.fixtureSnapshots = list
      .filter((s) => s.title?.startsWith(prefix))
      .map((s) => ({
        playbackStatus: s.playbackStatus,
        capabilities: s.capabilities,
        error: s.error,
      }));
    return list.find((s) => s.title === prefix + ' 1' && s.playbackStatus === 'Lecture');
  }, 'Native MediaPlayer did not publish GSMTC');
  assert.ok(
    !before.some((s) => s.sourceAppId.toLowerCase() === initial.sourceAppId.toLowerCase()),
    'Existing session shares source; refuse commands',
  );
  const app = {
    id: 'pam-media-fixture',
    name: 'PAM test player',
    enabled: true,
    executable: player,
    arguments: [],
    aliases: [],
    description: 'Disposable silent test',
    media: { sourceAppId: initial.sourceAppId },
  };
  let props;
  const m = h.mount((load, v) => {
    props = v.reactive({ applications: [app], locked: false });
    return () => v.h(load('components/MediaControls.vue').default, props);
  });
  mounted = true;
  const elements = (n) => [n, ...n.children.flatMap(elements)],
    text = (n) => n.text + n.children.map(text).join('');
  const view = () => text(m.root),
    button = (label) =>
      elements(m.root).find((n) => n.type === 'button' && text(n).trim() === label);
  await until(async () => {
    await settle();
    return view().includes(prefix + ' 1') && !button('Pause')?.props.disabled;
  }, 'Vue initial session missing');
  async function command(action) {
    const list = (await media.sessions()).filter(
      (s) => s.sourceAppId.toLowerCase() === initial.sourceAppId.toLowerCase(),
    );
    assert.equal(list.length, 1, 'Ambiguous source; refuse commands');
    assert.ok(list[0].title?.startsWith(prefix), 'Fixture identity changed; refuse commands');
    await media.execute(app, action, {});
  }
  props.locked = true;
  await settle();
  await command('media_pause');
  props.locked = false;
  await settle();
  await until(async () => {
    await settle();
    return (
      view().includes(prefix + ' 1') &&
      !button('Lecture').props.disabled &&
      button('Pause').props.disabled
    );
  }, 'Vue did not observe pause and capabilities after command');
  report.checks.push('Native pause and changed capabilities observed by Vue after unlock');
  props.locked = true;
  await settle();
  await command('media_play');
  props.locked = false;
  await until(async () => {
    await settle();
    return !button('Pause').props.disabled && button('Lecture').props.disabled;
  }, 'Vue did not observe play');
  report.checks.push('Native play and live capabilities observed by Vue');
  await command('media_next');
  await until(async () => {
    const list = await media.sessions();
    return list.some((s) => s.title === prefix + ' 2');
  }, 'Native next title missing');
  assert.equal(h.timers.size, 1);
  const [id, timer] = [...h.timers][0];
  assert.equal(timer.ms, 5000);
  h.timers.delete(id);
  timer.fn();
  await until(async () => {
    await settle();
    return view().includes(prefix + ' 2');
  }, 'Vue polling did not observe native title');
  report.checks.push('Five-second polling reads changed native title without manual refresh');
  h.dispatch('blur');
  await settle();
  assert.equal(h.timers.size, 0);
  h.dispatch('focus');
  await until(async () => {
    await settle();
    return view().includes(prefix + ' 2');
  }, 'Foreground read missing');
  report.checks.push('Foreground return rereads native session');
  assert.deepEqual(h.errors, []);
  report.passed = true;
} finally {
  if (mounted) h.unmount();
  for (const fn of cleanups.reverse()) fn();
  if (child && child.exitCode === null) {
    child.stdin.end('quit\n');
    await Promise.race([new Promise((done) => child.once('exit', done)), delay(3000)]);
    if (child.exitCode === null) {
      child.kill();
      await new Promise((done) => child.once('exit', done));
    }
  }
  assert.ok(!child || child.exitCode !== null || child.signalCode, 'Native fixture must stop');
  assert.equal(dirname(profile), tmpdir());
  assert.ok(basename(profile).startsWith('pam-media-refresh-'));
  await rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  report.cleanup = { processStopped: true, profileRemoved: true };
  await mkdir(join(root, 'artifacts/autonomy'), { recursive: true });
  await writeFile(
    join(root, 'artifacts/autonomy/pam25-native-results.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
}
console.log(JSON.stringify(report, null, 2));
