# PAM-31 — Tests Rust du bridge et des adaptateurs

Ticket : https://app.notion.com/p/3f7b3e0422a481df9815d42ba2a67702

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

**Outcome de reprise : blocked, critère CI toujours ouvert.** Le correctif est
préparé localement ; aucun push n’est autorisé implicitement par `AGENTS.md`.
Une autorisation humaine explicite d’envoi vers cette branche est nécessaire
avant le déclenchement et la vérification d’un run hébergé sur le SHA corrigé.
La fiche ne peut pas être clôturée et aucun relais n’est transféré pendant cette
attente. Aucun programme personnel commandé ni permission modifiée. Le reçu de
reprise conserve le SHA final du correctif et les empreintes des journaux.

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
| Défauts 01/03/04 reproduits avant et corrigés après ; tests Windows exécutés en CI | Partie avant/après prouvée ci-dessous. Configuration CI ajoutée. **Non satisfait intégralement : run CI hébergé absent.** |
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
