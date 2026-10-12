# PAM-04 — Borner aussi l’écriture dans le pipe du sidecar

Ticket : https://app.notion.com/p/3f7b3e0422a4817587bee3d9361db1ac

Branche : `codex/deezer-routing`. Base :
`9a3850b6cec28508b2b681e162feefbec87cbfe7`.
Run : `c6124deb-00ca-405c-94f8-dd71183eebb3`. Worker :
`01a13082-9ef7-7453-89c0-b88bac70f6d7`, génération 4.
Contrat Notion relu intégralement, aucun prérequis, condition `always`.
Vérification faite par le worker ayant implémenté ce ticket.

## Comportement livré

Le transport est confié à un acteur unique, créé à l’initialisation du bridge.
La file a quatre places, avec au plus une demande active. `try_send` refuse
immédiatement la saturation. Chaque demande a un identifiant et une échéance
monotone de **50 secondes**, calculée avant sérialisation. La même échéance
couvre file, démarrage, toutes les écritures et toutes les réponses, y compris
les échanges `host_request`/`host_response`. Les demandes expirées en file
sont écartées avant démarrage ou exécution. Les effets natifs et les demandes
du sidecar restent sérialisés dans cet acteur.

Le contrôle du processus et du Job Object utilise un verrou court, distinct
du pipe. Il n’est jamais tenu pendant une écriture, une attente de réponse
ou un effet natif. Au timeout actif, à la reprise manuelle et à la fermeture,
ce contrôle termine le job interne et le sidecar. Un timeout d’une demande
en file ne termine pas le processus d’une autre demande active.
L’invalidation immédiate du transport évite de réutiliser un processus que
Windows signale encore vivant juste après `TerminateJobObject`.

Chaque processus possède un lecteur stdout avec une file d’une réponse.
Le processus, son job et son lecteur sont retirés avant remplacement ; aucun
thread de transport n’est créé par demande. La limite de demande reste
5 000 000 octets et celle de réponse 2 000 000 octets. L’arrêt du bridge
ne joint pas l’acteur depuis le thread de fermeture de PAM.

Les erreurs exposent des codes : `bridge_queue_full`, `bridge_queue_timeout`,
`bridge_start_timeout`, `bridge_write_timeout`, `bridge_response_timeout`,
`bridge_host_timeout`, `bridge_eof`, `bridge_pipe`, `bridge_protocol`,
`bridge_stopped`, `bridge_interrupted` et `bridge_request_size`.
Une erreur applicative du sidecar reste `sidecar_error` et ne provoque pas
de rejeu. Un transport interrompu est retiré entièrement : une réponse tardive
ne peut pas satisfaire une nouvelle demande. Les confirmations et effets
ne sont jamais rejoués automatiquement. **Recharger les moteurs** coupe
le transport via le contrôle indépendant avant de demander la reprise.

## Critères et preuves

| Critère Notion | Preuve exécutée sous Windows |
| --- | --- |
| Un sidecar vivant qui ne lit jamais stdin, avec gros message audio, ne bloque pas indéfiniment PAM | `unread_audio_pipe_has_a_deadline_and_recovers` : JSON audio synthétique de 4 Mo, vrai pipe Windows rempli, délai configuré à 600 ms, retour en moins de 2 s vérifié, puis nouvelle demande réussie. Avant correctif, la régression du bridge original échouait : toujours bloqué après 800 ms, jusqu’à la terminaison du faux enfant pour nettoyer le test. |
| Une écriture sur pipe non lu termine dans le délai défini avec erreur exploitable | Même test : code exact `bridge_write_timeout`. `deadline_kills_internal_children_that_inherit_the_pipe` : délai 800 ms, parent et enfant interne héritant de stdin/stdout terminés, acteur redevenu disponible puis reprise réussie. |
| Fermeture et récupération possibles pendant l’écriture | `shutdown_during_write_does_not_wait_for_pipe_lock` et `restart_during_write_is_accessible_and_does_not_replay` : contrôle pendant le stage d’écriture, retour du contrôle en moins de 300 ms, demande rendue en moins de 2 s, erreurs exactes et reprise explicite. `idle_restart_retires_the_stream_before_the_next_request` couvre la course de terminaison Windows. Les callbacks de fermeture et de reprise de PAM appellent ces contrôles. |
| File pleine et réponses tardives : ni double exécution ni attente infinie | `full_queue_and_expired_queued_request_never_execute` : file de test d’une place saturée, refus `bridge_queue_full`, demande expirée `bridge_queue_timeout`, demande active préservée et seul son effet enregistré. `late_reply_cannot_satisfy_another_request_or_replay_an_effect` : effet enregistré une fois avant timeout, stream retiré, nouvelle réponse correctement corrélée et aucune répétition. `concurrent_requests_execute_in_queue_order` vérifie l’ordre de trois effets concurrents. |

Dix tests du bridge sont suivis dans `src-tauri/src/bridge_tests.rs`, avec
la fixture suivie `tests/fixtures/bridge-sidecar.cjs`. Les autres cas vérifient
EOF après lecture contre absence de réponse, ordre séquentiel et borne de taille.
Ils ne dépendent pas de fixtures cachées dans `artifacts/`.

