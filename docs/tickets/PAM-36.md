# PAM-36 — paquet portable neuf, traçable et publié atomiquement

- Fiche : https://app.notion.com/p/3f7b3e0422a481a4b4ffc2936585fe2e
- Run : `c6124deb-00ca-405c-94f8-dd71183eebb3`.
- Worker : `01a14d63-038c-7ae0-8f12-5248ac28064b`, génération 36.
- Branche : `codex/deezer-routing`.
- Base : `43ea80370ada0b85429ac5783562d69965687bb2`.
- Prérequis PAM-34 relu intégralement dans Notion, livraison et ascendance Git vérifiées.
- Environnement : Windows x64, Node 24.21.0/npm 11.19.0, Rust 1.99.0/MSVC,
  WebView2 155.0.4283.60. Dépendances Windows isolées dans un clone de validation ;
  les dépendances Linux préexistantes du checkout partagé sont préservées.

## Changement

Le build de distribution exige des sources committées et produit un reçu qui
nomme explicitement son binaire, son empreinte, le commit, la version et un UUID.
L'identité compilée lie aussi les sources, le front Vite, le sidecar, les modèles
et chaque ressource du runtime. Le binaire la renvoie avec `--pam-build-info`
avant toute initialisation Tauri. Chaque build crée un nouvel UUID ; un build
échoué invalide son reçu précédent. Un verrou exclusif interdit deux builds
simultanés dans le même checkout. La sélection opportuniste d'un ancien
exécutable dans plusieurs dossiers a disparu.

L'assemblage vérifie la provenance et les inventaires, copie dans un staging
neuf borné sous `artifacts/`, puis vérifie tous les SHA-256. Il renomme ce staging
en dossier immuable `releases/<UUID>` et publie son chemin par un seul renommage
atomique de `current.json`. Ce pointeur contient aussi le hash du manifeste.
Un lecteur garde le chemin complet qu'il a résolu ; les publications précédentes
restent disponibles. Aucun renommage de deux dossiers non vides et aucune
suppression préalable du pointeur ne simulent une opération atomique.
Les verrouillages transitoires Windows du pointeur ont une reprise bornée à
50 tentatives, espacées de 20 ms ; chaque échec laisse l'ancien pointeur intact.

Le manifeste `distribution.json` couvre tous les fichiers livrés, sauf son
propre hash qui est porté par le pointeur. Le front distribué est une copie des
assets effectivement embarqués par Tauri ; les empreintes sont capturées avant
Cargo puis revérifiées après compilation. Les inventaires du sidecar et des
documents sont limités aux sources versionnées ; les tests et les documents
d'autonomie/livraison ne sont pas distribués. Les jonctions et liens de sortie
sont refusés avant création des enfants. La CI Windows appelle `verify:bundle`
après `package:portable`.

## Critères et preuves

| Critère | Preuve |
| --- | --- |
| Paquet neuf, commit annoncé, PATH vide, absence de code/ressource refusée | Reçu lié à l'identité embarquée, inventaires exacts et hashes. Vérification native du paquet de validation : imports PE x64, identité du binaire, GSMTC en lecture seule, Needle et Whistle, sidecar et exécutable jetable sans Node/Cargo dans PATH. |
| Ancien fichier absent de la nouvelle distribution | Régression qui injecte `obsolete.txt` dans une publication, réassemble puis vérifie que le nouveau dossier ne le contient pas. Lectures concurrentes de `current.json` pendant la bascule : chaque observation désigne une publication complète. |
| Binaire obsolète ou ressource manquante rejetés | Régressions pour binaire altéré, reçu invalide, modèle manquant, module sidecar manquant et front manquant ; le pointeur précédent reste inchangé après échec. Ajout/suppression/altération du paquet détectés par le manifeste. |
| Fonctionnement sans Node/Cargo dans PATH, bon commit annoncé | Binaire final du clone de validation et sidecar lancés avec PATH vide, environnement réduit et profil temporaire. `--pam-build-info` égale l'identité attendue. Inspection native accessible de WebView2 : document `https://tauri.localhost/`, navigation Vue, premier usage et état « Moteurs en mémoire ». |

