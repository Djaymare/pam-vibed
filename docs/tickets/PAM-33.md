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
| Tests réels distingués des simulations, sans applications personnelles | Suites séparées et commandes explicites ; WebView2 utilise IPC simulé et micro synthétique, Needle utilise profils/sessions de test. Validations réelles finales consignées ci-dessous à leur exécution. |
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

## Validation finale restant à exécuter

Intégrations réelles, build frais NSIS/portable et vérification du paquet sur
le commit local de code, puis scénarios négatifs locaux et plan distant exact.
Les résultats seront ajoutés après exécution, sans transformer une étape
manquante en succès. Les SHA finaux appartiennent au reçu, pas à ce document.

Une validation GitHub sur branches de travail est explicitement requise par
le contrat. Aucun push n'est autorisé par le lancement général de la chaîne.
Les autorisations PAM-31 et PAM-37 portent sur leurs opérations déjà terminées.
PAM-33 reste donc ouvert tant que les runs et leur artefact ne sont pas vérifiés.
Outcome de ce checkpoint : blocked pour clôture, validation distante en attente.
Pas de successeur ni de transfert avant résolution. Vérification par le worker
implémenteur, sans revue indépendante revendiquée.