## Validation

Windows x64, Rust/Cargo **1.99.0**, Node **24.21.0**, npm **11.19.0**, MSVC
Build Tools 18. Toolchain/cache Windows préparés par PAM-34 réutilisés ;
les sources compilées sont celles du checkout partagé. `CARGO_TARGET_DIR`
désigne `artifacts/pam34/windows/src-tauri/target`. Les dépendances Linux
préexistantes de l’interface restent préservées.

| Commande depuis la racine | Résultat réel | Sortie locale |
| --- | --- | --- |
| Régression sur le bridge original : `cargo test --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc blocked_pipe_regression -- --nocapture` | **1**, blocage reproduit, faux enfant ensuite terminé pour nettoyage | `artifacts/autonomy/pam04-regression-before.log` |
| `cargo test --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc` | **0**, 12 tests réussis, dont 10 bridge, aucun ignoré | `artifacts/autonomy/pam04-cargo-test.log` |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc --all-targets -- -D warnings` | **0**, aucun avertissement | `artifacts/autonomy/pam04-clippy.log` |
| Même Clippy avec `--features process-tests` | **0**, aucun avertissement | `artifacts/autonomy/pam04-clippy-process.log` |
| `cargo build --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc` | **0**, binaire normal compilé | `artifacts/autonomy/pam04-cargo-build-default.log` |
| Même build avec `--features process-tests` | **0**, binaire du banc compilé et copié avant exécution | `artifacts/autonomy/pam04-cargo-build-process.log` |
| `rustc --edition 2021 tests/fixtures/process-fixture.rs -o artifacts/pam04/process-fixture.exe` | **0**, exécutable de test compilé depuis la source suivie | `artifacts/autonomy/pam04-fixture-build.log` |
| `npm run test:processes -- artifacts/pam04/pam-process-test.exe artifacts/pam04/process-fixture.exe` | **0**, six scénarios natifs : quit, restart, kill, avec exécutable manuel et raccourci jetable ; vrai moteur Needle chargé, enfants internes terminés, application de test survivante puis nettoyée, arguments littéraux et erreurs corrélées conservés | `artifacts/autonomy/pam04-process-isolation.log` |
| `npm test` | **0**, 145 réussis, aucun échec/ignoré | `artifacts/autonomy/pam04-npm-test.log` |
| `rustfmt --check --edition 2021 --config skip_children=true` sur les quatre sources Rust touchées | **0** | `artifacts/autonomy/pam04-format.log` |
| `git diff --check`, contrôle des empreintes du protocole et relecture du diff | **0**, fichiers de contrôle inchangés | Vérifications dans le chat et reçu |

Deux adaptations sans changement de logique dans le catalogue Windows
(`as_chunks`/`as_chunks_mut`) suppriment les deux avertissements préexistants
de Rust 1.99 pour satisfaire le Clippy exigé avec `-D warnings`.

Le premier `npm test` en sandbox a échoué avant exécution (`spawn EPERM`).
La suite autorisée avec enfants jetables a ensuite réussi. Le premier smoke
a révélé la course de reprise corrigée et régressée. Un passage suivant
a échoué sur la découverte immédiate d’un raccourci jetable ; le passage
suivant inchangé a réellement réussi les six scénarios. Les sorties de ces
échecs restent dans `pam04-npm-test-sandbox.log`,
`pam04-process-isolation-before-fix.log` et
`pam04-process-isolation-discovery.log`, dans le même répertoire local.

Les hooks du banc vérifient l’arrêt de tous leurs processus, puis suppriment
leurs profils et raccourcis. Contrôle final : zéro dossier `pam-bridge-*`
temporaire, zéro profil `.runtime-cache/process-*`, zéro raccourci
`PAM process fixture *.lnk`. Aucun profil, audio personnel, cache ou modèle
n’est inclus dans le commit.

## Limites

Les tests de pipe utilisent un faux sidecar Node et un champ audio synthétique,
avec des délais raccourcis sur la même implémentation. Ils vérifient les pipes,
la terminaison et la reprise réels sous Windows, sans bloquer une DLL d’inférence.
Le smoke utilise PAM compilé et le vrai moteur Needle pour préserver le contrat
de lancement ; il ne teste pas les clics de l’interface WebView2.
Aucune validation d’installateur ou publication n’est revendiquée.

Un effet natif déjà commencé peut finir après l’échéance ; le bridge rend alors
un résultat incertain, ne le rejoue pas et conserve la sérialisation de l’acteur.
La reprise ne promet pas d’annuler rétroactivement une application déjà lancée.
Les assertions de temps incluent une marge d’ordonnancement Windows ; l’échéance
de production reste fixée à 50 secondes pour l’opération entière.

## Fichiers livrés

`src-tauri/src/bridge.rs`, `src-tauri/src/bridge_tests.rs`,
`src-tauri/src/lib.rs`, `src-tauri/src/applications.rs`,
`tests/fixtures/bridge-sidecar.cjs`, `README.md` et ce document.
