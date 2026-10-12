# PAM-34 — environnement de développement reproductible

- Fiche : https://app.notion.com/p/3f7b3e0422a481c1a3f4ed24d7cfafea
- Run : `c6124deb-00ca-405c-94f8-dd71183eebb3`.
- Worker : `01a13038-07e5-7132-958e-3b13da5c3f2b`, génération 1.
- Branche : `codex/deezer-routing`.
- Base : `a7034937e479617ca961f858a283626c0612ac76`.
- Validation locale : 12 octobre 2026, Windows x64 et conteneurs Debian bookworm x64.
- Aucun prérequis bloquant ; contrat Notion relu avant livraison, sans divergence.

## Changement livré

Le parcours Docker copie les sources dans son propre environnement au lieu
d'utiliser un checkout monté en lecture/écriture. `.dockerignore` exclut les
dépendances et caches de l'hôte. Le parcours Windows utilise un clone distinct.
Les dépendances Linux préexistantes dans le checkout partagé ont été préservées.

Node 24.21.0 / npm 11.19.0 sont déclarés dans `engines`, `packageManager`,
`.node-version` et `.npmrc`. Rust 1.99.0, Clippy, rustfmt et la cible Windows sont
fixés dans `rust-toolchain.toml` ; PAM déclare un MSRV de 1.99. Ce plancher est
celui testé pour cette livraison, sans affirmation de compatibilité avec un Rust
plus ancien. cargo-xwin 0.23.1 est installé avec `--locked` dans le Dockerfile.

Le contrôle `check:development` charge les vrais bindings Rolldown et Tauri de
l'OS actif et vérifie le lanceur vue-tsc. Il s'exécute avant le front et les
commandes desktop. Il échoue explicitement si un checkout possède seulement les
dépendances d'un autre OS. Six tests ciblés couvrent la sélection Windows/Linux,
le lanceur étranger préservé, chacun des deux bindings absents/incompatibles et
les versions Node/npm incorrectes. Ces fixtures ne simulent aucune application
personnelle et ne remplacent pas les validations réelles des bindings.

La CI Windows utilise la même toolchain et `cargo check --locked`. Le job Linux
construit/exécute le Dockerfile versionné. Les commandes de packaging transmettent
`--locked` au runner Tauri ; la CLI installée confirme le support des arguments
supplémentaires du runner. README et `docs/development.md` décrivent les clones
neufs, l'isolation, les prérequis et les commandes sans conteneur propre à une
machine.

## Critères et preuves

| Critère du contrat | Preuve obtenue |
| --- | --- |
| Clone neuf et workflows Windows/Linux avec les versions documentées, sans bindings de l'autre OS | Clone local Windows neuf sans hardlinks sous `artifacts/pam34/windows`, puis copie explicite du diff final. Image Linux construite à partir des images Node/Rust versionnées et d'un contexte filtré, aucun bind mount. Les fichiers livrés du clone Windows correspondent par SHA-256 au checkout d'intégration. Contrôle réel des deux bindings réussi sur chaque OS. |
| `npm ci` puis `npm run build` réussissent dans chaque environnement | Windows : installations et build, code 0. Linux : couche `npm ci` du Dockerfile et build du conteneur neuf, code 0. Aucune dépendance de l'hôte copiée dans l'image. |
| Les dépendances Linux ne sont pas réutilisées sous Windows | Le clone Windows contient les bindings `win32-x64-msvc` et aucun des deux bindings `linux-x64-gnu`. Le checkout partagé contenant Linux est refusé sous Windows, code 1 attendu, sans modification. Son fichier `node_modules/.package-lock.json` conserve le SHA-256 `b26e0751970b1fd8d7d738a65a51a600e1ee604de9d25fc41af9e4a409296691`. L'image Linux ne contient aucun des deux bindings Windows. |
| Cargo/Clippy/rustfmt disponibles selon la procédure, CI aux mêmes versions | Windows et Linux : Cargo 1.99.0, Clippy 0.1.99, rustfmt 1.10.0-stable, tous issus de Rust 1.99.0. Les deux contrôles Cargo ciblent `x86_64-pc-windows-msvc` avec `--locked` et réussissent. Fichier toolchain, MSRV, Dockerfile et configuration CI concordants. |

## Commandes et résultats réels

Les journaux détaillés sont locaux et ignorés sous `artifacts/pam34/`. Ce document
versionné conserve les résultats nécessaires ; les SHA complets du commit final
sont enregistrés séparément dans le reçu du run.

