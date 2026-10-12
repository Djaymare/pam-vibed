const { performance } = require('node:perf_hooks');
const WORK_BUDGET_MS = 40_000;
class BudgetError extends Error {
  constructor(stage) { super(`Le délai global de la demande est dépassé (${stage}). Aucun effet ne sera rejoué automatiquement.`); this.code = 'budget_expired'; }
}
function createBudget({ milliseconds = WORK_BUDGET_MS, now = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const started = now();
  const deadline = started + Math.max(0, Math.min(WORK_BUDGET_MS, milliseconds));
  const budget = {
    remaining: () => Math.max(0, Math.floor(deadline - now())),
    elapsed: () => Math.max(0, now() - started),
    check(stage) { if (budget.remaining() <= 0) throw new BudgetError(stage); },
    timeout(maximum = WORK_BUDGET_MS) { budget.check('préparation'); return Math.max(1, Math.min(maximum, budget.remaining())); },
    async run(operation, stage) {
      budget.check(stage);
      let timer;
      try {
        const result = await Promise.race([
          Promise.resolve().then(() => { budget.check(stage); return operation(); }),
          new Promise((_, reject) => { timer = setTimer(() => reject(new BudgetError(stage)), budget.remaining()); }),
        ]);
        budget.check(stage);
        return result;
      } finally { clearTimer(timer); }
    },
  };
  return budget;
}
function interruptedTurn(turn, message) {
  return { ...turn, status: 'partial', message,
    results: turn.results.map(result => result.outcome === 'unknown'
      ? {...result, success:false, message:'Résultat inconnu : la commande a pu être effectuée. Vérifiez l’application avant toute nouvelle demande.'} : result) };
}
module.exports = { createBudget, BudgetError, WORK_BUDGET_MS, interruptedTurn };
