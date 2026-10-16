import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { harness, deferred, settle, config, turn } from './fixtures/vue-harness.mjs';
const require = createRequire(import.meta.url);
const player = (id = 'a') => ({
  ...config().applications[0],
  id,
  name: 'Player ' + id,
  media: { sourceAppId: id },
});
const session = (sourceAppId = 'a', title = 'Premier', playing = true) => ({
  sourceAppId,
  title,
  playbackStatus: playing ? 'Lecture' : 'Pause',
  capabilities: {
    play: !playing,
    pause: playing,
    next: true,
    previous: false,
    stop: false,
    toggle: true,
  },
});
const elements = (n) => [n, ...n.children.flatMap(elements)],
  text = (n) => n.text + n.children.map(text).join('');
function mount(h, initial = {}) {
  let props;
  const m = h.mount((load, v) => {
    props = v.reactive({ applications: [player()], locked: false, ...initial });
    return () => v.h(load('components/MediaControls.vue').default, props);
  });
  const button = (label) =>
    elements(m.root).find((n) => n.type === 'button' && text(n).trim() === label);
  return {
    ...m,
    props,
    button,
    text: () => text(m.root),
    select: (id) =>
      elements(m.root)
        .find((n) => n.type === 'select')
        .props['onUpdate:modelValue'](id),
  };
}
async function tick(h) {
  assert.equal(h.timers.size, 1);
  const [id, timer] = [...h.timers][0];
  h.timers.delete(id);
  timer.fn();
  await settle();
  return timer.ms;
}
test('PAM-25 polling observes title/playback/capabilities and explains disabled actions', async (t) => {
  let current = session();
  const h = harness(t, {
    components: true,
    request: (m) => (m === 'media_sessions' ? [current] : undefined),
  });
  const m = mount(h);
  await settle();
  assert.match(m.text(), /Premier.*Lecture/);
  assert.equal(m.button('Pause').props.disabled, false);
  assert.equal(m.button('Lecture').props.disabled, true);
  assert.match(m.text(), /Le lecteur ne propose pas « Lecture » actuellement/);
  current = session('a', 'Second', false);
  assert.equal(await tick(h), 5000);
  assert.match(m.text(), /Second.*Pause/);
  assert.equal(m.button('Lecture').props.disabled, false);
  assert.equal(m.button('Pause').props.disabled, true);
  await tick(h);
  assert.equal(h.calls.length, 3);
  assert.equal(h.timers.size, 1);
  assert.deepEqual(h.errors, []);
});
test('PAM-25 command completion refreshes even after a previous successful read', async (t) => {
  let current = session();
  const h = harness(t, {
    components: true,
    request: (m) => (m === 'media_sessions' ? [current] : undefined),
  });
  const m = mount(h);
  await settle();
  m.props.locked = true;
  await settle();
  assert.equal(h.timers.size, 0);
  current = session('a', 'Après commande', false);
  m.props.locked = false;
  await settle();
  assert.equal(h.calls.length, 2);
  assert.match(m.text(), /Après commande.*Pause/);
});
test('PAM-25 real request/confirmation flows refresh after success and uncertain failure', async (t) => {
  let current = session();
  const replies = [];
  const h = harness(t, {
    components: true,
    request: (method) => {
      if (method === 'media_sessions') return [current];
      if (['process_text', 'confirm'].includes(method)) {
        const p = deferred();
        replies.push(p);
        return p.promise;
      }
    },
  });
  let requests, proposals;
  const m = h.mount((load, v) => {
    const scope = load('composables/useAsyncScope.ts').useAsyncScope(),
      mutation = scope.operation();
    const profile = {
      scope,
      mutation,
      request: h.request,
      error: v.ref(''),
      config: v.ref({ ...config(), applications: [player()] }),
      status: v.ref(),
      activeApps: v.ref([player()]),
      runtimeReady: v.ref(true),
      beginMutation: (label) => mutation.begin(label),
      updateHealth: async () => {},
    };
    const locked = () => mutation.pending.value;
    proposals = load('composables/useProposals.ts').useProposals(profile, locked, () => {});
    requests = load('composables/useRequests.ts').useRequests(
      profile,
      proposals,
      () => !locked(),
      locked,
    );
    return () =>
      v.h(load('components/MediaControls.vue').default, {
        applications: [player()],
        locked: locked(),
      });
  });
  await settle();
  let before = h.calls.filter((c) => c.method === 'media_sessions').length;
  const automatic = requests.process('process_text', { text: 'Pause' });
  await settle();
  current = session('a', 'Automatique', false);
  replies[0].resolve({ ...turn(), status: 'executed' });
  await automatic;
  await settle();
  assert.equal(h.calls.filter((c) => c.method === 'media_sessions').length, before + 1);
  assert.match(text(m.root), /Automatique/);
  for (const failed of [false, true]) {
    const proposal = turn('confirm-' + failed);
    proposals.add(proposal);
    before = h.calls.filter((c) => c.method === 'media_sessions').length;
    const effect = proposals.resolveTurn(proposal, true);
    await settle();
    current = session('a', failed ? 'Issue inconnue' : 'Confirmée');
    const reply = replies.at(-1);
    if (failed) reply.reject(Error('Réponse native perdue'));
    else reply.resolve({ ...proposal, status: 'executed' });
    await effect;
    await settle();
    assert.equal(h.calls.filter((c) => c.method === 'media_sessions').length, before + 1);
    assert.match(text(m.root), failed ? /Issue inconnue/ : /Confirmée/);
  }
  assert.deepEqual(h.errors, []);
});
test('PAM-25 refreshes coalesce; changed players discard stale results and queue one read', async (t) => {
  const pending = [];
  const h = harness(t, {
    components: true,
    request: (m) => {
      if (m === 'media_sessions') {
        const p = deferred();
        pending.push(p);
        return p.promise;
      }
    },
  });
  const m = mount(h, { applications: [player(), player('b')] });
  await settle();
  m.button('Lecture des sessions…').props.onClick();
  m.button('Lecture des sessions…').props.onClick();
  assert.equal(pending.length, 1);
  m.select('b');
  await settle();
  m.select('a');
  m.select('b');
  await settle();
  assert.equal(pending.length, 1);
  pending[0].resolve([session('b', 'Obsolète')]);
  await settle();
  assert.equal(pending.length, 2);
  assert.doesNotMatch(m.text(), /Obsolète/);
  pending[1].resolve([session('b', 'Courant')]);
  await settle();
  assert.match(m.text(), /Courant/);
  assert.equal(h.timers.size, 1);
  assert.equal(pending.length, 2);
});
test('PAM-25 background/hidden/locked/empty views suspend and foreground return refreshes once', async (t) => {
  const h = harness(t, {
    components: true,
    request: (m) => (m === 'media_sessions' ? [session()] : undefined),
  });
  const m = mount(h);
  await settle();
  for (const kind of ['blur', 'hidden', 'locked', 'empty']) {
    const before = h.calls.length;
    if (kind === 'blur') h.dispatch('blur');
    if (kind === 'hidden') {
      h.document.visibilityState = 'hidden';
      h.dispatch('visibilitychange', 'document');
    }
    if (kind === 'locked') m.props.locked = true;
    if (kind === 'empty') m.props.applications = [];
    await settle();
    assert.equal(h.timers.size, 0, kind);
    assert.equal(h.calls.length, before, kind);
    if (kind === 'blur') h.dispatch('focus');
    if (kind === 'hidden') {
      h.document.visibilityState = 'visible';
      h.dispatch('visibilitychange', 'document');
    }
    if (kind === 'locked') m.props.locked = false;
    if (kind === 'empty') {
      m.props.applications = [player()];
      await settle();
      m.select('a');
    }
    await settle();
    assert.equal(h.calls.length, before + 1, kind);
    assert.equal(h.timers.size, 1, kind);
  }
  h.dispatch('focus');
  h.dispatch('visibilitychange', 'document');
  await settle();
  assert.equal(h.timers.size, 1);
  h.unmount();
  assert.equal(h.timers.size, 0);
  assert.equal(h.domEvents.size, 0);
  h.dispatch('focus');
  assert.deepEqual(h.errors, []);
});
test('PAM-25 unmount/remount and inverted responses cannot restore an old view', async (t) => {
  const pending = [];
  const h = harness(t, {
    components: true,
    request: (m) => {
      if (m === 'media_sessions') {
        const p = deferred();
        pending.push(p);
        return p.promise;
      }
    },
  });
  let m = mount(h);
  h.unmount();
  m = mount(h);
  pending[1].resolve([session('a', 'Récent')]);
  await settle();
  pending[0].resolve([session('a', 'Ancien')]);
  await settle();
  assert.match(m.text(), /Récent/);
  assert.doesNotMatch(m.text(), /Ancien/);
  assert.equal(h.timers.size, 1);
  assert.deepEqual(h.errors, []);
});
test('PAM-25 disappeared sessions/apps never enable or redirect a stale media handler', async (t) => {
  let current = [session(), session('b')];
  const emitted = [];
  const h = harness(t, {
    components: true,
    request: (m) => (m === 'media_sessions' ? current : undefined),
  });
  const m = mount(h, {
    applications: [player(), player('b')],
    onAction: (...args) => emitted.push(args),
  });
  await settle();
  const stale = m.button('Pause').props.onClick;
  current = [session('b')];
  await tick(h);
  stale();
  assert.equal(emitted.length, 0);
  assert.match(m.text(), /Aucune session Windows compatible pour Player a/);
  m.props.applications = [player('b')];
  await settle();
  stale();
  assert.equal(emitted.length, 0);
  assert.match(m.text(), /lecteur sélectionné a été retiré/);
  m.select('b');
  await settle();
  m.button('Pause').props.onClick();
  assert.equal(emitted[0][0], 'b');
});
test('PAM-25 errors back off to 30s, unknown/ambiguous capabilities fail closed and recover', async (t) => {
  let current = Error('Service indisponible');
  const h = harness(t, {
    components: true,
    request: (m) => {
      if (m === 'media_sessions') {
        if (current instanceof Error) throw current;
        return current;
      }
    },
  });
  const m = mount(h);
  await settle();
  assert.match(m.text(), /Service indisponible/);
  assert.equal(await tick(h), 10000);
  assert.equal(await tick(h), 20000);
  assert.equal(await tick(h), 30000);
  current = [{ sourceAppId: 'a' }];
  await tick(h);
  assert.match(m.text(), /État de lecture inconnu/);
  assert.match(m.text(), /capacité « Pause » du lecteur est inconnue/);
  assert.equal(m.button('Pause').props.disabled, true);
  current = [session(), session()];
  await tick(h);
  assert.equal(m.button('Pause').props.disabled, true);
  assert.match(m.text(), /cible ambiguë/);
  current = [{ sourceAppId: 'a', error: 'Session fermée' }];
  await tick(h);
  assert.equal(m.button('Pause').props.disabled, true);
  assert.match(m.text(), /Session fermée/);
  current = [session()];
  await tick(h);
  assert.equal(m.button('Pause').props.disabled, false);
  assert.equal([...h.timers.values()][0].ms, 5000);
});
test('PAM-25 backend revalidates vanished targets/capabilities before any native effect', async () => {
  const { createMedia } = require('../sidecar/media.cjs');
  let current = [],
    effects = 0;
  const media = createMedia(async (r) => {
    if (r.method === 'media_sessions') return current;
    effects++;
    return { accepted: true };
  });
  for (const next of [
    [],
    [session('b')],
    [session(), session()],
    [session('a', 'Paused', false)],
  ]) {
    current = next;
    await assert.rejects(media.execute(player(), 'media_pause', {}));
  }
  assert.equal(effects, 0);
  current = [session()];
  await media.execute(player(), 'media_pause', {});
  assert.equal(effects, 1);
});
