# PAM-33 — Faire de la CI une barrière de qualité complète

Ticket : https://app.notion.com/p/3f7b3e0422a4810fbde8dc39cbddf6f7

Run `c6124deb-00ca-405c-94f8-dd71183eebb3`, worker
`01a15f9d-660f-7f90-a4ac-837e852597d9`, génération 42.
Base : `673beab14b9d9ddec4b92e3c05584543d7a5f86c` sur
`codex/deezer-routing`. Autorisation humaine d'origine vérifiée par lecture
du message `01a1302e-be0e-7f21-b801-56d9d7a578e7`. Relais nominatif
`dbde360d-df26-40e3-b922-8c2b2a25c5df` acquis après libération du verrou court.
Checkout/index initialement propres ; huit empreintes de contrôle conformes.

Les cinq prérequis PAM-31/32/34/36/37 ont été intégralement relus dans Notion,
confirmés Terminé et leurs commits vérifiés ancêtres de la base. Le contrat
de départ et ses relations sont conservés dans
`artifacts/autonomy/contracts/c6124deb-00ca-405c-94f8-dd71183eebb3/PAM-33-g42.json`.

## Implémentation

Quatre jobs liés explicitement : quick, puis native-tests et Linux, puis build.
Le premier exécute format/lint, tests Node/composants et TypeScript/Vite. Le job
natif vérifie Rust, les défauts historiques et les parcours WebView2. Le job
Windows final exécute les moteurs réels, confiance et routage Deezer/média,
construit NSIS/portable, contrôle le paquet final et produit sa provenance.
Son upload exige le succès de tous ces contrôles. Les diagnostics d'échec
sont conservés par des uploads distincts, sans paquet.

Le runner lance ses commandes sans shell, conserve stdout/stderr et un reçu
par étape, borne les durées et s'arrête au premier échec. Les tests de politique
refusent dépendances manquantes, contournements de succès et uploads de paquet
avant contrôle. Les tests du runner provoquent échec, timeout et spawn impossible.
Les trois tests Node avec vrais modèles (Unicode, protocole, capacité) sont
séparés dans tests/integration et restent obligatoires. npm test est sans modèle.

La suite Linux ne fonctionnait plus : deux fixtures décrivaient le Node Linux
comme exécutable Windows ; une troisième utilisait la même valeur via les
fixtures de performance. Ces fixtures utilisent un chemin Windows synthétique
sur Linux, sans affaiblir la validation de production. Une attente de readiness
est interrompue si l'enfant meurt. Docker installe aussi Git, nécessaire aux
fixtures de packaging ajoutées depuis sa préparation initiale.

Procédure, niveaux de tests, diagnostics, checks de branche à rendre requis et
limites : `docs/ci-quality.md`. Les protections de branche ne sont pas activées.
Permissions read-only, SHA des actions, absence de secrets et caches fiables
de PAM-37 sont conservés. Aucun circuit de signature/publication n'est ajouté.

## État des critères à ce checkpoint

| Critère du contrat | Preuve et état |
| --- | --- |
| Une PR ne publie aucun artefact de paquet après échec ; format/Rust visibles avant packaging | Implémenté par needs et upload success ; mutations locales vertes. Exécution GitHub non réalisée, critère encore ouvert. |
| Format erroné, test Rust/UI rouge ou paquet incomplet interdit la livraison | Runner, mutations de politique et tests de packaging locaux. Scénarios GitHub à exécuter, critère encore ouvert. |
| Tests réels distingués des simulations, sans applications personnelles | Satisfait : trois tests Node avec moteurs réels, Rust engine-integration, suites Needle et smoke de paquet exécutés ; WebView2 utilise IPC simulé et micro synthétique, Needle utilise profils/sessions de test. Aucun programme personnel commandé. |
| Exécution neuve réussie avec artefact lié au commit et résultats | Provenance et garde de commit codées ; CI distante pas encore exécutée, critère ouvert. |

## Contrôles locaux déjà exécutés

Windows 11 x64, Node 24.21.0/npm 11.19.0, Rust 1.99.0/MSVC. Toolchain locale
préparée dans artifacts/pam34/tooling, target distinct dans
artifacts/pam34/windows/src-tauri/target. Les commandes des runners restent
identiques à celles de CI ; les chemins de toolchain/target sont injectés.

