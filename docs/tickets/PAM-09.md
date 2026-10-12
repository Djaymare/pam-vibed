# PAM-09 — Désactiver et réparer une application indisponible

Ticket : https://app.notion.com/p/3f7b3e0422a4813aa987cedbefad9ce2

Livraison du 13 octobre 2026 sur `codex/deezer-routing`, base
`1f7e64f5bef48e58b3bdd09e1baea61d7f9b5813`. Prérequis PAM-05 confirmé
« Terminé », commit `1210cf04b0bdb89391a7082c3cd14c2e722d400b` intégré.

## Comportement livré

Le changement d’état utilise `set_application_enabled` avec seulement ID et
booléen. La désactivation conserve la fiche, ses arguments, alias et formulations,
sans vérifier la présence de sa cible. La sauvegarde complète d’une fiche
existante désactivée peut également conserver sa cible disparue. Le schéma et
ses erreurs de référence restent ceux de PAM-05, avant les contrôles de présence.

Un ajout, changement de chemin ou une réactivation revalide l’exécutable.
Pour les fiches Windows, le bridge relit la fiche persistée et le catalogue
actuel : le chemin/les arguments doivent correspondre à la cible canonique.
Chaque lancement natif vérifie un catalogue frais ; une entrée du sélecteur
mise en cache ne donne aucune autorisation après désinstallation. Sans hôte
natif, le lanceur Node refuse les fiches Windows plutôt que lancer Explorer
sans vérifier leur cible. Les exécutables manuels restent sans shell.

`status.applicationAvailability` sépare disponibilité et validité structurelle.
L’interface affiche « Indisponible », conserve la désactivation et la suppression,
et permet de réparer le chemin ou sélectionner une nouvelle cible Windows.
La sélection conserve l’identité et les formulations ; annuler revient au même
brouillon. Modifier la cible met à jour ses arguments de lancement canoniques.

## Preuves des critères

| Critère | Preuve |
| --- | --- |
| Désactiver une cible disparue sans supprimer ses formulations | `sidecar/availability.test.cjs` compare toute la fiche et les formulations avant/après. Le smoke du bridge réel fait de même avec un .exe supprimé et une fiche Windows absente. |
| `enabled:false` sauvegardé sans stat bloquant | La régression intercepte `fs.stat` et vérifie zéro appel pour le changement d’état et la sauvegarde complète de la cible inchangée. La même sauvegarde Windows passe dans le bridge natif. |
| Formulations conservées et réactivation après réparation | Régressions Node et native : activation refusée avant réparation, remplacement par un exécutable de test puis activation réussie, IDs/arguments/formulations conservés. Parcours WebView2 : réparation manuelle et remplacement Windows gardent une seule fiche. |
| Impossible de lancer une application indisponible en contournant l’interface | Tests directs `test_application`/`confirm`, lancement Rust avec entrée de catalogue obsolète, et refus du lanceur Node sans hôte. Le smoke natif confirme que le catalogue absent échoue même si Explorer existe. |

## Validations exécutées

Windows x64, Node 24.21.0, npm 11.19.0, Rust 1.99.0, MSVC,
WebView2 Chromium/Edge 154. Profils, raccourcis et exécutables jetables uniquement.

| Contrôle | Résultat | Trace locale |
| --- | --- | --- |
| `npm test` | 182 réussis, 0 échec, 0 ignoré | `artifacts/autonomy/pam09-npm-test.log` |
| `npm run build` dans l’environnement Windows isolé existant | Réussi ; tous les inputs Vue/build identiques au checkout | `pam09-build-windows.log`, `pam09-build-inputs.json` sous `artifacts/autonomy/` |
| `cargo test --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc --features process-tests` | 16 réussis, 0 échec, 0 ignoré | `artifacts/autonomy/pam09-cargo-test-final.log` |
| Clippy mêmes options, `--all-targets -- -D warnings` | Réussi sans avertissement | `artifacts/autonomy/pam09-clippy.log` |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | Réussi | Exécution avant commit |
| `node scripts/test-modals.mjs` avec hôte WebView2 jetable | 48 contrôles réussis, dont 8 sur disponibilité/réparation | `artifacts/autonomy/pam09-webview.log` |
| `node scripts/smoke-application-availability.mjs <pam-process-test.exe>` | Bridge Rust et sidecar réels : deux scénarios réussis | `artifacts/autonomy/pam09-native-availability.log` |
| `node scripts/smoke-applications.mjs <discovery.exe> <pam-process-test.exe>` | 113 entrées, 35 Store, 113 icônes ; lancement du marqueur via Windows réussi, sans enregistrement | `artifacts/autonomy/pam09-applications.log` |
| `npm run test:integration` | Needle/Whistle réels, confirmation/lancement du test et 8 formulations réussis | `artifacts/autonomy/pam09-integration.log` |
| `git diff --check` | Réussi | Exécution avant commit |

Le premier npm test a détecté une priorité d’erreur de schéma modifiée : elle a
été rétablie sans changer ses assertions. Le contrôle de catalogue a d’abord
dépassé son délai à cause de rescans par entrée ; les validations groupées de
lecture utilisent maintenant un seul snapshot, les effets un scan frais.
La fixture de raccourci utilise une copie de Node unique pour éviter la
déduplication avec les cibles des autres raccourcis ; toutes les assertions
de découverte et de lancement sont conservées.

Le checkout racine conserve ses dépendances Linux préexistantes. Son build
Windows est refusé par `check:development` ; l’environnement isolé
`artifacts/pam34/windows` exécute le vrai build des sources identiques.
Les processus Node de test nécessitent l’autorisation d’environnement après
un refus sandbox `EPERM`. Le test WebView2 simule seulement les services natifs ;
leur validation est assurée séparément par le bridge réel. Aucun paquet/NSIS
ni test sur des applications personnelles n’est revendiqué. Les traces locales
sont ignorées ; les nouvelles régressions ne dépendent pas de leur présence.
Vérification effectuée par le worker implémenteur, sans revue indépendante.

Fichiers : `sidecar/assistant.cjs`, `sidecar/availability.test.cjs`,
`src-tauri/src/applications.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/launch.rs`,
`src-tauri/examples/discovery.rs`, `src/App.vue`, `src/types.ts`,
`scripts/test-modals.mjs`, `tests/fixtures/modal-native.js`,
`scripts/smoke-application-availability.mjs`, `scripts/smoke-applications.mjs`,
`README.md`, `docs/tickets/PAM-09.md`.
