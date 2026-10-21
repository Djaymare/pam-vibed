import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { checkWorkflows, parseWorkflow, validateWorkflows } from '../scripts/check-workflows.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const workflows = await checkWorkflows(root);
const pins = JSON.parse(await readFile(new URL('../.github/action-pins.json', import.meta.url)));
const versions = { node: '24.21.0', rust: '1.99.0' };

test('les workflows réels sont lisibles, bornés et sans autorité de livraison', () => {
  assert.equal(workflows.length, 2);
  assert.deepEqual(validateWorkflows(workflows, pins, versions), []);
  const build = workflows.find((w) => w.name === 'windows.yml').workflow;
  assert.deepEqual(Object.keys(build.jobs), ['native-tests', 'build', 'linux']);
  assert.equal(build.jobs['native-tests'].steps[0].with['fetch-depth'], 0);
});

test('la CI Windows reçoit les pushes de la branche d’intégration PAM', async () => {
  const queue = JSON.parse(await readFile(new URL('../docs/autonomy/pam-queue.json', import.meta.url)));
  const windows = workflows.find((w) => w.name === 'windows.yml').workflow;
  assert.ok(
    windows.on.push.branches.includes(queue.project.integrationBranch),
    `La branche d’intégration ${queue.project.integrationBranch} doit déclencher les tests natifs`,
  );
  assert.ok(Object.hasOwn(windows.on, 'workflow_dispatch'));
});

const mutations = [
  [
    'permissions racine en écriture',
    (w) => {
      w.permissions.contents = 'write';
    },
    /permissions/,
  ],
  [
    'élévation par job',
    (w, j) => {
      j.permissions = { 'id-token': 'write' };
    },
    /permissions/,
  ],
  [
    'secret hérité',
    (w) => {
      w.env = { SIGNING_KEY: '${{ secrets.SIGNING_KEY }}' };
    },
    /secrets/,
  ],
  [
    'secret dans une étape',
    (w, j) => {
      j.steps.push({ run: 'echo test', env: { KEY: '${{ secrets.KEY }}' } });
    },
    /secrets/,
  ],
  [
    'événement PR privilégié',
    (w) => {
      w.on.pull_request_target = {};
    },
    /event/,
  ],
  [
    'workflow_run privilégié',
    (w) => {
      w.on.workflow_run = { workflows: ['other'] };
    },
    /event/,
  ],
  [
    'environnement de signature',
    (w, j) => {
      j.environment = 'production';
    },
    /environment/,
  ],
  [
    'action mutable',
    (w, j) => {
      j.steps[0].uses = 'actions/checkout@v4';
    },
    /full commit/,
  ],
  [
    'commit non vérifié',
    (w, j) => {
      j.steps[0].uses = 'actions/checkout@' + 'a'.repeat(40);
    },
    /full commit/,
  ],
  [
    'credentials persistés',
    (w, j) => {
      j.steps[0].with['persist-credentials'] = true;
    },
    /credentials/,
  ],
  [
    'timeout absent',
    (w, j) => {
      delete j['timeout-minutes'];
    },
    /timeout/,
  ],
  [
    'timeout excessif',
    (w, j) => {
      j['timeout-minutes'] = 360;
    },
    /timeout/,
  ],
  [
    'multiplication des jobs',
    (w, j) => {
      j.strategy = { matrix: { os: ['a', 'b'] } };
    },
    /cost review/,
  ],
  [
    'annulation absente',
    (w) => {
      w.concurrency['cancel-in-progress'] = false;
    },
    /concurrency/,
  ],
  [
    'groupe mêlant toutes les PR',
    (w) => {
      w.concurrency.group = '${{ github.workflow }}';
    },
    /concurrency/,
  ],
  [
    'cache Rust dans une PR',
    (w, j) => {
      delete j.steps.find((s) => s.uses?.startsWith('Swatinem/')).if;
    },
    /trusted pushes/,
  ],
  [
    'cache Rust partagé entre jobs',
    (w, j) => {
      j.steps.find((s) => s.uses?.startsWith('Swatinem/')).with['shared-key'] = 'shared';
    },
    /branch and job/,
  ],
  [
    'binaire Cargo mis en cache',
    (w, j) => {
      j.steps.find((s) => s.uses?.startsWith('Swatinem/')).with['cache-bin'] = true;
    },
    /executable outputs/,
  ],
  [
    'cache npm dans une PR',
    (w) => {
      w.jobs.build.steps.find((s) => s.uses?.startsWith('actions/setup-node')).with.cache = 'npm';
    },
    /trusted pushes/,
  ],
  [
    'rétention excessive',
    (w) => {
      w.jobs.build.steps.find((s) => s.uses?.startsWith('actions/upload')).with['retention-days'] =
        90;
    },
    /retention/,
  ],
  [
    'artefacts cachés',
    (w) => {
      w.jobs.build.steps.find((s) => s.uses?.startsWith('actions/upload')).with[
        'include-hidden-files'
      ] = true;
    },
    /hidden files/,
  ],
  [
    'upload du checkout',
    (w) => {
      w.jobs.build.steps.find((s) => s.uses?.startsWith('actions/upload')).with.path = '.';
    },
    /explicit/,
  ],
  [
    'toolchain flottante',
    (w, j) => {
      j.steps.find((s) => s.uses?.startsWith('dtolnay/')).with.toolchain = 'stable';
    },
    /Rust/,
  ],
  [
    'Node divergent',
    (w, j) => {
      j.steps.find((s) => s.uses?.startsWith('actions/setup-node')).with['node-version'] = 'latest';
    },
    /Node/,
  ],
];

for (const [name, mutate, expected] of mutations) {
  test(`la politique refuse : ${name}`, () => {
    const changed = structuredClone(workflows);
    const w = changed.find((item) => item.name === 'windows.yml').workflow;
    mutate(w, w.jobs['native-tests']);
    assert.match(validateWorkflows(changed, pins, versions).join('\n'), expected);
  });
}

test('les clés YAML dupliquées et les alias sont refusés', () => {
  assert.throws(() => parseWorkflow('permissions: {}\npermissions: write-all\n'), /unique/);
  assert.throws(() => parseWorkflow('a: &shared [1]\nb: *shared\n'), /alias/i);
});