| Commande ou contrôle | Résultat réel | Trace locale ignorée |
| --- | --- | --- |
| npm run ci:quick | 0 : format/lint, bindings, 451 tests Node sans échec/ignoré, 99 composants, TypeScript/Vite ; ensuite une mutation de politique pipefail supplémentaire vérifiée par la suite ciblée | pam33-quick-final.log et artifacts/ci/quick |
| node --test tests/ci-quality.test.mjs tests/workflow-security.test.mjs | 0, 46 tests ; 14 mutations qualité, 24 mutations sécurité, parsing et tests du runner | pam33-ci-tests-final.log |
| actionlint 1.7.12 sur les deux workflows | 0 | sortie du chat, commande réexécutée avant commit |
| npm run ci:native | 0 : rustfmt, Clippy -D warnings, 57 tests Rust, contrôles historiques, hôte WebView2, 162 assertions et nettoyage avec échec provoqué attendu | pam33-native.log, artifacts/ci/native, artifacts/webview-tests/1792606206603, artifacts/webview-cleanup/1792606272005 |
| Anciennes fixtures Linux exactes de la base, même production actuelle | 1 : profils invalides, exit 1 au lieu de 70, attentes de kill/active expirées à 5 s | pam33-linux-fixtures-before.log |
| Fixtures corrigées Windows/Linux | 0, 15 contrôles sur chaque OS | pam33-fixtures-windows.log, pam33-linux-fixtures-after.log |
| Image Docker puis commande complète | 0 : 449 tests réussis, deux skips Windows, zéro échec ; TypeScript/Vite, runtime de 2025 fichiers et cargo xwin check locked Windows | pam33-docker-build-final2.log, pam33-linux-validation-final2.log |

Les deux skips Linux concernent le verrou de fichier Windows et le plugin
enregistré ; ils passent dans la suite Windows. L'avertissement de détection
clang-cl n'empêche pas cargo xwin check. Le runner WebView2 émet un avertissement
d'icône et provoque intentionnellement une erreur pour vérifier son nettoyage ;
son wrapper réussit après avoir vérifié le code non nul et la libération des
ressources. Aucun succès visuel, NVDA ou microphone physique n'est inféré.

Une première image sans Git a échoué sur les six fixtures de packaging ; la
suivante a exposé le profil de capacité Linux, corrigé ensuite. Ces traces ne
sont pas effacées. Le scan de sécurité indépendant existant a aussi été exécuté
localement : audit complet mais needsReview true, donc code 1 du security:gate
(avis Vite et changements amont du runtime). Il reste inchangé dans son workflow
séparé ; un succès du workflow Windows ne signifie pas un scan de sécurité vert.
La revue sécurité reste nécessaire avant toute future signature/publication.

## Validation locale finale sur le commit de code

Code testé : `1a217ac6ce39b7c7fd16ace81e893a49c7fa00bf`. Le checkout est propre
au démarrage des phases quick, intégration et packaging ; leurs rapports
enregistrent ce SHA et workingTreeClean true. Les compléments ultérieurs de ce
document ne modifient aucun des fichiers de code/ressources testés.

| Commande ou scénario | Résultat réel | Trace |
| --- | --- | --- |
| npm run ci:quick | 0 : 452 tests Node, zéro échec/ignoré ; 99 composants, format, lint, politique et TypeScript/Vite | pam33-quick-committed.log, artifacts/ci/quick/report.json |
| Image Docker du commit : format/lint, composants, npm test et build | 0 : 450 tests réussis, deux skips Windows, 99 composants et build ; bindings Linux réels | pam33-docker-committed-build.log, pam33-linux-committed-quick.log |
| npm run ci:integration | 0 : préparation runtime ; 58 tests Rust avec feature moteur ; trois tests Node réels ; smoke runtime ; 32 cas et quatre formulations de confiance, 48 cas Deezer et 65 cas média | pam33-integration.log, artifacts/ci/integration/report.json |
| npm run ci:package | 0 : NSIS neuf, portable neuf de 2112 fichiers, verify:bundle puis preuve de commit/manifeste/installeur | pam33-package.log, artifacts/ci/package/report.json, artifacts/ci/delivery.json |
| Faute de format Rust isolée | Échec attendu code 1 de cargo fmt --check, diff exact sur use host::AssistantBridge | pam33-negative-format.log |
| Test Rust rouge isolé, correctement formaté et Clippy vert | Échec attendu code 101 : pam33_ci_failure::deliberately_red, 1 attendu égal à 2 ; production partagée inchangée | pam33-negative-rust-format.log, pam33-negative-rust-clippy.log, pam33-negative-rust.log |
| Test Vue/IPC rouge isolé | Échec attendu code 1 de component-journeys.test.mjs, nombre de demandes 1 au lieu de 2 ; vrais composables et IPC simulé | pam33-negative-ui.log |
| Copie du vrai portable avec uniquement sidecar/contracts.cjs absent | Échec attendu code 1 de verify:bundle ; une seule commande exécutée, marqueur de livraison suivante absent ; portable source revérifié et intact | pam33-negative-bundle/report.json, pam33-negative-bundle-result.json |

