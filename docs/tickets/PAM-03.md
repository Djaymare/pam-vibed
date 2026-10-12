# PAM-03 — Budget global et résultats des exécutions partielles

Ticket : https://app.notion.com/p/3f7b3e0422a4819296a6eb709b981269
Run : `c6124deb-00ca-405c-94f8-dd71183eebb3`.
Worker : `01a13155-1f02-7f80-b9af-749fc417be13`, génération 5.
Branche : `codex/deezer-routing`.
Base : `1e77a9a5482109ed33695d4e019d59b1ecdca9e7`.
Prérequis : PAM-04 relu intégralement, « Terminé », commit de livraison présent
dans cette base ; empreintes de ses neuf sorties de validation vérifiées.
Contrat courant identique au snapshot, hors passage contrôlé à « En cours ».
Vérification effectuée par le worker ayant implémenté ce ticket.

## Comportement livré

L’échéance monotone du transport Rust commence avant sérialisation et couvre
file, démarrage, écriture et réponse, avec une borne globale de **50 s**.
Juste avant envoi, Rust transmet le temps restant et son échéance Unix, avec
jusqu’à **500 ms** de marge pour restituer le compte rendu. Node prend la plus
courte de ces bornes et de ses **40 s** de travail, dès admission, avant nettoyage
et configuration. Le temps d’écriture du pipe et celui de la file Node ne
renouvellent pas le budget. Les délais locaux utilisent ensuite une horloge
monotone ; Rust conserve toujours sa propre borne monotone indépendante.

Découverte des sessions, Whistle, Needle et exécution partagent ce budget.
Les auxiliaires Windows et reverse RPC hôte utilisent au plus **12 s**, réduites
au temps restant. Les vérifications immédiatement avant émission empêchent
une préparation asynchrone tardive de lancer un effet après expiration.
La séquence reste sérialisée et le plan complet reste validé avant exécution.

Chaque appel possède un résultat avec index, nom d’outil et identité d’application.
`outcome` distingue `not_started`, `performed`, `failed`, `unknown`. Un effet émis
sans réponse certaine devient inconnu ; les appels suivants restent non démarrés.
Les échecs explicitement refusés restent connus. Les commandes déjà acceptées
ou les lancements déjà confirmés restent effectués. Pour Deezer et GSMTC,
« effectuée » décrit l’acceptation annoncée par le message, sans inventer une
confirmation de lecture effective.

Le profil reçoit un journal JSON atomique sous `executions` avant émission, puis
à chaque résultat. Un arrêt entre écriture de l’intention et émission donne
conservativement une issue inconnue. Une progression corrélée au numéro de
requête circule sur le pipe privé. Rust la conserve pour rendre une réponse
`partial` après timeout, EOF ou interruption, même quand Node ne peut plus
répondre. Une progression non corrélée est refusée.

Après redémarrage du sidecar, une nouvelle confirmation du même UUID partiel
lit le journal et ne lance aucun appel. Une confirmation déjà achevée reste
refusée ; le fichier d’approbation est consommé avant exécution. Le worker
d’inférence peut être recréé, mais aucun effet externe n’est automatiquement
rejoué. L’interface affiche « Exécution interrompue », son message et les quatre
issues par action, sans bouton d’exécution de la séquence partielle. Une nouvelle
demande explicite reste une nouvelle instruction humaine.

## Critères et preuves

| Critère Notion | Preuve |
| --- | --- |
| Sessions lentes, inférence proche de la limite, plusieurs actions : délai respecté et effets possibles identifiés | Test Node `sessions and inference consume the same admission budget before eight effects` : budget contrôlé 100 ms, sessions 30 ms, inférence 60 ms, huit appels de 6 ms ; seuls deux sont émis, résultat effectué/inconnu/six non démarrés, délai d’inférence réduit à 70 ms. Sur l’assistant original extrait du commit de base, la même régression échoue : huit émissions au lieu de deux. |
| Auxiliaires simulés lents et huit actions : budget borné | `eight media actions share helper budgets and do not emit after slow discovery` utilise le vrai adaptateur média avec auxiliaires simulés : reste 100/60/50/40/30/20 ms, deux commandes effectuées, découverte suivante expirée, six appels non démarrés. `native helper timeout is capped by remaining budget` vérifie les options réelles d’execFile, borne 35 ms, absence de shell, timeout/réponse invalide classés inconnus et refus explicite connu. Le test de préparation tardive utilise un vrai minuteur : réponse à la borne 60 ms, puis zéro effet après réveil tardif à 150 ms. |
| Premières actions effectuées, suivante expirée : issues précises | Tests Node de confirmation : effectuée/inconnue/non démarrée ; refus connu conservé entre deux réussites. Test Rust Windows `interruption_preserves_per_action_outcomes_and_restart_does_not_replay` : vrais pipes/processus, progression de trois actions, timeout à 600 ms et EOF, réponse partielle en moins de 2 s, issues conservées puis transport repris. |
| Relance du worker : aucune répétition d’actions émises | Tests Node de redémarrage d’assistant sur le même profil, lecture du journal pendant une émission puis après interruption : compteur d’effets inchangé après nouvelle confirmation. Test Rust : processus retiré/recréé, seul l’effet initial et la nouvelle requête indépendante apparaissent dans le marqueur. Les régressions PAM-04 de réponse tardive, reprise manuelle, expiration en file et sérialisation continuent de réussir. |

