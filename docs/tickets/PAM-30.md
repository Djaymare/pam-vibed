# PAM-30 — Vérifier la capacité réelle et les budgets de performance

Ticket : https://app.notion.com/p/3f7b3e0422a481c2948cec953a86e9a3

Run `c6124deb-00ca-405c-94f8-dd71183eebb3`, worker
`01a14c40-1c4d-7bc0-9511-7529469f046a`, génération 32.
Branche `codex/deezer-routing`, base
`5acf78bf49e10eca07a11a07e0daec060805d260`.
Autorisation humaine de lancement relue dans son chat source ; identité réelle,
transfert nominatif, branche, HEAD, index et empreintes de contrôle vérifiés.
PAM-18 et PAM-34 relus intégralement à Terminé, leurs preuves et commits
`73df40b1fe5857b8237f941d002e58bb33874ea5` et
`6acefc795ee3185c62635b43f579ac65df1ac796` vérifiés dans la branche.

## Réalisation

Le budget combine le préfixe système/outils réellement compté par `needle_init`,
les octets UTF-8 de demande comme borne conservatrice des tokens, 256 tokens de
réponse et 32 de cadrage, dans un contexte de 8 192 tokens. Les refus distinguent
catalogue trop volumineux et demande dépassant le budget restant. Ils produisent
un tour sans appel exécutable et sans diagnostic trompeur de panne du modèle.

Un catalogue enrichi de huit lecteurs, 56 outils, a atteint le délai de 40 s
pendant l’exploration. Le produit borne donc à 32 les outils proposés par
demande avant initialisation native. Les 32 applications enregistrées sont
conservées et expliquées dans Applications ; chaque catalogue reste soumis au
budget de tokens. Le plafond préventif n’est pas présenté comme un optimum ni
une garantie de latence. La sélection sûre existante d’une commande précise
reste inchangée. Aucun outil n’est tronqué arbitrairement ; les garde-fous de
routage, capacités, paramètres, cardinalité et confirmations restent actifs.

L’observateur optionnel des cinq étapes ne reçoit que `stage`, `durationMs` et
`success`. Aucun contenu personnel n’est conservé. Son absence ne crée aucun
journal. Le benchmark réutilise l’assistant et les moteurs réels, avec profils
synthétiques validés, voix locale, sessions et effets simulés. Le helper de
découverte Windows courant est recompilé et exécuté en lecture seule ; seules
les durées et tailles de catalogue sont conservées.

## Critères et preuves

| Critère du contrat | Preuves |
| --- | --- |
| Limite expliquée, p50/p95 et repos connus après reprises | Applications distingue 32 applications et 32 outils par demande. `docs/performance.md` décrit le protocole ; `docs/performance-results.md` et `docs/evaluation/performance.json` donnent les mesures 1/8/32 applications, profils simples/enrichis et trois générations. |
| Au plafond, aucune erreur demandant uniquement de raccourcir la phrase | Tests de frontière 8 192 tokens, UTF-8, 32/33 outils, refus natif à 32 lecteurs et demande précise réussie après refus. Messages qui proposent cible/action précise, désactivation, descriptions/alias ou demande plus courte selon la cause ; aucun effet émis. |
| Machine, versions, scénarios et distributions | JSON versionné : OS, CPU, mémoire, versions/revisions runtime, SHA-256 modèles/helper/sources, toutes les observations et distributions. p50/p95 au rang supérieur testés, N explicite. |
| Croissance mémoire visible, garanties limitées | RSS/heap/external avant et après chargement/requêtes/fermeture par génération ; repos CPU et RSS, pic échantillonné. Les trois générations sont affichées successivement. Aucune absence de fuite à long terme, borne universelle, mesure énergétique ou mémoire WebView2 n’est garantie. |

## Validations

Environnement : Windows x64, Node 24.21.0, npm 11.19.0, Rust 1.99.0,
Needle/Whistle et Koffi du manifeste runtime versionné par leurs empreintes.
Les journaux locaux ci-dessous sont ignorés ; les fixtures, scripts et résultats
de performance nécessaires sont suivis par Git et ne dépendent pas d’un ancien
audit sous `artifacts/`.

| Commande | Résultat / journal local |
| --- | --- |
| `npm test` | 385/385, 0 échec/ignoré ; `pam30-npm-test-final.log`. |
| `node --test sidecar/context-capacity.test.cjs tests/performance-metrics.test.mjs` | 5/5, y compris Needle Windows réel ; `pam30-capacity-final.log`. |
| `npm run build` dans la copie Windows | TypeScript/Vite réussis, 78 entrées identiques vérifiées ; `pam30-build-final.log`, `pam30-build-inputs.json`. |
| `npm run lint` dans la même copie | Réussi sans avertissement ; `pam30-lint-final.log`. |
| Prettier des sources nouvelles/touchées formatées | Réussi ; `pam30-format-final.log`. |
| `cargo build --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc --example discovery` | Réussi, helper recompilé depuis la branche ; `pam30-discovery-build.log`. Deux avertissements existants de code inutilisé, conservés. |
| `node scripts/benchmark-performance.mjs docs/evaluation/performance.json` | Réussi, six profils, 18 générations, 30 mesures par parcours chaud et profil ; `pam30-benchmark-final.log`. Sources et rapports validés par SHA-256 ; mesures et refus versionnés. |
| `npm run test:deezer:routing`, `npm run test:media:commands`, `npm run test:confidence` | Réussis sur le code final : 48 contrôles Deezer, 65 média, 32 cas de confiance et quatre formulations ; `pam30-deezer-final.log`, `pam30-media-final.log`, `pam30-confidence-final.log`. Moteur réel, aucun lecteur personnel commandé. |
| `git diff --check` | Réussi ; `pam30-diff-check.log`. |

## Incidents et limites

Le premier `npm test` lancé avec benchmark et suites concurrentes a obtenu
384/385 : le test existant `late preparation cannot emit an external effect
after the global timer fires` a dépassé sa borne murale de 140 ms. La suite
complète relancée seule passe 385/385 sans modifier ce test.

La campagne exploratoire a atteint le délai moteur (sortie 70) au profil
8 enrichi. Le profil synthétique restant ne contenait que `applications.json` ;
après constat de la fin du processus, son contenu a été comparé exactement à
la fixture validée, puis ce seul fichier et son répertoire vide ont été retirés.
Aucun fichier personnel n’a été commandé ou supprimé. Le rapport final conserve
cet échec comme justification limitée du plafond produit.

La racine possède des dépendances Linux préexistantes, préservées. Le build et
lint Windows utilisent la copie isolée aux mêmes sources, avec preuve d’égalité
des entrées. Le helper découverte est compilé en debug ; son temps inclut le
démarrage du processus et la préparation du catalogue natif.

La campagne n’est pas une validation de microphone, de lecteurs personnels,
de WebView2, de paquet portable/NSIS ou de signature. Le code Rust de production
n’est pas modifié ; aucune nouvelle campagne complète Rust/Clippy n’est
revendiquée. La mémoire sur trois générations, le cache disque conservé et les
effets simulés limitent les conclusions comme expliqué dans le protocole.
PAM-39 n’est pas implémenté et aucun objectif de performance non mesuré n’est
promis. Vérification réalisée par le worker implémenteur. Aucun sous-agent,
push, publication ou déploiement.

## Fichiers concernés

Assistant, planner, executor, moteur et worker ; nouveaux modules de budget
et métriques ; tests de contexte et quantiles ; benchmark, fixtures et
générateur de rapport ; script npm et contrôle des imports du bundle ; texte
de la page Applications ; protocole, rapport, données JSON et cette preuve.
