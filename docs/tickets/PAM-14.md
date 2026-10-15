# PAM-14 — Responsabilités Rust et invariants unsafe

Ticket : https://app.notion.com/p/3f7b3e0422a481a2aa77cd5977ec5c2b

Run `c6124deb-00ca-405c-94f8-dd71183eebb3`, worker
`01a13e85-73d4-7cc1-8206-9a153bc7721b`, génération 15.
Base `ed7a2ac1962e964cd939caf75e026fe6d06ecfb8`, branche
`codex/deezer-routing`. Relais nominatif, autorisation humaine d’origine,
contrat intégral et prérequis PAM-13 vérifiés ; livraison de PAM-13 intégrée.
Validation locale le 15 octobre 2026, Windows x64, Rust/MSVC 1.99.0,
Node 24.21.0 et npm 11.19.0. Revue effectuée par le worker implémenteur.

## Changement

Extraction de `host`, `desktop`, `supervision`, `job`, `windows_resources`,
du catalogue natif et de l’hôte de tests ; le bridge conserve son acteur et
ses contrats PAM-13. Le Job Object possède un `OwnedHandle`, sans unsafe impl.
`OwnedProcess` prend le processus avant la création faillible du job, puis
termine et attend l’enfant sur tout abandon. La fermeture du job précède
l’attente des lecteurs. Les lancements utilisateur restent hors de ce job.

Les gardes COM/WinRT ne peuvent changer de thread ; interfaces, chaînes
CoTaskMem, bitmaps et DC possèdent des libérations déterministes. Les grands
blocs unsafe du catalogue deviennent des appels ciblés avec pointeurs,
allocations, tailles, durée de vie et conditions COM explicités. Les lints
imposent ces justifications. Le raster reste borné, avec hauteur vérifiée.
Les interfaces processus, fabrique, horloge et transport permettent des tests
isolés. Voir `docs/rust-boundaries.md` pour les frontières et invariants durables.

## Critères et preuves

| Critère | Preuves |
| --- | --- |
| Opérations unsafe justifiées, ressources libérées et modules isolables | Lints stricts et revue de toutes les zones ; interfaces injectées ; tests de création refusée, délai avant effet, supervision sans attente réelle, erreur de kill suivie d’attente. |
| Chaque unsafe/unsafe impl comporte un invariant précis | Aucun unsafe impl restant. Justifications locales des appels Shell, GDI, Job, COM/WinRT et de la fixture de raccourci ; Clippy tous targets/toutes features sans avertissement. |
| Retours anticipés et erreurs libèrent handles et COM | Test natif : erreur après assignation, fermeture du job et mort de son enfant jetable. Test COM : deux initialisations STA, erreur, passage MTA réussi et échec STA sans désinitialisation indue. Test GDI : bitmap valide/oversized et handle effectivement invalide après destruction. Chaînes vides/UTF-16 invalide converties par le propriétaire CoTaskMem. |
| Comportement public identique, bridge et Job Objects verts | 35 tests Rust, 235 tests Node ; six scénarios natifs arrêt/redémarrage/crash, via chemin manuel et raccourci. Moteur Needle réel, enfants internes morts et exécutable de test utilisateur survivant. IPC, catalogue, disponibilité, paramètres et non-rejeu vérifiés. |

## Contrôles réellement exécutés

Les journaux sont locaux sous `artifacts/autonomy/`. Les fixtures nécessaires
sont suivies dans le dépôt ; aucune dépendance à ces journaux pour les tests.

| Commande | Résultat | Journal |
| --- | --- | --- |
| `cargo test --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc --all-features` | 35 réussis, zéro échec/ignoré | `pam14-cargo-final.log` |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc --all-targets --all-features -- -D warnings` | Réussi sans avertissement | `pam14-clippy-final.log` |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | Réussi | `pam14-format-check.log` |
| `npm test` | 235 réussis, zéro échec/ignoré | `pam14-npm-test.log` |
| Build Windows `--features process-tests --examples --bins`, même manifeste/cible et `--locked` | Réussi | `pam14-native-build.log` |
| `rustc` fixture de processus jetable | Réussi | `pam14-fixture-build.log` |
| `node scripts/smoke-process-isolation.mjs <hôte> <fixture>` | Six scénarios réussis, enfants internes arrêtés, fixture utilisateur survivante, paramètres conservés | `pam14-process-isolation.log` |
| `node scripts/smoke-contracts.mjs <hôte>` | Admission sans effet, IPC corrélé, lancement jetable, consumed/expired et non-rejeu | `pam14-native-contracts.log` |
| `node scripts/smoke-applications.mjs <découverte> <hôte>` | Catalogue Windows réel, raccourci jetable, arguments conservés, aucun modèle pour le brouillon | `pam14-applications.log` |
| `node scripts/smoke-application-availability.mjs <hôte>` | Cibles absentes refusées, désactivation/réparation/réactivation correctes | `pam14-availability.log` |
| `git diff --check` | Réussi | Contrôle avant commit |

Les premiers essais ont signalé le chemin de module des exemples autonomes,
un identifiant de test non conforme et une justification unsafe mal placée
pour Clippy ; corrigés. Le smoke de processus attendait les anciennes erreurs
texte, le refus d’une confirmation déjà consommée et une métadonnée retirée
du contrat. Il vérifie maintenant les codes, corrélations et statut `consumed`.
Chaque scénario utilise un exécutable jetable distinct : le cache AppsFolder
peut retenir un ancien raccourci et dédupliquer une cible identique. Les
assertions sur survie/mort des processus et paramètres sont conservées.
Un essai interrompu avant l’enregistrement du PID avait laissé son exécutable
de test : arrêté après vérification de son chemin exact. Le smoke enregistre
désormais ce PID avant toute assertion supplémentaire ; la suite finale et le
contrôle de nettoyage n’ont laissé aucun processus de test.

## Limites et fichiers

Les décisions de supervision et erreurs de processus ont des doubles ; les
preuves de pipes, jobs, COM, GDI et raccourcis utilisent Windows réel. Injecter
l’horloge ne remplace pas les attentes système. L’intégration desktop est
compilée, sans revendication de parcours visuel WebView2 ou de clics tray.
Aucun programme personnel commandé, aucun paquet portable/NSIS ni signature,
push ou publication. Profils, raccourcis et processus de test sont nettoyés.
Les dépendances Linux préexistantes restent intactes ; aucun build Vue requis
par ce diff Rust. Aucun fichier du dispositif autonome modifié.

Fichiers : `src-tauri/src/{lib,bridge,bridge_tests,applications,media}.rs`,
nouveaux modules `host`, `desktop`, `job`, `supervision`, `windows_resources`,
`process_tests`, `applications/native`, les deux exemples, le smoke de processus,
la documentation des frontières et cette preuve. Le diff fournit la liste
exhaustive. Le reçu local conserve les SHA complets et empreintes des journaux.