Les fixtures nécessaires sont suivies dans `sidecar/budget.test.cjs`,
`sidecar/protocol.test.cjs`, `src-tauri/src/bridge_tests.rs` et
`tests/fixtures/bridge-sidecar.cjs`. Le protocole Node teste aussi une échéance
Unix expirée avec un reste nominal de 40 s : aucun appel ni effet n’est produit.

## Validations exécutées

Windows x64, Node **24.21.0**, npm **11.19.0**, Rust/Cargo **1.99.0**, MSVC.
Toolchain et cache Windows préparés par PAM-34 réutilisés. Rust compile les
sources du checkout partagé ; `CARGO_TARGET_DIR` désigne
`artifacts/pam34/windows/src-tauri/target`.

| Commande | Résultat réel | Sortie locale |
| --- | --- | --- |
| Régression sur l’assistant original extrait de la base, `node --test --test-isolation=none --test-name-pattern='sessions and inference consume'` | **1 attendu**, huit effets au lieu de deux | `artifacts/autonomy/pam03-regression-before.log` |
| `npm test` depuis la racine | **0**, 153 réussis, aucun ignoré | `artifacts/autonomy/pam03-npm-test.log` |
| `cargo test --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc` | **0**, 15 réussis, dont 13 tests du bridge, aucun ignoré | `artifacts/autonomy/pam03-cargo-test.log` |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc --all-targets -- -D warnings` | **0**, sans avertissement | `artifacts/autonomy/pam03-clippy.log` |
| `npm run build`, environnement Windows isolé PAM-34 | **0**, Vue/TypeScript/Vite ; les trois sources d’interface copiées sont identiques aux sources livrées | `artifacts/autonomy/pam03-windows-build.log` |
| `npm run test:integration` | **0**, Whistle/Needle réels, confirmation et lancement d’un Node jetable écrivant un marqueur, huit alias, aucune application personnelle | `artifacts/autonomy/pam03-integration.log` |
| `npm run test:deezer:routing` | **0**, 48 contrôles corrects avec Needle réel et effets simulés | `artifacts/autonomy/pam03-deezer-routing.log` |
| `npm run test:media:commands` | **0**, 65 contrôles corrects avec Needle réel et sessions/effets simulés | `artifacts/autonomy/pam03-media-commands.log` |
| `rustfmt --check --edition 2021 --config skip_children=true` sur les deux fichiers Rust touchés ; `git diff --check` | **0** | Chat et reçu |

Le checkout partagé contient des dépendances Linux préexistantes. Sa garde
`npm run build` refuse les bindings Windows absents (**1 attendu**, sortie
`pam03-build.log`). Aucun `node_modules` n’a été remplacé : son empreinte
`.package-lock.json` reste
`b26e0751970b1fd8d7d738a65a51a600e1ee604de9d25fc41af9e4a409296691`.
Le build Windows réussi utilise les dépendances isolées existantes et les
sources courantes copiées explicitement dans `artifacts/pam34/windows`.

Le premier lancement Node en sandbox a été refusé par `spawn EPERM` avant les
tests. Les suites finales ont réellement réussi avec leurs processus jetables
autorisés. La première suite complète a aussi révélé un mélange horloge simulée /
minuteur réel ; les tests contrôlent maintenant les deux. La conservation du
refus des confirmations déjà achevées a été régressée. Deux conseils Clippy
`manual_ok_or` ont été appliqués avant le passage final sans avertissement.

Tous les processus et profils de test sont terminés/nettoyés. Aucun profil,
audio, modèle, cache ni fichier de contrôle du dispositif ne figure dans la
livraison. Les preuves locales ignorées sont reliées au reçu par SHA-256.

## Limites et fichiers

Les scénarios de durée utilisent des horloges/effets contrôlés et des délais
réduits ; les tests Rust exécutent les vrais pipes et processus Windows. Les
auxiliaires média lents sont simulés, sans commander les lecteurs personnels.
L’intégration utilise les moteurs réels avec silence synthétique et exécutable
jetable, sans bloquer volontairement une DLL. Le build vérifie l’interface,
sans revendiquer un parcours de clics WebView2, un installateur ou une publication.

Une interruption ne peut pas annuler rétroactivement un effet déjà commencé.
Une issue inconnue est volontairement conservatrice, sans rejeu. L’horloge Unix
sert au transfert entre processus ; la borne monotone Rust de 50 s reste la
protection globale si l’horloge système change. L’ordonnancement Windows peut
ajouter la marge explicitement admise par les assertions de tests.

Fichiers : `sidecar/assistant.cjs`, `sidecar/budget.cjs`,
`sidecar/execution.cjs`, `sidecar/engine.cjs`, `sidecar/host.cjs`,
`sidecar/main.cjs`, `sidecar/media.cjs`, `sidecar/native.cjs`,
`sidecar/assistant.test.cjs`, `sidecar/budget.test.cjs`,
`sidecar/protocol.test.cjs`, `src-tauri/src/bridge.rs`,
`src-tauri/src/bridge_tests.rs`, `tests/fixtures/bridge-sidecar.cjs`,
`src/App.vue`, `src/types.ts`, `src/style.css`, `README.md` et ce document.
