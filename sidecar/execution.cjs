const fs = require('node:fs/promises');
const path = require('node:path');
const { atomicJson } = require('./temporary-files.cjs');
const { interruptedTurn } = require('./budget.cjs');
function executionStore(directory) {
  const folder = path.join(directory, 'executions');
  return {
    async read(id) {
      try {
        const record = JSON.parse(await fs.readFile(path.join(folder, `${id}.json`), 'utf8'));
        if (record.version !== 1 || record.turn.id !== id || !Array.isArray(record.turn.results)) throw new Error('Reçu d’exécution invalide. Aucun rejeu autorisé.');
        return record.complete ? record.turn : interruptedTurn(record.turn, 'Exécution interrompue. Les actions déjà émises ne sont pas rejouées.');
      } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
    async save(turn, complete = false) {
      await fs.mkdir(folder, {recursive:true});
      await atomicJson(path.join(folder, `${turn.id}.json`), {version:1,complete,turn}, directory);
    },
  };
}
module.exports = { executionStore };
