# PAM-31 — Tests Rust du bridge et des adaptateurs

Ticket : https://app.notion.com/p/3f7b3e0422a481df9815d42ba2a67702

**Résultat final de la reprise du 21 octobre : delivered pour PAM-31.** Les
deux jobs Windows du run `39606909360` réussissent sur
`8c57384f0bc4f80be4290d8c179ba0c612798a9f`. Le workflow global est annulé
après arrêt du job Linux restant ; aucune réussite Linux ou globale n’est
revendiquée. Les critères de ce ticket portent sur les tests Rust Windows.

Run `c6124deb-00ca-405c-94f8-dd71183eebb3`, worker
`01a14c53-438e-7932-9e7d-c43226dff068`, génération 33. Branche
`codex/deezer-routing`, base `09daa01a67cf7cb466166d4d3a315a103b839c29`.
Autorisation humaine source et relais nominatif vérifiés, prérequis PAM-03,
PAM-14, PAM-15 relus dans Notion et commits intégrés vérifiés. Travail effectué
le 18 octobre 2026 sous Windows x64, Rust/MSVC 1.99.0, Node 24.21.0 et npm 11.19.0.
Vérification par le worker implémenteur.

## Reprise du 21 octobre 2026 — CI en attente

Worker `01a15e67-1054-7241-9898-f0092688875d`, génération 40, même run.
Base de reprise : `ce47dca8d9d2465b42e7bb3a260136d603e9397f` sur
`codex/deezer-routing`. La demande humaine de reprise dans le chat précédent,
le lancement d’origine, le relais nominatif, les empreintes de contrôle et
les trois prérequis « Terminé » ont été relus et vérifiés. Leur livraison et
le commit initial PAM-31 `8138715a14f37a30763c3bb06d2d58e41e109eb6` sont
ancêtres du HEAD d’intégration. Le checkout était propre à l’acquisition.

Le remote `origin`, `https://github.com/Djaymare/pam-vibed.git`, contient
exactement la base de reprise ; sa branche par défaut est celle d’intégration.
Le fichier distant `windows.yml` est présent et identique à la base locale.
L’API authentifiée confirme Actions activé, mais renvoie zéro workflow ; la
lecture du workflow par son nom et son déclenchement manuel retournent 404.
Aucun run n’a été créé par cet essai. Preuves locales horodatées :
`pam31-g40-remote-workflows.json`, `pam31-g40-actions-permissions.json`,
`pam31-g40-remote-workflow-content.json`, `pam31-g40-dispatch-result.json`,
sous `artifacts/autonomy/`. Ce constat ne prouve pas la cause interne du
non-enregistrement par GitHub.

Un défaut de configuration est établi : les pushes n’étaient acceptés que
sur `main` et `master`, alors que le projet utilise `codex/deezer-routing`.
Cette branche exacte est ajoutée au filtre Windows afin qu’un prochain push
autorisé déclenche les jobs natifs, build et Linux. Les permissions en lecture,
les actions épinglées, les limites de durée et les restrictions des caches
restent vérifiées par la suite existante. Le déclenchement manuel reste présent.
La nouvelle régression lit la branche du manifeste et échoue avant correction
avec l’assertion « doit déclencher les tests natifs », puis passe après correction.

Contrôles sur cette reprise :

