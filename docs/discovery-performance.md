# Découverte Windows : mesure et optimisation ciblée

PAM conserve une énumération Windows fraîche pour vérifier une inscription,
un lancement et la disponibilité des applications. Le sélecteur demande les
icônes du catalogue entier. Le statut ne demande aucun pixel ; la préparation
d’une cible demande uniquement son icône, sélectionnée par son identifiant
exact. Les objets COM restent dans leur STA et les bitmaps conservent leurs
gardes RAII, leur limite de 64 × 64 et l’encodage PNG existants.

Cette distinction évite le travail inutile sans ajouter de cache d’autorité,
de durée de validité ou de stockage d’icônes. Les métadonnées, exclusions,+raccourcis et contrôles de cible sont toujours relus depuis Windows. Un échec
ou une application disparue reste indisponible. Les validations IPC et audio,
le plafond audio et l’invalidation des réponses après fermeture du sélecteur
conservent leur chemin de production.

## Reproduire la comparaison native

Sur Windows x64 avec les outils de `docs/development.md`, préparer deux
fixtures de compilation séparées. Le script affiche leur manifeste et les
SHA-256 des sources :

```powershell
node scripts/prepare-discovery-benchmark.mjs 9044d466db205b52c1b4db2c2a850a832c19a147
node scripts/prepare-discovery-benchmark.mjs workspace
```

Pour chaque manifeste affiché, employer un `CARGO_TARGET_DIR` distinct dans
son dossier. Exécuter `cargo build --manifest-path CHEMIN --locked --offline
--target x86_64-pc-windows-msvc --bins`. Les dépendances doivent être disponibles
dans le cache Cargo. Le script copie le lockfile versionné
`tests/fixtures/discovery-benchmark.Cargo.lock`, identique aux deux lockfiles
de cette campagne. Les sources de production ne sont pas modifiées pour la
compilation de référence. Le helper et ses assertions de métadonnées sont
identiques.

Passer les deux exécutables `discovery-performance.exe` au même pilote :

```powershell
node scripts/benchmark-discovery.mjs AVANT.exe APRES.exe resultat.json
```

Dix essais alternent l’ordre avant/après. Le pilote exige au moins 32
applications Windows installées pour son scénario chargé. Chaque essai démarre un processus
par version et par opération : catalogue complet (`all`), disponibilité de
32 inscriptions (`status`) et préparation d’une cible (`target`). Une première
lecture du statut établit le catalogue de référence ; la seconde opération est
chronométrée. Les identifiants, noms, types et arguments doivent être identiques
entre ces deux lectures. Aucune application n’est lancée. Les résultats ne
contiennent que compteurs, durées, mémoire et empreintes des binaires.

Le pic de working set est celui du processus entier, prélecture comprise,
fourni par [GetProcessMemoryInfo](https://learn.microsoft.com/en-us/windows/win32/api/psapi/nf-psapi-getprocessmemoryinfo). Il ne représente pas les allocations d’une
seule fonction ni la mémoire de PAM/WebView2. Le temps `processMs` inclut la
prélecture et le démarrage ; `durationMs` mesure la seconde opération. Les
p50/p95 utilisent le rang supérieur. Aucun cache disque n’est vidé ; il ne
s’agit pas d’un démarrage après redémarrage de Windows. Le catalogue installé
et la charge de la machine peuvent changer les résultats.

## Rejouer PAM-30

Le binaire `discovery.exe` de chaque fixture exécute le même scénario PAM-30 :
scan complet, préparation d’une cible absente et annotation d’un statut avec
une cible absente, dans un nouveau processus. Positionner
`PAM_BENCH_DISCOVERY` sur chaque binaire, puis exécuter successivement :

```powershell
npm run bench:performance -- avant.json
npm run bench:performance -- apres.json
```

Le pilote conserve six profils synthétiques (1/8/32 applications, simples ou
enrichis), trois générations et dix répétitions par génération. Les moteurs
restent réels ; les sessions et effets sont simulés. La sonde de capacité
applique maintenant le plafond produit avant initialisation : les catalogues
de 56/224 outils sont consignés comme refusés, au lieu de contourner ce
plafond et risquer un arrêt natif de code 70. Cette même méthode est appliquée
aux deux versions ; aucune latence de réussite n’est attribuée à un refus.
Les empreintes des sources de découverte réellement compilées sont dans la
provenance des fixtures ; celles du rapport PAM-30 décrivent le checkout du
pilote au moment de l’exécution.

Les données natives sont dans `docs/evaluation/discovery-performance.json`.
Le bilan chiffré et les limites propres à cette campagne sont dans
`docs/tickets/PAM-39.md`.
