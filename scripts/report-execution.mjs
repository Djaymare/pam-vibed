import { readFile, writeFile } from 'node:fs/promises';
import { summarize } from './execution-metrics.mjs';
const reports = await Promise.all(
  ['calibration-baseline', 'calibration-policy', 'heldout-policy'].map(async (name) => {
    const report = JSON.parse(await readFile(`docs/evaluation/execution-${name}.json`));
    return { name, report, summary: summarize(report) };
  }),
);
let out =
  '# Mesures PAM-29 — résultats du corpus figé\n\nGénéré par `node scripts/report-execution.mjs` depuis les trois rapports JSON versionnés.\nLes erreurs et refus sont conservés ; aucune proposition incorrecte n’est effacée.\n\n';
const columns =
  '| Groupe | N | Positifs | Négatifs | Auto | Faux déclenchements | Auto erronés | Confirmations | Propositions erronées | Refus | Refus positifs | Plans exacts | Erreurs de validation | Erreurs de mots / mots de référence |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n';
function row(name, s) {
  return `| ${name} | ${s.samples} | ${s.positiveRequests} | ${s.negativeRequests} | ${s.automatic} | ${s.falseTriggers} | ${s.wrongAutomaticActions} | ${s.confirmations} | ${s.wrongProposals} | ${s.refusals} | ${s.positiveRefusals} | ${s.exactPlans} | ${s.validationErrors} | ${s.wordErrors} / ${s.referenceWords} |\n`;
}
out += '## Totaux\n\n' + columns + reports.map((r) => row(r.name, r.summary.total)).join('');
for (const { name, summary } of reports) {
  out += `\n## ${name}\n\n`;
  for (const [heading, key] of [
    ['Modalité', 'byVariant'],
    ['Catégorie', 'byCategory'],
    ['Langue configurée', 'byLanguage'],
  ])
    out +=
      `### ${heading}\n\n` +
      columns +
      Object.entries(summary[key])
        .map(([group, s]) => row(group, s))
        .join('') +
      '\n';
  out +=
    '### Seuil seul, politique initiale simulée sur les réponses natives\n\n| Seuil | Auto | Faux déclenchements | Auto erronés | Confirmations |\n| ---: | ---: | ---: | ---: | ---: |\n';
  for (const s of summary.thresholdSweep)
    out += `| ${s.threshold} | ${s.automatic} | ${s.falseTriggers} | ${s.wrongAutomaticActions} | ${s.confirmations} |\n`;
}
await writeFile('docs/execution-policy-results.md', out);
