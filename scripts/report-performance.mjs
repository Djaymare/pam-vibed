import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { distribution } from './performance-metrics.mjs';
const r = JSON.parse(await readFile('docs/evaluation/performance.json'));
assert.equal(r.completed, true);
assert.equal(r.scenarios.length, 6);
const n = (x) => Number(x).toFixed(2),
  mib = (x) => n(x / 2 ** 20);
let out = '# Mesures de capacité et performance PAM-30\n\n';
out +=
  'Généré par `node scripts/report-performance.mjs` depuis `docs/evaluation/performance.json`. Les données brutes et empreintes sont versionnées. Protocole et limites : `docs/performance.md`.\n\n';
out += `Campagne du ${r.startedAt} au ${r.completedAt}. Windows ${r.machine.release}, ${r.machine.arch}, ${r.machine.cpu}, ${r.machine.logicalCpus} processeurs logiques, ${mib(r.machine.totalMemoryBytes / 1024)} Gio de RAM. Node ${r.node}, npm runtime ${r.runtime.npm}, Koffi ${r.runtime.ffi}. Needle ${r.runtime.needleRevision}, Whistle ${r.runtime.whistleRevision}. Rust 1.99.0, helper de découverte recompilé en mode debug, cible x86_64-pc-windows-msvc et Cargo.lock conservé.\n\n`;
out +=
  'Six processus isolés, profils synthétiques validés, audio SAPI français local ; seuls les modèles et la découverte Windows sont réels. Effets et sessions média simulés. Trois générations successives par scénario, dix répétitions par génération et parcours. Le pic RSS est échantillonné à 50 ms ; le repos dure une seconde par génération. Aucun résultat ne constitue une garantie de performance ou de stabilité à long terme.\n\n';
out +=
  '## Démarrage et latences\n\nToutes les valeurs sont en millisecondes. Chaque cellule est p50 / p95, au rang supérieur. N = 30 par parcours chaud, N = 3 par chargement froid. Le JSON conserve les distributions complètes et les valeurs par génération.\n\n';
out +=
  '| Apps / profil | Processus prêt | Statut froid | Statut chaud | Découverte synthétique | Texte précis | Audio total | Whistle | Routage audio | Catalogue générique | Effet simulé |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n';
const pair = (s, k) => {
  const v = s.distributions[k];
  return v?.n ? `${n(v.p50)} / ${n(v.p95)}` : '—';
};
for (const s of r.scenarios)
  out += `| ${s.count} / ${s.kind} | ${n(s.processReadyMs)} (N=1) | ${pair(s, 'cold/statusTotal')} | ${pair(s, 'warm/statusTotal')} | ${pair(s, 'text/discovery')} | ${pair(s, 'text/requestTotal')} | ${pair(s, 'audio/requestTotal')} | ${pair(s, 'audio/transcription')} | ${pair(s, 'audio/routing')} | ${pair(s, 'catalogue/requestTotal')} | ${pair(s, 'effect/effect')} |\n`;
out +=
  '\nCes durées incluent les refus et ne sont pas des latences de réussite uniquement. Une transcription synthétique qui ne désigne pas exactement la cible peut conserver tout le catalogue puis être refusée. Les résultats suivants empêchent de présenter ce refus rapide comme une amélioration de compréhension.\n\n| Apps / profil | Texte : propositions / refus | Audio : propositions / refus | Générique : propositions / refus | Refus explicites de capacité (texte / audio / générique) |\n| --- | ---: | ---: | ---: | --- |\n';
for (const s of r.scenarios) {
  const records = (kind) =>
    s.records.filter((x) => x.stage === 'requestTotal' && x.scenario === kind);
  const result = (kind) => {
    const rows = records(kind);
    return `${rows.filter((x) => x.status === 'pending').length} / ${rows.filter((x) => x.status !== 'pending').length}`;
  };
  out += `| ${s.count} / ${s.kind} | ${result('text')} | ${result('audio')} | ${result('catalogue')} | ${['text', 'audio', 'catalogue'].map((k) => records(k).filter((x) => x.capacityRefusal).length).join(' / ')} |\n`;
}
out += `\nLa découverte Windows en helper neuf : N=${r.nativeDiscoveryDistribution.n}, p50 ${n(r.nativeDiscoveryDistribution.p50)} ms, p95 ${n(r.nativeDiscoveryDistribution.p95)} ms, maximum ${n(r.nativeDiscoveryDistribution.max)} ms. Les nombres d’entrées restent dans le JSON ; aucun nom d’application n’est conservé.\n\n`;
out +=
  '## Mémoire et repos après reprises\n\nRSS en Mio pour les générations 1 → 2 → 3. Les colonnes exposent les valeurs successives plutôt que masquer une croissance par une moyenne. CPU de repos en pourcentage d’un seul cœur.\n\n';
out +=
  '| Apps / profil | RSS après chargement | RSS après requêtes | RSS après fermeture | Pic RSS | CPU repos p50 / p95 |\n| --- | --- | --- | --- | ---: | ---: |\n';