| Environnement | Commande | Résultat | Journal |
| --- | --- | --- | --- |
| Windows neuf | `npm ci` | 0 ; 49 paquets installés | `windows-npm-ci.log` |
| Windows neuf | `npm run check:development` | 0 ; Rolldown et Tauri Windows chargés | `windows-bindings.log` |
| Windows neuf | `npm run build` | 0 ; TypeScript/Vite réussis | `windows-build.log` |
| Windows neuf | `npm run prepare:runtime` | 0 ; téléchargements officiels et vérifications SHA-256 | `windows-prepare.log` |
| Windows neuf | `npm test` | 0 ; **130 réussis, 0 échec, 0 ignoré**, dont les tests natifs moteur/protocole Windows | `windows-tests.log` |
| Windows neuf | `cargo check --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc` | 0 | `windows-cargo-check.log` |
| Windows neuf | `cargo test --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc --lib` | 0 ; 1 test Rust natif réussi | `windows-rust-tests.log` |
| Linux neuf | `docker build -f Dockerfile.development -t pam34-development .` | 0 ; `npm ci` et bindings Linux vérifiés | `docker-build.log`, `docker-build-final.log` |
| Linux neuf | `docker run --rm pam34-development` | 0 ; tests, build, préparation et `cargo xwin check --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc` | `linux-validation.log` |
| Linux image finale | `npm test`, contrôle des bindings et des versions | 0 ; **127 réussis, 0 échec, 3 ignorés**, tous spécifiques à Windows et exécutés sur Windows ; six régressions du ticket réussies | `linux-final-checks.log` |
| Les deux OS | `cargo --version`, `cargo clippy --version`, `cargo fmt --version` | 0 ; composants disponibles aux versions annoncées | `windows-tools.log`, `linux-final-checks.log` |
| Windows partagé, ancien `node_modules` Linux | `node scripts/check-development.mjs` | **1 attendu** ; lanceur Windows absent, dépendances étrangères préservées | `shared-checkout-guard.log`, `isolation.json` |

Les hash des lockfiles sont identiques après les contrôles Windows et Linux :

- `package-lock.json` : `97e2dc5b6fcb418dec313bc8081c2dc96714ee7138b7b139342faaa009cc94ad`.
- `src-tauri/Cargo.lock` : `4ea6ad459e00bb7d71873e6754a256dcc31499e80ca2c6bb712e923194ad858e`.

Le diff npm n'ajoute que les métadonnées `engines` à la racine du lockfile ;
aucune version ni intégrité de dépendance n'est modifiée. Cargo.lock est inchangé.
`git diff --check` réussit et aucun fichier de contrôle de l'autonomie n'est
modifié. Les conteneurs et processus de test connus ont terminé.

## Incidents résolus et limites

- Le premier `npm test` du clone Windows précédait la préparation du runtime :
  deux tests natifs échouaient faute de Koffi/modèles. La procédure prépare
  désormais le runtime avant les tests Windows ; la suite finale est entièrement
  réussie, sans désactiver de test.
- Le premier lancement Linux utilisait un shell de connexion qui masquait Cargo
  du PATH. Le Dockerfile utilise maintenant `sh -c`. La reprise complète termine
  avec un code 0.
- cargo-xwin émet deux avertissements de détection de famille du compilateur
  `clang-cl` pendant le build script Tauri ; le contrôle complet termine avec 0.
- La disponibilité de Clippy/rustfmt a été vérifiée. Cette livraison ne prétend
  pas avoir exécuté une nouvelle campagne de formatage/lint de tout le code Rust.
- Les jobs CI sont modifiés et leurs commandes de validation sont exécutées
  localement ; aucune exécution distante, publication ou push n'est effectuée.
  Les installeurs NSIS et le paquet portable n'ont pas été reconstruits par ce
  ticket. Les contrôles de packaging et de distribution restent distincts.
- Linux vérifie la cible Windows avec cargo-xwin ; cela ne remplace pas les
  contrôles de WebView2 ou des lecteurs personnels. Aucun lecteur ni application
  personnelle n'a été commandé. Les tests utilisent des profils jetables.
- Les images de base et versions des outils sont fixées ; les paquets Debian
  bookworm restent issus des dépôts de cette distribution, sans snapshot complet.

## Fichiers concernés

`.node-version`, `.npmrc`, `.dockerignore`, `Dockerfile.development`,
`rust-toolchain.toml`, `package.json`, `package-lock.json`,
`src-tauri/Cargo.toml`, `.github/workflows/windows.yml`,
`scripts/check-development.mjs`, `tests/development.test.mjs`, `README.md`,
`docs/development.md` et ce document.