## Contrôles exécutés avant commit d'intégration

Journaux locaux ignorés dans `artifacts/autonomy/` :

| Commande/contrôle | Résultat | Journal |
| --- | --- | --- |
| `node --test tests/portable.test.mjs` | 0 ; 6 réussis, aucun ignoré | `pam36-targeted-final.log` |
| `npm test` | 0 ; 409 réussis, aucun ignoré | `pam36-tests-delivery.log` |
| Clone Windows neuf : `npm ci`, `npm run build` | 0 ; bindings Windows, TypeScript/Vite réels | `pam36-npm-ci.log`, `pam36-front-build.log` |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | 0 | `pam36-fmt-check.log` |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc --all-targets -- -D warnings` | 0 | `pam36-clippy.log` |
| `cargo test --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc` | 0 ; 55 réussis, aucun ignoré | `pam36-rust-tests.log` |
| Clone de validation : `npm run build:portable` | 0 ; build release Tauri/Cargo verrouillé, identité extraite du PE conforme | `pam36-build-validation.log` |
| Clone de validation : `npm run package:portable` | 0 ; publication du dossier complet | `pam36-package-validation.log` |
| Vérification native du paquet avec le harness livré | 0 ; identité/PE/GSMTC/Needle/Whistle/confirmation/status, PATH vide | `pam36-verify-validation-final.log` |
| Inspection Computer Use du paquet de validation, sans saisie/action | Front Vue réellement rendu et moteurs chargés ; profil jetable ; processus arrêtés | `pam36-ui-inspection-accessibility.json`, `pam36-ui-inspection.json`, `pam36-ui-inspection-cleanup.log` |

Le build initial du clone utilise un commit local de validation, distinct de
la livraison. Les scripts ont ensuite été finalisés ; la compilation et les
contrôles du commit d'intégration exact seront rejoués avant clôture Notion et
consignés dans le reçu, puis cette preuve sera complétée.

## Incidents résolus et limites

- La lecture concurrente du pointeur a révélé `EPERM` transitoire sous Windows ;
  la reprise bornée conserve l'atomicité. La régression concurrente passe.
- Une exécution de la suite pendant la compilation release a fait échouer un
  test existant de budget temporel. Hors charge, les 409 tests repassent sans
  modification de ce test ni neutralisation de contrôle.
- Le premier smoke de confirmation omettait un champ requis de `settings` ;
  le harness transmet maintenant `confidenceThreshold` et le scénario réel passe.
- Le port CDP n'était pas accessible sur le binaire release dans cet environnement.
  Il n'a pas été activé dans le produit pour le test. L'inspection native accessible
  prouve le front WebView2 effectivement rendu. La capture visuelle Computer Use a
  expiré ; la preuve conservée est l'arbre accessible, pas une capture revendiquée.
- Les fixtures PE des tests unitaires ne prouvent pas l'exécution Windows ; celle-ci
  est établie séparément sur les vrais fichiers du paquet. L'audio est un silence
  synthétique ; aucun microphone ni lecteur personnel n'est commandé.
- Les anciennes publications ne sont pas automatiquement effacées. Le paquet actif
  est le seul dossier résolu par `current.json`, comme documenté dans `docs/portable.md`.
  Un installeur NSIS, une signature et une publication externe ne sont pas validés
  par cette livraison portable. Aucune CI distante ni aucun push n'est effectué.
- Les profils de test, runtime, modèles, exécutables et caches restent ignorés et
  ne sont pas committés. Les fichiers de contrôle de l'autonomie restent inchangés.

## Fichiers

`.github/workflows/windows.yml`, `README.md`, `package.json`, `vite.config.ts`,
`src-tauri/build.rs`, `src-tauri/src/main.rs`, `scripts/build-windows.mjs`,
`scripts/portable-integrity.mjs`, `scripts/package-portable.mjs`,
`scripts/verify-bundle.mjs`, `scripts/smoke-portable.cjs`, `tests/portable.test.mjs`,
`docs/portable.md` et cette preuve.