Le contrôle de paquet incomplet utilise des liens physiques en lecture seule
vers les fichiers du paquet, omet exactement une ressource et supprime ensuite
uniquement son store temporaire borné. Aucun fichier du portable original n'est
modifié. Une première assertion du harnais attendait le nom du fichier dans
l'erreur ; le vérificateur émet une erreur générique d'inventaire. Le harnais
vérifie désormais l'écart exact de fichiers et cette erreur réelle ; trace
initiale conservée dans pam33-negative-bundle-initial.log.

BuildId : `9f39cc4e-6d5f-49f9-8f1a-4ddc9037046a`. Portable :
`artifacts/PAM-windows-x64/releases/4fd88a2c-88d5-44a2-825a-386c9cb1eb7e`.
Empreinte du manifeste :
`407a3e99d8caa957bfbb08920d7b720f44e3182e10080d64541040bf9e377828`.
NSIS `PAM_0.1.0_x64-setup.exe` :
`837eca79b4ae29bda5d12ed18891e6dabd361c64313416367391b98309fb4dac`.
L'installeur est construit, pas installé. verify:bundle exécute le binaire,
le sidecar, Needle, un exécutable jetable et du silence Whistle depuis le
portable final avec PATH vide. Les profils/ressources/processus sont nettoyés.
Les deux PID WebView2 sont confirmés absents ; Docker, initialement arrêté et
démarré pour ces contrôles, est arrêté après disparition des conteneurs de test.

## Plan distant préparé, non exécuté

Le plan exact est `artifacts/autonomy/pam33-probes/plan.json` : cinq pushes
sur branches de test nouvelles, cinq PR brouillon sans reviewers, collecte
des jobs/logs/artefacts, annulation des seuls runs de sonde devenus inutiles
après preuve de leur échec, puis fermeture sans fusion et suppression des cinq
branches. Aucun push de l'intégration ni changement de permissions.

| Branche | SHA préparé | Résultat à observer |
| --- | --- | --- |
| codex/pam33-valid-g42 | `1a217ac6ce39b7c7fd16ace81e893a49c7fa00bf` | Quatre jobs verts et artefact NSIS/portable/preuves lié au SHA GitHub testé |
| codex/pam33-format-g42 | `d038b6040407b46f68917ea4359a002b5757deeb` | Format Rust rouge, build ignoré, diagnostics seuls |
| codex/pam33-rust-g42 | `25e8896990eccc40b1ca9e74b39c7f8befd654ff` | Test Rust rouge, build ignoré, diagnostics seuls |
| codex/pam33-ui-g42 | `f2669d8b4141fc1e75461feee902624d7fa5cee0` | Test Vue rouge dans quick, jobs dépendants ignorés, diagnostics seuls |
| codex/pam33-bundle-g42 | `6bea29443bc665a518da9e8f603b61da7639eaa0` | Retrait d'une ressource après assemblage, verify:bundle rouge, aucun artefact de paquet |

Les quatre commits fautifs sont des objets Git détachés, jamais ancêtres du
HEAD d'intégration. Ils conservent permissions, délais et dépendances du vrai
workflow. Le défaut de paquet ajoute seulement une commande de test avant
verify:bundle ; il ne neutralise pas les contrôles. Les branches sont absentes
du remote lors de la préparation. Cible des PR : codex/deezer-routing, dont le
HEAD distant observé est `8c57384f0bc4f80be4290d8c179ba0c612798a9f`.
Le plan inclut les trois commits de preuve PAM-31/37 encore locaux présents
dans l'ascendance du code ; le diff sortant et la liste des commits sont joints.

Le test utilisera des PR du même dépôt ; aucun mécanisme propre aux forks
n'est revendiqué. Le workflow sécurité séparé pourra être rouge à cause des
avis/changements amont déjà observés : son résultat devra rester explicite.
Une réussite du workflow Windows entier et son artefact restent à constater.
Le plan ne fusionne, ne signe, ne publie et ne modifie aucun réglage du dépôt.

