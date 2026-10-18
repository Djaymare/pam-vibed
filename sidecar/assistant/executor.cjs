// Owns effect emission and the durable no-replay journal.
const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');
const { executionStore } = require('../execution.cjs');
const { failure } = require('../diagnostics.cjs');
const { validateCalls } = require('./intent.cjs');
const { ensure } = require('./validation.cjs');
const { measure } = require('./performance.cjs');
async function launch(application, args, { budget, beforeEffect } = {}) {
  ensure(
    !application.windowsApp,
    'Le lancement d’une application du catalogue Windows nécessite l’hôte natif de PAM pour vérifier sa disponibilité.',
  );
  ensure(
    (await fs.stat(application.executable)).isFile(),
    `Exécutable de ${application.name} introuvable.`,
  );
  const argv = application.arguments.map((argument) =>
    argument.replaceAll('{input}', args.input ?? ''),
  );
  await beforeEffect?.();
  budget?.check('lancement');
  await new Promise((resolve, reject) => {
    const child = spawn(application.executable, argv, {
      shell: false,
      windowsHide: true,
      detached: true,
      stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
  return {
    applicationName: application.name,
    success: true,
    message: `Commande de lancement envoyée à ${application.name}. L’ouverture effective n’est pas observée par PAM.`,
  };
}
function createExecutor({ configDirectory, media, launchApplication = launch }) {
  const executions = executionStore(configDirectory);
  async function executeCalls(turn, config, context) {
    // Validate the whole plan before any executable is launched.
    const validated = validateCalls(turn.calls, config);
    const { budget, onProgress = () => {} } = context;
    turn.results = validated.map((call, index) => ({
      index,
      name: call.name,
      applicationId: call.applicationId,
      applicationName: call.applicationName,
      outcome: 'not_started',
      success: false,
      message: 'Action non démarrée.',
    }));
    const publish = async (complete = false) => {
      await executions.save(turn, complete);
      onProgress(structuredClone(turn));
    };
    await publish();
    for (const [index, call] of validated.entries()) {
      if (budget.remaining() <= 0) break;
      const application = config.applications.find((app) => app.id === call.applicationId);
      let emitted = false;
      const beforeEffect = async () => {
        budget.check('avant effet');
        turn.results[index] = {
          ...turn.results[index],
          outcome: 'unknown',
          message: 'Commande émise ; résultat non confirmé.',
        };
        // Persist intent before emission. A crash between these steps is
        // conservatively unknown and never grants permission to replay.
        await publish();
        budget.check('avant effet');
        emitted = true;
      };
      try {
        const result = await measure(context, 'effect', () =>
          budget.run(
            () =>
              call.action && call.action !== 'open'
                ? media.execute(application, call.action, call.arguments, { budget, beforeEffect })
                : launchApplication(application, call.arguments, { budget, beforeEffect }),
            'exécution',
          ),
        );
        if (!result.success) {
          const diagnostic = failure(new Error(result.message), context, 'action_failure');
          result.message = diagnostic.message;
          result.error = diagnostic;
        }
        turn.results[index] = {
          ...turn.results[index],
          ...result,
          outcome: result.success ? 'performed' : 'failed',
        };
      } catch (error) {
        const timedOut = error.code === 'budget_expired' || error.outcome === 'unknown';
        const diagnostic = failure(error, context, 'action_failure', timedOut ? 'host' : 'target');
        turn.results[index] = {
          ...turn.results[index],
          success: false,
          outcome: timedOut ? (emitted ? 'unknown' : 'not_started') : 'failed',
          message: diagnostic.message,
          error: diagnostic,
        };
      }
      await publish();
      if (budget.remaining() <= 0 || turn.results[index].outcome === 'unknown') break;
    }
    turn.status = turn.results.every((result) => result.outcome === 'performed')
      ? 'executed'
      : turn.results.some((result) => ['unknown', 'not_started'].includes(result.outcome))
        ? 'partial'
        : 'failed';
    turn.durationMs = budget.elapsed();
    if (turn.status === 'partial')
      turn.message =
        'La demande s’est arrêtée avant confirmation de toutes les actions. Vérifiez les résultats avant de reformuler.';
    await publish(true);
    return turn;
  }

  return { execute: executeCalls, read: (id) => executions.read(id) };
}
module.exports = { createExecutor, launch };