| Contrôle | Résultat | Journal local |
| --- | --- | --- |
| Régression ciblée avant correction | Code 1 attendu, une assertion échouée | `pam31-g40-regression-before.log` |
| `npm test` | Code 0, 436 réussis, zéro échec/ignoré | `pam31-g40-npm-test.log` |
| `npm run check:workflows` | Code 0, deux workflows et quatre jobs conformes | `pam31-g40-workflows.log` |
| `cargo test --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc` | Code 0, 57 réussis, zéro échec/ignoré | `pam31-g40-cargo-test.log` |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | Code 0 | `pam31-g40-fmt.log` |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc --all-targets -- -D warnings` | Code 0 | `pam31-g40-clippy.log` |
| Compilation de la fixture Rust et `node scripts/test-native-history.mjs <rustc> .runtime-cache/pam31-g40-process-fixture.exe` | Code 0 ; trois défauts reproduits avant correction et budget courant réussi | `pam31-g40-fixture.log`, `pam31-g40-history.log` |

### Première exécution CI autorisée

L’utilisateur a ensuite autorisé explicitement le push du correctif
`914f3dbfc7fa8f53bcf1990f8132fe2b07135304` vers
`origin/codex/deezer-routing` et sa validation CI (message humain
`01a15e7f-7878-7523-8271-40d9e85d4451` dans ce chat). Le push a réussi et
GitHub a enregistré le workflow, puis démarré le
[run 39602422352](https://github.com/Djaymare/pam-vibed/actions/runs/39602422352)
sur ce SHA exact. La non-exécution initiale n’est donc plus le blocage courant.

Les jobs Windows ont cependant réellement échoué : 55/57 tests par défaut,
57/58 avec moteur. Les deux tests de pipe attendaient `bridge_write_timeout`
mais obtenaient `bridge_start_timeout`, le démarrage consommant leurs 600 et
800 ms avant toute écriture. Journaux complets conservés dans
`pam31-g40-ci-native-attempt1.log` et `pam31-g40-ci-build-attempt1.log`.
Clippy et la préparation avaient réussi ; aucun résultat ultérieur sauté
n’est compté comme exécuté.

La correction reste dans les tests et leur fixture Node. Un échange `status`
borné à cinq secondes prépare le processus et son éventuel enfant ; la fixture
cesse de lire stdin avant de répondre. Le test émet ensuite l’audio avec le
même budget de 600/800 ms et exige toujours l’erreur d’écriture, un retour sous
deux secondes, la mort des PID internes et une récupération sans rejeu. Une
fabrique retarde chaque démarrage d’une seconde pour reproduire le problème
de manière déterministe : sans préparation, le test ciblé échoue localement
avec `bridge_start_timeout` (`pam31-g40-pipe-before.log`), puis passe avec la
préparation. Les requêtes de récupération ont une borne distincte de cinq
secondes. Aucun délai ni chemin de production n’est modifié, aucun test ignoré
ni assertion d’écriture assouplie. La procédure détaille cette séparation.

Validations locales de la correction de fixture : `cargo test` Windows sans
feature (57 réussis), avec toutes les features (58 réussis), Clippy tous
targets/toutes features avec `-D warnings`, rustfmt et `npm test` (436 réussis).
Zéro échec ou test ignoré dans ces suites finales. Journaux
`pam31-g40-pipe-suite-{test,all,clippy,fmt}.log`, résultats de commandes dans
`pam31-g40-pipe-suite-results.json`, journal Node `pam31-g40-pipe-npm.log`.
Les deux tests ciblés ont aussi été exécutés séparément. Contrôle final des
PID : aucun processus de fixture restant.

### Deuxième exécution CI et horloge d’écriture

Le push de `2527b1ffc25fcb1474f712312ff210fc6b4cb4fa` a été autorisé par le
message humain `01a15e8b-c7d1-74f2-864d-bfe952097e8c`, puis vérifié. Le
[run 39604170117](https://github.com/Djaymare/pam-vibed/actions/runs/39604170117)
exécute ce SHA. Les 58 tests avec moteur, les 436 tests Node et l’intégration
Windows réelle ont réussi. Le job natif a échoué avec 56/57 tests : la file et
la sérialisation de l’audio synthétique consommaient encore les 600 ms sur un
runner chargé, avant `WRITING` (`bridge_queue_timeout`). Son journal est
`pam31-g40-ci-native-attempt2.log`.

L’horloge injectable de ces deux tests est maintenant figée après le bootstrap,
pendant l’admission et la sérialisation des 4 Mo de données synthétiques.
Le test attend le stade `WRITING`, avec une borne de cinq secondes réelles,
puis reprend une horloge qui avance réellement. Les 600/800 ms commencent à
ce stade ; les assertions d’erreur, de retour sous deux secondes réelles, de
mort des PID et de récupération restent intactes. Les requêtes de préparation
et de récupération restent bornées à cinq secondes et le budget de production
depuis l’admission reste testé séparément. Aucun code de production modifié.

La suite locale normale repasse intégralement : 57 tests par défaut, 58 avec
toutes features, Clippy tous targets/toutes features, rustfmt ; journaux
`pam31-g40-clock-suite-{test,all,clippy,fmt}.log` et résultats dans
`pam31-g40-clock-suite-results.json`. Les deux tests ciblés passent séparément.
Le dernier `npm test` compte 436 réussites sur les mêmes sources Node.
Une sonde supplémentaire avec affinité limitée à deux CPU et 64 threads de
tests, pendant une autre compilation, a passé les deux tests de pipe mais
échoué sur sept autres attentes de réponse : 50/57. Elle ne vaut pas une suite
globale réussie ; ses journaux `pam31-g40-clock-two-cpu.*log` sont conservés.
Les bornes natives restent dépendantes de l’ordonnancement, sans garantie temps
réel sous saturation volontaire.

Le job build a aussi révélé un échec indépendant dans `test:confidence` : le
contrôle d’inférence initial attendait un appel et en a reçu zéro
(`scripts/smoke-confidence.mjs:51`). Journal `pam31-g40-ci-build-attempt2.log`.
Les sources de ce contrôle et du moteur ne sont pas modifiées par PAM-31.
Ce résultat n’est pas compté comme une réussite de la CI globale ; la barrière
complète appartient à PAM-33. La validation PAM-31 exige toujours le job natif
Windows et ses contrôles historiques effectivement réussis.

### Troisième exécution CI — job natif réussi

Le message humain `01a15e9c-c7e6-7871-88a4-6dcee88b676c` autorise le push de
`8c57384f0bc4f80be4290d8c179ba0c612798a9f`, qui a été effectué et vérifié.
Le [run 39606909360](https://github.com/Djaymare/pam-vibed/actions/runs/39606909360)
exécute ce SHA exact sur Windows Server 2022 x64, Rust/MSVC 1.99.0 et Node
24.21.0. Son job `native-tests` (`119245360540`) est **success** : rustfmt,
Clippy, 57 tests Rust sans modèles (zéro échec/ignoré), compilation de fixture
et les trois contrôles historiques réussis. Son journal complet est conservé
dans `artifacts/autonomy/pam31-g40-ci-native-success.log`.

Les deux tests de pipe corrigés y passent effectivement. La sonde historique
observe huit effets sur l’ancien budget, deux effets et les issues partielles
sur le budget courant ; les prédicats corrigés des anciens jobs et pipes
échouent comme attendu. Le critère d’exécution CI native est ainsi satisfait.
Les étapes Rust avec moteur, Node, intégration et confiance du job build ont
également réussi dans cette troisième exécution. Le contrôle de confiance
qui avait échoué dans la seconde n’est pas modifié ; son premier échec est
conservé, sans prétendre qu’il n’a pas existé.

Le job Windows `build` (`119245360059`) est également **success** : 58 tests
avec moteur, 436 tests Node, intégration réelle, confiance, compilation NSIS,
portable et `verify:bundle` réussis. Journal `pam31-g40-ci-build-success.log`.
L’artefact CI `12348518243` est relié au SHA exact, empreinte SHA-256
`74a21cb96389fd6e9478222429f45522cb3c88f16fb68a0f2576aeba6fae2a87` ;
ses métadonnées sont dans `pam31-g40-ci-artifacts.json`. Aucun téléchargement
ni nouvelle diffusion de ce paquet n’est effectué par cette vérification.

Le job Linux restant a été arrêté après réussite des contrôles Windows requis
par PAM-31. État final confirmé : native-tests success, build success, linux
cancelled ; workflow global cancelled. Les journaux Linux montrent deux
échecs (« reprise après exit » et « reprise après timeout », WAV/keywords),
puis une attente sans résumé final de npm test jusqu’à l’annulation. Ni build
Linux ni compilation croisée ne sont comptés réussis. Journal complet
`pam31-g40-ci-linux-cancelled.log`, états `pam31-g40-ci-final-jobs.json` et
`pam31-g40-ci-final-state.json`. Ce problème de la barrière Linux reste à
réconcilier dans PAM-33 ; les sources de ces tests ne sont pas modifiées ici.

La relecture finale confirme les critères et les prérequis Notion inchangés,
les livraisons intégrées et les fichiers de contrôle identiques. Seule cette
preuve évolue après le SHA testé en CI ; les sources et fixtures sont identiques.
Tous les processus locaux de fixture et les jobs hébergés connus sont terminés.
Aucun programme personnel commandé ni permission modifiée. Le reçu conserve
les SHA finaux et les empreintes des journaux, sans faire passer les anciens
échecs ni la sonde de saturation pour des validations réussies.

## Résultat initial du 18 octobre et critère restant

La couverture et ses validations locales sont implémentées. **Outcome : blocked**,
car le premier critère exige également une exécution en CI Windows. Le workflow
a été ajouté mais aucun run hébergé de cette livraison n’a été exécuté/vérifié.
À cette date, `git remote -v` était vide et `.git/config` n’avait aucune section remote. Le protocole
n’autorise pas implicitement de push. La fiche reste donc ouverte, en pause.
Cette absence de preuve externe n’est pas comptée comme une réussite CI.

Condition de reprise : disposer d’un dépôt/runner CI autorisé contenant cette
livraison et de la preuve d’un run Windows réussi sur son SHA, puis réconcilier
les sources, critères et validations avant clôture. Les tests locaux sont verts,
aucune source partielle ou régression connue n’est laissée dans la branche ; un
ticket indépendant peut prendre le relais selon le protocole.

## Changement

La source du catalogue est injectable derrière une interface interne. Le défaut
continue d’appeler le même adaptateur Shell Windows, avec la même mise en cache
et les mêmes revalidations avant effet. Quatre tests simulés couvrent catalogue
vide, accès refusé, noms identiques/identifiants exacts, rafraîchissement et refus
de réutiliser l’ancien cache lors d’un échec de scan. Les smoke tests exécutent
ensuite le vrai catalogue et la réparation de cibles.

La garde de fenêtre existante est extraite dans `host::authorize_window`, appelée
par la commande Tauri avant décodage. Le test refuse six labels non autorisés,
vérifie l’absence de dispatch et la capability locale limitée à `main`.

Quatre modes de la fixture IPC ajoutent JSON invalide, sortie supérieure à
2 000 000 octets, réponse tronquée et enfant mort. Chaque défaut retire le flux,
termine/collecte le PID connu et permet une nouvelle demande sans rejeu. Les
régressions précédentes restent actives : stdin bloqué, EOF, arrêt pendant
requête/warmup/inférence, héritage des pipes et Job Objects, réponses tardives,
file bornée, budget et résultats partiels, COM/WinRT et ressources GDI.

Les fixtures de la suite par défaut passent un runtime inexistant. La récupération
avec warmup réel utilise maintenant la feature explicite `engine-integration` ;
elle est exécutée séparément, sans test ignoré. Les raccourcis de transport
utilisés seulement par les tests/l’hôte optionnel sont compilés sous leurs cfg
respectifs : Clippy passe aussi sans feature, sans désactiver de lint.

`prepare-native-tests.mjs` prépare seulement le Node officiel épinglé, après
contrôle de version/empreinte. Le job Windows `native-tests` lance formatage,
Clippy, tests sans modèles et contrôles historiques ; le job avec ressources
lance séparément l’intégration Rust. [Procédure et fixtures](../native-tests.md)
documentent les commandes pour PAM-33 et les limites de ces tests.

## Critères et preuves

| Critère Notion | Résultat établi |
| --- | --- |
| Défauts 01/03/04 reproduits avant et corrigés après ; tests Windows exécutés en CI | **Satisfait à la reprise** : job Windows native-tests success sur 8c57384, 57 tests verts puis contrôles historiques PAM-01/03/04 réussis ; job Windows build success, dont 58 tests avec moteur. Preuves et limites du workflow global décrites ci-dessus. |
| Régressions PAM-01/03/04 échouant avec le comportement initial et passant avec les corrections | Le script suivi lit les sources exactes du commit audité `2aff3f94cf8c3cc0e6266f59f2739b0a977ae122`. Ancien bridge compilé sans modification : prédicat de survie PAM-01 faux, prédicat de délai PAM-04 faux, chaque processus de sonde retourne 1. Ancien assistant Node : huit effets émis, assertion « deux » échoue avec code 1. Même sonde de budget actuelle : deux effets, performed/unknown/six not_started, code 0. Régressions Rust de pipe et résultats partiels vertes ; six scénarios natifs actuels : utilisateur survivant/internes morts. |
| Aucun test n’utilise ni ne ferme une application personnelle | Profils temporaires, audio synthétique, effets simulés et exécutables compilés de fixture. Scans Shell en lecture ; seuls raccourcis UUID et PID de fixtures sont créés/commandés/nettoyés. Contrôle final de l’absence de processus de ces bancs. |
| Suite unitaire sans modèles, intégrations réelles identifiées | 55 tests par défaut réussis, puis même suite dans une copie de sources sans node_modules ni modèles, runtime vide : 55 réussis. Suite avec feature moteur : 56 réussis. Bancs réels distincts, aucune confusion avec les doubles. |

Le contrôle historique rejette les erreurs de compilation/préparation et les
crashes inattendus ; il exige les échecs précis des prédicats. Il nettoie le
sidecar bloqué par PID connu avant terminaison. Les fixtures nécessaires sont
suivies dans Git ; aucun test ne dépend des anciens fichiers d’audit ignorés.

## Contrôles exécutés

Journaux locaux sous `artifacts/autonomy/`, reçus des commandes avec leurs codes
de sortie et empreintes conservés dans `pam31-checks.json`. Toolchain/cache
Windows PAM-34 réutilisés ; sources compilées du checkout courant.

| Commande | Résultat | Journal |
| --- | --- | --- |
| `node scripts/prepare-native-tests.mjs` | 0, Node épinglé, aucun modèle téléchargé | Contrôle de préparation et copie isolée |
| `cargo test --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc` | 0, 55 réussis, zéro échec/ignoré | `pam31-cargo-test.log` |
| Même commande, `--all-features` | 0, 56 réussis, zéro échec/ignoré | `pam31-cargo-all.log` |
| Suite par défaut dans copie isolée, runtime vide et sans node_modules | 0, 55 réussis, zéro échec/ignoré | `pam31-model-free.log` |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc --all-targets -- -D warnings`, puis avec `--all-features` | 0, sans avertissement | `pam31-clippy-default.log`, `pam31-clippy.log` |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | 0 | `pam31-format-check.log` |
| `cargo build --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc --features process-tests --bins --examples` et compilation rustc de la fixture | 0 | `pam31-build.log`, `pam31-fixture-build.log` |
| `node scripts/test-native-history.mjs <rustc> .runtime-cache/pam31-process-fixture.exe` | 0 ; trois échecs historiques attendus, budget courant réussi | `pam31-history.log` |
| `node scripts/smoke-process-isolation.mjs <hôte compilé> .runtime-cache/pam31-process-fixture.exe` | 0, six scénarios réels réussis | `pam31-process-isolation.log` |
| `node scripts/smoke-application-availability.mjs <hôte compilé>` | 0, manuel/catalogue, suppression/désactivation/réparation/réactivation | `pam31-availability.log` |
| `npm test` | 0, 385 réussis, zéro échec/ignoré | `pam31-npm-test.log` |
| `npm run test:integration` | 0, intégration Windows réelle | `pam31-integration.log` |
| Diff, sources validées, empreintes de contrôle, ancêtres Git et nettoyage | Réconciliés avant reçu et relais | `pam31-final-verification.json` |
| Run CI hébergé du commit | **Non exécuté : critère restant, ticket ouvert** | Absence de remote enregistrée |