Une validation GitHub sur branches de travail est explicitement requise par
le contrat. Aucun push n'est autorisé par le lancement général de la chaîne.
Les autorisations PAM-31 et PAM-37 portent sur leurs opérations déjà terminées.
PAM-33 reste donc ouvert tant que les runs et leur artefact ne sont pas vérifiés.
Outcome : blocked pour clôture, validation distante et autorisation ciblée en attente.
Pas de successeur ni de transfert avant résolution. Vérification par le worker
implémenteur, sans revue indépendante revendiquée.

## Exécution distante autorisée du 21 octobre 2026

L'utilisateur a approuvé le plan et son nettoyage dans le message
`01a15fda-6cf2-7df1-aca3-10da282b2134`, tour
`01a15fda-6c81-7ca0-81f0-78348991e1c0`. Les cinq pushes préparés ont été
vérifiés, sans push d'intégration. Les PR brouillon sans reviewers sont
[3 valide](https://github.com/Djaymare/pam-vibed/pull/3),
[4 format](https://github.com/Djaymare/pam-vibed/pull/4),
[5 Rust](https://github.com/Djaymare/pam-vibed/pull/5),
[6 UI](https://github.com/Djaymare/pam-vibed/pull/6) et
[7 paquet incomplet](https://github.com/Djaymare/pam-vibed/pull/7).

Le [run valide 39658827906](https://github.com/Djaymare/pam-vibed/actions/runs/39658827906)
échoue deux fois dans quick sur le test existant `late preparation cannot emit
an external effect after the global timer fires` : 229 ms puis 324 ms au lieu
de la borne murale de 140 ms. Le [run format 39658862774](https://github.com/Djaymare/pam-vibed/actions/runs/39658862774)
échoue aussi dans quick avant rustfmt, avec le même défaut, dont 295 ms lors
de la première tentative. Les logs et diagnostics des deux tentatives sont
conservés ; les jobs dépendants sont skipped et aucun paquet n'est publié.
Une seule relance des jobs échoués, sur chaque SHA inchangé, a été effectuée.
Ces échecs ne sont pas transformés en succès.

Le [run UI 39658873392](https://github.com/Djaymare/pam-vibed/actions/runs/39658873392)
présente bien l'assertion Vue volontairement fausse (une demande au lieu de
deux), en plus du défaut de durée. quick échoue, native-tests/Linux/build sont
skipped, seuls les diagnostics sont uploadés.

Le [run Rust 39658866997](https://github.com/Djaymare/pam-vibed/actions/runs/39658866997)
passe quick et Linux. Le job native-tests échoue sur l'unique test volontaire
`pam33_ci_failure::deliberately_red` : 57 réussis et un échec, après rustfmt et
Clippy réussis. build est skipped. Les trois artefacts sont exclusivement des
diagnostics, dont l'artefact natif 12373396632. La sonde de paquet incomplet
[39658878156](https://github.com/Djaymare/pam-vibed/actions/runs/39658878156)
a passé quick, Linux et native-tests ; son job build est encore en cours à ce
checkpoint. Aucune réussite de ce run ou du scénario incomplet n'est anticipée.

### Correction locale de la régression de chronométrage

Le test utilise désormais une horloge et les timers injectables du budget de
production, avec une préparation explicitement bloquée. Il déclenche le timer
au temps logique de 60 ms et exige le résultat partial et deux not_started
avant de débloquer la préparation. Il exige ensuite zéro effet tardif et aucun
timer restant. Aucun budget, lancement, contrôle ou délai de production ne
change ; aucune augmentation de la borne ne masque le défaut de test.

Preuves : huit tests budget réussis ; 452 tests Node Windows réussis ; Linux
450 réussis et deux skips Windows ; vingt répétitions réussies avec deux
processus de stress CPU jetables. Le contrôle négatif qui retire les deux
gardes avant effet dans une copie isolée fait échouer cette nouvelle régression.
Traces : pam33-deterministic-budget.log, pam33-node-after-clock-fix.log,
pam33-clock-linux.log, pam33-clock-controls.json, pam33-clock-negative.log et
pam33-clock-stress.log sous artifacts/autonomy.

Cette correction reste locale à ce checkpoint. Les cinq pushes exacts du plan
initial sont consommés ; un nouveau plan concret devra être autorisé avant
tout push supplémentaire. La CI neuve réussie et l'artefact requis manquent
toujours. Le ticket reste ouvert et aucun successeur n'est créé. Les résultats
finaux et le nettoyage des cinq PR/runs seront réconciliés avant la suite.

## Réconciliation après reprise de quota

Le premier essai de la sonde paquet incomplet a passé quick, Linux et
native-tests, dont les 162 contrôles WebView2. Son build passe les 58 tests
Rust avec moteurs et deux tests Node réels, puis le test du protocole dépasse
120 secondes. Le packaging et son upload sont skipped ; seuls quatre
artefacts de diagnostics existent, dont build 12373232340 et natif 12373955584.
Cette tentative ne prouve donc pas le refus du paquet incomplet.

Les dix runs initiaux sont terminés ; les cinq PR 3 à 7 sont closed avec
merged false et les cinq branches temporaires sont absentes. La branche
distante d'intégration reste à 8c57384f0bc4f80be4290d8c179ba0c612798a9f.
Preuves : pam33-runs-final.json, pam33-pr-closures.json et
pam33-cleanup-results.json. Aucun run n'a été annulé manuellement.

La reprise du 22 octobre vérifie à nouveau le même chat, relais, contrat,
prérequis Notion Terminé, commits intégrés et empreintes de contrôle. La clé
de quota précédente est consommée logiquement et son automation supprimée ;
la prochaine échéance observée est armée dans ce même chat. Aucun reset
n'est consommé et aucun successeur n'est créé.

Le test protocole original passe localement en 1,4 seconde. Sa fixture
laissait toutefois une requête pendante après la mort du processus et ne
drainait pas stderr. Le transport de test lit désormais les deux pipes,
ignore les frames de progression jusqu'à la réponse finale corrélée et
rejette sur mort, erreur de pipe, JSON invalide ou délai de requête de 45 s.
La borne globale de 120 s reste inchangée. Une trace des méthodes et une fin
de stderr limitée à 8 Kio accompagnent les erreurs, sans enregistrer les
payloads. Aucun comportement ni budget du sidecar de production ne change.

Quatre tests sans modèle couvrent bruit stderr de 2 Mio, progression/réponse
fragmentée, mort native avec code 70, absence de réponse, JSON invalide et
spawn impossible. Retirer le drain ou le rejet à la fermeture dans des copies
isolées fait échouer les régressions. Le protocole réel passe dix fois sous
deux processus de charge CPU jetables, puis les trois intégrations Node et
quick passent (456 tests Node, 99 composants, format/lint/TypeScript/build).
Traces : pam33-protocol-fixture-check.log, pam33-protocol-controls/results.json,
pam33-resume-integration-node.log et pam33-resume-quick.log.

La même source copiée dans Docker passe aussi 454 tests Node et deux skips
spécifiques Windows, puis le build TypeScript/Vite. La commande ci:quick
refuse correctement une image sans métadonnées Git ; les commandes de tests
et build sont donc exécutées directement dans cette image sans .git.
Traces : pam33-protocol-linux-build.log, pam33-protocol-linux-quick.log
(refus attendu, pas une réussite) et pam33-protocol-linux-tests.log.

Ces défauts de fixture sont établis, mais la cause du timeout hébergé n'est
pas prouvée par le seul succès local. Une unique relance du build échoué
du run 39658878156 est en cours sur son SHA original inchangé ; PR et branche
restent fermée/absente. Aucun push supplémentaire n'a été effectué. Le plan
de deux pushes préparé avant cette reprise est signalé brouillon dépassé ;
la suite dépend des preuves du scénario paquet incomplet et d'un nouveau
plan explicitement approuvé. Les critères distants ouverts restent ouverts.

### Résultat de l'unique relance inchangée

La tentative 2 du run 39658878156 passe les 58 tests Rust moteur, les trois
tests Node réels et le smoke runtime. Le protocole original passe en 1,64 s.
Elle échoue ensuite à smoke-confidence.mjs:51 : la référence ancienne renvoie
zéro function_calls alors que la fixture en exigeait un. Le packaging n'est
toujours pas atteint et son upload reste skipped. L'artefact 12385652174 est
exclusivement un diagnostic, SHA-256
fb5b520ea48a8fe201ba20df7c34b9c1e0e0b0a8f8716d4935e82a1703003ef7.
Traces : pam33-hosted-bundle-build-attempt2.log,
pam33-bundle-post-retry-artifacts.json et pam33-runs-post-retry.json.
Les PR restent fermées et leurs branches absentes ; aucune autre relance
de ce run n'est faite.

Le test de référence traite maintenant un appel retenu dans suppressed_calls
comme le planner de production le fait déjà. La [documentation officielle
Needle](https://github.com/cactus-compute/needle/blob/main/llms.txt) décrit
ces appels retenus par le moteur, distincts d'un refus sans proposition.
La vérification exige toujours exactement un appel de l'action attendue,
sans argument inventé, avec un score brut fini entre zéro et un. Le refus,
la mauvaise action et les appels multiples échouent. Le score n'est pas
modifié ; ni seuil de 65 %, ni comparaison stricte d'amélioration, ni les
32 cas et quatre contrôles de formulations personnelles ne changent.
La réponse brute de référence est écrite avant l'assertion pour diagnostiquer
le prochain run. La présence de suppressed_calls dans l'échec hébergé reste
une hypothèse à confirmer, car l'ancienne fixture ne journalisait pas cette
réponse. Aucun succès hébergé n'est déduit de cette correction.

Quatre régressions sans modèle couvrent réponse émise/retenue, conservation
du score et de la réponse, refus/actions/arguments invalides et scores
absents ou hors bornes. Le smoke réel passe localement : 32 cas et quatre
contrôles, Play 0,2346 vers 0,7202. Traces : pam33-confidence-held-calls.log
et pam33-confidence-quick.log. La correction se limite à la validation de
test ; le planner, les confirmations et le moteur restent inchangés.

Sur cette correction, quick passe avec 460 tests Node Windows et 99 composants,
format/lint et TypeScript/Vite. L'image Docker passe 458 tests Node avec deux
skips Windows et le build. Traces Linux : pam33-confidence-linux-tests.log.
Le prochain plan nécessite trois branches exactes : valide, faute de format
Rust et paquet incomplet. Les preuves négatives Rust/UI initiales sont
conservées ; aucune politique CI ni porte de packaging ne change depuis ces
preuves. Un nouveau run complet reste indispensable pour le code corrigé.

## Complément autorisé : trois sondes et nettoyage

Le message humain 01a160a7-5252-77e0-9290-063ddb202bf2, tour
01a160a7-51e3-7510-bde8-5e8c38b814bb, approuve le plan concret
pam33-retry-probes-final/plan.json (empreinte avant accord
b8df741619e5dc537849b2901c8e2f0a608c92d449eae00d18f7431d613e6154).
Les trois pushes exacts sont vérifiés : valide 6f2512e, format d621f469,
paquet incomplet 4580f05f. PR brouillon [8](https://github.com/Djaymare/pam-vibed/pull/8),
[9](https://github.com/Djaymare/pam-vibed/pull/9),
[10](https://github.com/Djaymare/pam-vibed/pull/10), sans reviewers.

Le [run format 39689327514](https://github.com/Djaymare/pam-vibed/actions/runs/39689327514)
passe quick et Linux. cargo fmt --check refuse la faute volontaire
`use host :: AssistantBridge ;` ; les étapes suivantes du job natif ne sont
pas exécutées et build est skipped. Trois artefacts de diagnostics existent,
aucun artefact de paquet. La PR 9 est fermée sans fusion et sa branche supprimée.

Les [runs valide 39689323412](https://github.com/Djaymare/pam-vibed/actions/runs/39689323412)
et [paquet incomplet 39689332884](https://github.com/Djaymare/pam-vibed/actions/runs/39689332884)
passent quick, Linux et native-tests (57 tests Rust, parcours WebView2 et
nettoyage). Leurs builds passent 58 tests Rust moteur, trois tests Node réels
dont le protocole et le smoke runtime, puis échouent dans la référence de
confiance. Leurs quatre artefacts respectifs sont des diagnostics ; le
packaging et son upload sont skipped. Le refus de paquet incomplet n'a
toujours pas été atteint. Le commit de fusion valide
99e15383d6c3bc5fd221b08405b41d09c66d2e18 a exactement l'arbre Git du SHA
approuvé 6f2512e3dc6f9ca2aca973d366fb7e4fe58eb59b.

Les réponses brutes invalident l'hypothèse suppressed_calls : function_calls
et suppressed_calls sont vides. Le modèle interprète l'ancienne paraphrase
comme un rejeu de l'historique ; ses scores de refus sont 0,5154 et 0,5042.
Ces réponses sont des échecs réels et ne sont pas déclarées correctes.
Aucune relance n'est consommée pour ce défaut reproduit sur deux runners.
Les trois scans sécurité échouent indépendamment dans security:gate :
complete true, needsReview true, errors vide ; ils ne sont pas neutralisés.

Nettoyage revérifié : six runs terminés, trois PR closed/merged false et
trois branches absentes. Aucun push d'intégration, fusion ou publication.
Traces sous artifacts/autonomy : pam33-r2-dispatched-runs.json,
pam33-r2-runs-latest.json, pam33-r2-*-jobs-latest.json,
pam33-r2-format-native.log, pam33-r2-valid-native.log,
pam33-r2-{valid,bundle}-build-attempt1.log,
pam33-r2-*-artifacts-final.json et pam33-r2-*-cleanup.json.
Les scripts de vérification/téléchargement ZIP préparés ne sont pas une
preuve d'artefact valide : aucun paquet distant n'a été produit.

### Référence de confiance corrigée sur la demande originale

La paraphrase de référence ne correspondait pas au déclencheur de l'outil.
La comparaison utilise maintenant la même demande originale
`Play sur le navigateur` des deux côtés, avec une assertion supplémentaire
qui exige sa correspondance au déclencheur. Les outils historiques restent
historiques, et les outils et normalisations actuels restent inchangés.
Le test exige toujours un unique appel correct sans argument inventé, le
score brut, une progression stricte et le franchissement du même seuil.
Aucun cas positif/négatif ni contrôle de formulation n'est retiré.

Le contrôle négatif réinjectant l'ancienne paraphrase échoue sur cette
assertion ; la copie et son profil sont nettoyés. Le smoke réel courant passe
32 cas et quatre contrôles, avec la référence 0,2946 et le cas courant 0,7202.
La mesure historique 0,2346 reste une ancienne mesure sur un autre texte,
pas la référence de cette comparaison. Quick passe avec 460 tests Node,
99 composants, format/lint et TypeScript/Vite. Traces :
pam33-confidence-original-request.log,
pam33-confidence-old-request-control.log et pam33-original-request-quick.log.
Cette modification de fixture doit encore être validée sur GitHub ; aucun
succès distant n'est anticipé. Les critères 1, 2 et 4 restent ouverts.

## Conservation exacte du portable dans l'artefact

Pendant les runs complémentaires autorisés sur 1882df8, la vérification de
l'inventaire local détecte quatre chemins cachés : runtime/npm/.npmrc, deux
.release-please-manifest.json de node-gyp et gyp, et .travis.yml de
qrcode-terminal. Le [README de l'action épinglée](https://github.com/actions/upload-artifact/blob/ea165f8d65b6e75b540449e92b4886f43607fa02/README.md#uploading-hidden-files)
confirme leur exclusion avec include-hidden-files false. Un répertoire
portable envoyé directement ne préserverait donc pas son manifeste exact.
L'inspection effective de l'archive hébergée reste à faire après le build.

La correction locale ajoute une archive ZIP interne. Windows bsdtar est lancé
sans shell avec une liste NUL de chemins explicites ; seul le pointeur
courant, le manifeste et les fichiers de sa publication active sont inclus.
Le ZIP est relu intégralement et chaque entrée/hachage comparé à l'inventaire
avant remplacement atomique. Son nom, SHA-256 et nombre d'entrées sont ajoutés
à delivery.json. L'upload autorise seulement ce ZIP, l'installeur et les
rapports ; include-hidden-files false, permissions, SHA des actions et règles
de succès restent conservés. Les contrôles d'archive s'ajoutent après
verify:bundle et ses preuves, sans déplacer les contrôles précédents.

Trois régressions Windows couvrent fichier caché conservé, fichier non listé
exclu, simulation du filtre caché refusée sans remplacement de l'archive
précédente, ressource altérée et traversée refusées. Elles sont aussi exigées
dans native-tests après rustfmt. La politique refuse à nouveau un upload du
répertoire brut. Les 50 tests archivage/politique/runner passent ; quick passe
avec 464 tests Node Windows, 99 composants, format/lint/TypeScript/build et
actionlint. Linux passe 459 tests, cinq skips Windows visibles et le build.

Essai avec le portable local complet du commit 1a217ac, sans prétendre à un
nouveau build : 2112 fichiers, 2114 entrées ZIP avec pointeur et manifeste,
quatre fichiers cachés conservés et tous les hachages vérifiés. Le chemin
complet archivePortable est aussi exécuté dans une copie isolée par liens
physiques ; la métadonnée delivery correspond au ZIP. Le reçu et le pointeur
originaux restent byte-identiques ; la copie est nettoyée après contrôle des
chemins absolus. Aucun exécutable du paquet n'est lancé pour ces essais.

Traces : pam33-archive-unit.log, pam33-archive-controls.log,
pam33-archive-real-result.json, pam33-archive-portable-control.json,
pam33-archive-quick.log, pam33-archive-linux-tests.log et
pam33-archive-actionlint.log sous artifacts/autonomy. Le nouveau chemin
d'upload n'est pas encore testé sur GitHub à ce checkpoint ; les runs en
cours testent leurs SHA approuvés antérieurs. La clôture reste interdite tant
que le paquet effectivement téléchargé n'est pas intégralement vérifié.

## Runs sur la demande originale : succès CI, intégrité refusée après téléchargement

Le message humain 01a160b9-8c48-7f72-b24e-d47cff7e847d, dans le tour
01a160a7-51e3-7510-bde8-5e8c38b814bb, approuve deux pushes exacts et leur
nettoyage : 1882df87ea63c6331dfea83d47cc982582d2660a et
5ed37f7d792e47735846e2394ed1392244f1fb4d. PR brouillon
[11](https://github.com/Djaymare/pam-vibed/pull/11) et
[12](https://github.com/Djaymare/pam-vibed/pull/12).

Le [run valide 39691594927](https://github.com/Djaymare/pam-vibed/actions/runs/39691594927)
passe ses quatre jobs. Les 58 tests Rust moteur, trois tests Node réels,
runtime, 36 contrôles confiance (référence 0,312 vers 0,7193), 48 Deezer et
65 média passent ; NSIS, portable et verify:bundle passent sur le runner.
Le commit de fusion 5c6b7d92f368c2392152c9df004576a0e1ada58a possède
exactement l'arbre du SHA approuvé 1882df8.

L'artefact 12390066098 est téléchargé et son SHA-256 vérifié :
7ef5a8d9f90b22e875ed91c6ed4075da56ae83df727b01172c67080bef35894d,
390703309 octets. BuildId aef29415-5790-4f72-8f72-80b6fc02d28a ; manifeste
edc91125f5d22626567fea20c66e8a1459e4bb7b058fd03086698f9196875ff7 ;
rapport d'intégration
7ddc00ce45cf4287d591a8c3ce3995a796ad937219b088c1e5921a68ecba426c ;
NSIS f4aec9a0b29fbe442a1002890e079975c306ee469b997770028c6aeb58b4282b.
Ces identités et hachages correspondent, les rapports integration/package
sont passed, et les 2108 fichiers présents ont tous leur bon hachage.

L'inspection complète confirme cependant les quatre fichiers cachés absents :
le portable téléchargé contient 2108 des 2112 fichiers de son manifeste.
La validation est donc refusée, même avec un run vert. Aucun exécutable de
cette archive n'est lancé. La correction locale d'archive interne et sa
vérification intégrale doivent encore produire un artefact hébergé valide.
Traces : pam33-r3-artifact-verification.log (échec attendu),
pam33-r3-artifact-inspection.json, pam33-r3-valid-artifacts-final.json,
pam33-r3-valid-build.log et pam33-r3-valid-merge-commit.json.

Le [run paquet incomplet 39691598300](https://github.com/Djaymare/pam-vibed/actions/runs/39691598300)
passe quick/Linux/native-tests, toutes les intégrations réelles et la
construction NSIS/portable. Le défaut contrôlé supprime contracts.cjs, puis
verify:bundle refuse l'inventaire. L'étape ci-artifact et l'upload du paquet
sont skipped ; seuls quatre diagnostics sont publiés. La sonde a donc enfin
atteint et prouvé le scénario d'échec attendu. Trace :
pam33-r3-bundle-build.log et pam33-r3-bundle-artifacts-final.json.

Les deux scans sécurité indépendants restent en échec. Les quatre runs sont
terminés, les deux PR fermées avec merged false et leurs deux branches
supprimées, sans relance ni annulation manuelle. La branche distante
d'intégration reste à 8c57384f0bc4f80be4290d8c179ba0c612798a9f.
Traces : pam33-r3-runs-latest.json et pam33-r3-*-cleanup.json.
Le ticket demeure ouvert : un run neuf sur la correction d'archivage et le
contrôle de son ZIP téléchargé sont encore requis. Aucun successeur créé.