for (const s of r.scenarios) {
  const mem = (label) =>
    s.memory
      .filter((m) => m.label === label)
      .map((m) => mib(m.rssBytes))
      .join(' → ');
  const cpu = distribution(s.idle.map((m) => m.cpuPercentOneCore));
  out += `| ${s.count} / ${s.kind} | ${mem('afterWarm')} | ${mem('afterRequests')} | ${mem('afterClose')} | ${mib(s.peakRssBytes)} | ${n(cpu.p50)} / ${n(cpu.p95)} |\n`;
}
const growth = r.scenarios
  .map((s) => {
    const closed = s.memory.filter((m) => m.label === 'afterClose');
    return { label: `${s.count} / ${s.kind}`, bytes: closed.at(-1).rssBytes - closed[0].rssBytes };
  })
  .sort((a, b) => b.bytes - a.bytes)[0];
out += `\nLa plus forte hausse entre la première et la troisième fermeture est de ${mib(growth.bytes)} Mio pour ${growth.label}. Cette croissance observée interdit de conclure à un plateau mémoire. Caches et allocateur ne rendent pas nécessairement immédiatement toute mémoire à Windows ; cette campagne ne distingue pas leur rétention d’une fuite native. Trois générations ne permettent pas de déclarer une absence de fuite ; aucune borne universelle ni plateau à long terme n’est garanti. Le heap JS et les allocations external sont aussi conservés dans les mesures brutes. Le pourcentage CPU inclut l’observateur RSS, pas WebView2, Rust ou la machine entière.\n\n`;
out +=
  '## Capacité réelle\n\nLe préfixe natif inclut système et outils. Les octets outils indiquent la taille sérialisée, sans les présenter comme des tokens. La demande de contrôle représente 16 octets UTF-8 ; le rapport donne sa valeur exacte. Réserves : 256 + 32 tokens. Les budgets sont mesurés à chaque génération ; la table montre la première.\n\n';
out +=
  '| Apps / profil | Sélection | Outils | Octets outils | Tokens préfixe | Octets demande | Budget contexte compatible | Plafond produit compatible | Refus catalogue observés |\n| --- | --- | ---: | ---: | ---: | ---: | --- | --- | ---: |\n';
for (const s of r.scenarios)
  for (const c of s.capacity.filter((c) => c.cycle === 0)) {
    const refusals = s.records.filter(
      (m) => m.scenario === 'catalogue' && m.stage === 'requestTotal' && m.capacityRefusal,
    ).length;
    out += `| ${s.count} / ${s.kind} | ${c.selection} | ${c.toolCount} | ${c.toolsBytes} | ${c.prefixTokens ?? c.errorCode} | ${c.requestUpperBound ?? '—'} | ${c.contextFits === undefined ? 'non mesuré' : c.contextFits ? 'oui' : 'non'} | ${c.toolCount <= 32 ? 'oui' : 'non'} | ${c.selection === 'all' ? refusals : '—'} |\n`;
  }
out +=
  '\nLe produit conserve 32 applications enregistrées et au plus 32 outils proposés par demande. Une demande précise conserve la sélection sûre existante d’un seul outil. Un catalogue dépassant le plafond est refusé avant initialisation native ; un catalogue sous ce plafond reste soumis au budget de tokens. Aucun catalogue n’est tronqué et aucune action n’est choisie arbitrairement pour faire tenir la requête.\n\n';
out +=
  '## Échecs exploratoires et portée\n\nUne première campagne avant le plafond préventif a terminé les profils 1 simple, 1 enrichi et 8 simple, puis le processus du profil 8 enrichi (56 outils disponibles) a atteint le délai moteur de 40 secondes, code de sortie 70. Cette exécution concurrente avec d’autres validations ne sert pas aux quantiles finaux ; elle établit un risque observé de délai, sans prouver que tous les catalogues de cette taille échouent. Le plafond de 32 outils est une limite produit prudente, pas un optimum statistique ou une promesse de délai. Les mesures finales ci-dessus utilisent seules les sources livrées.\n\n';
out +=
  'Le helper de découverte avait initialement une ancienne compilation ; la campagne finale utilise la compilation actuelle, dont le SHA-256 figure dans le JSON. Un premier lancement SAPI par Windows PowerShell a été refusé par sa politique de scripts ; l’appel de synthèse local explicite a ensuite réussi sans modifier cette politique. Une fixture comportait des alias tronqués identiques à deux chiffres : elle a été corrigée et validée avant la campagne finale.\n\n';
out +=
  'PAM-39 peut examiner séparément les coûts de découverte ou de transport audio à partir de ces durées. Cette campagne ne démontre pas à elle seule qu’une optimisation soit nécessaire à un objectif produit : aucun objectif chiffré n’a été approuvé. Elle ne mesure ni microphone réel, ni démarrage système sans cache, ni consommation énergétique, ni lecteur personnel, ni paquet NSIS.\n';
await writeFile('docs/performance-results.md', out);
console.log('docs/performance-results.md generated');
