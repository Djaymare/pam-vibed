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