Les premiers essais du banc historique ont révélé le choix d’un rlib Windows
sans la feature JobObjects puis un OsString sérialisé au lieu d’un chemin ; le
banc a échoué, ces préparations ont été corrigées et les trois reproductions
finales ont effectivement abouti. Clippy sans feature a révélé trois raccourcis
de transport réservés aux tests ; leur compilation est désormais ciblée. Le
wrapper local réinitialisait plusieurs fois l’environnement MSVC et saturait
PATH ; la préparation est maintenant faite une seule fois par processus. Aucun
de ces essais échoués n’est compté comme validation réussie.

## Fichiers et limites

`applications.rs`, `applications/tests.rs`, `bridge.rs`, `bridge_tests.rs`,
`host.rs`, `launch.rs`, `lib.rs`, `Cargo.toml`, fixture IPC, trois fixtures
historiques, deux scripts de préparation/contrôle, workflow Windows,
`docs/native-tests.md` et cette preuve. Aucun changement des contrats autonomes,
des dépendances ou de leur lockfile, de branche, de permission ou de profil
personnel. Aucun push, paquet, publication ni parcours visuel WebView2 revendiqué.
La garde testée est celle du handler ; elle ne simule pas la création d’une
fenêtre distante. Une horloge contrôlée ne garantit pas l’ordonnancement Windows.
