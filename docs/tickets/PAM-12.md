# PAM-12 — Erreurs structurées et diagnostics locaux

Ticket : https://app.notion.com/p/3f7b3e0422a481b9ac7fc6fa21ba40e1

Base : `128e340b8b77d54a2cc5e0ca5f65e01988b7d684`, branche
`codex/deezer-routing`. Run `c6124deb-00ca-405c-94f8-dd71183eebb3`,
worker `01a13d7d-a443-7b70-bfa1-12e0cd4f5f45`, génération 13.
Contrat intégral relu dans Notion : aucun prérequis bloquant, quatre critères.

## Changement livré

Le catalogue minimal `sidecar/error-catalog.json` fixe les codes, messages et
possibilités de réessayer. L’enveloppe comporte `code`, `stage`, `requestId`,
`retryable`, `message` et `technical.category`. Elle ne contient aucune sortie
technique brute. Rust reconstruit les enveloppes reçues de Node, avec son propre
identifiant de demande. Node garde cet identifiant pour ses diagnostics, les
erreurs du moteur, du profil et les résultats partiels. Les erreurs natives
d’application traversent aussi le retour hôte. Les actions restent soumises aux
validations et confirmations existantes ; aucun nouvel essai automatique d’effet.

Vue présente le message utile et la référence, l’étape et le code, y compris pour
les erreurs de profil, résultats d’action et demandes partielles. Les anciennes
erreurs de formulaire gardent leur message, avec masquage des chemins. Le refus
du microphone transmet seulement son code au journal natif. Les composants de
transfert, formulations et média comprennent aussi les enveloppes.

Le journal Rust écrit trois noms fixes sous `diagnostics` dans le profil :
64 Kio par fichier, 192 Kio au total, rotation avant dépassement. Chaque événement
contient l’heure, une origine/type autorisés et l’enveloppe reconstruite. Les
identifiants acceptés sont des références PAM numériques ou UUID. Les octets de
stderr sont drainés en blocs de 4 Kio et jetés ; un événement `sidecar_stderr`
signale leur présence. Le lecteur est arrêté et rejoint lors du retrait du worker.

L’export volontaire des Préférences retourne seulement le journal, avec une
seconde projection sur le schéma autorisé. Ni le profil, ni les reçus d’exécution,
ni les sorties brutes, ni les fichiers audio ne sont joints. Aucun envoi distant.
Les fichiers contenant un événement vieux de plus de sept jours sont supprimés
au prochain accès, même si leur date de modification est récente. Pas de purge
pendant la fermeture de PAM. Un export copié par l’utilisateur n’est pas purgé.
Une écriture impossible n’écrase pas la panne initiale ; l’export signale une
erreur `diagnostic_io` si le journal est inaccessible.

## Preuves des quatre critères

| Critère du contrat | Preuves exécutables |
| --- | --- |
| Distinguer modèle, microphone refusé, cible absente, timeout et profil corrompu, retrouver l’étape sans enregistrer le contenu personnel | `sidecar/diagnostics.test.cjs` injecte pannes modèle et transcription, profil corrompu, cible inconnue et budget expiré. Les tests Vue montent le vrai composant avec refus de microphone simulé. Les tests Rust exercent la cible absente au retour hôte et le vrai `sidecar/main.cjs` avec profil corrompu. |
| Un code stable et un message utile pour chaque famille | Catalogue commun et reconstructions Rust/Node ; assertions des codes/étapes, messages d’action et champs séparés. Les assertions anciennes qui attendaient du texte brut d’exécutable ont été remplacées par le code précis, le message d’action et l’absence de chemin ; les contrôles de refus, non-rejeu et profil inchangé sont conservés. |
| Une requête corrélable entre Rust et Node sans contenu vocal | `real_node_main_propagates_corrupt_profile_without_voice_content` vérifie la même référence dans les événements Rust et Node du vrai point d’entrée. `diagnostics_correlate_node_rust_and_stderr_without_personal_content` injecte aussi des champs malveillants et stderr. |
| Journaux bornés et recherche de sentinelles sensibles | Test Rust : 1 200 écritures, trois rotations, chaque fichier ≤ 65 536 octets, scan des fichiers et de l’export. Des messages, étapes, origines, identifiants et champs audio/transcription/arguments/chemins sentinelles sont écartés. Un fichier altéré est filtré, un fichier surdimensionné retiré, un événement ancien purgé. Tests Node et Vue vérifient aussi l’absence des sentinelles dans les diagnostics et alertes. |

## Contrôles et résultats

Windows x64, Node 24.21.0, npm 11.19.0, Rust/MSVC préparé par PAM-34.
Profils jetables et fixtures uniquement.

| Contrôle | Résultat | Trace locale `artifacts/autonomy/` |
| --- | --- | --- |
| `npm test` | 226 réussis, aucun échec ni ignoré | `pam12-test.log` |
| `npm run build` dans `artifacts/pam34/windows` | Réussi ; 26 entrées identiques, vue-tsc et Vite | `pam12-build-windows.log`, `pam12-build-inputs.json` |
| `cargo test --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc` | 21 réussis, aucun échec ni ignoré | `pam12-cargo-test.log` |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc --all-targets -- -D warnings` | Réussi sans avertissement | `pam12-clippy.log` |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | Réussi | `pam12-format-check.log` |
| `npm run test:integration` | Moteurs Whistle/Needle réels, marqueur créé par un Node de test | `pam12-integration.log` |
| `npm run test:deezer:routing` | 48 contrôles, Needle réel, effets simulés | `pam12-deezer.log` |
| `npm run test:media:commands` | 65 contrôles, Needle réel, sessions/effets simulés | `pam12-media.log` |
| `git diff --check` | Réussi avant commit | Vérification Git du worker |

Le build de la racine refuse le node_modules Linux préexistant (code 1,
`pam12-build-root.log`), préservé. La copie Windows emploie toutes les entrées
du build courant, comparées et hachées. Les sorties locales ignorées ne sont
pas des fixtures requises : les régressions sont suivies dans le dépôt.

Les tests Vue utilisent le renderer mémoire et simulent les services natifs,
le microphone et les minuteurs ; aucune validation WebView2 ou permission
matérielle réelle n’est revendiquée. Les pannes de modèle sont injectées ;
le moteur réel est validé séparément dans les smokes. stderr conserve sa présence
et sa corrélation, pas son texte brut. Les ressources des deux nouveaux modules
du sidecar sont déclarées pour Tauri ; aucun paquet NSIS ni signature testé ici.
Le contrat partagé complet reste le périmètre de PAM-13.

## Fichiers concernés

Ajouts : `sidecar/error-catalog.json`, `sidecar/diagnostics.cjs`,
`sidecar/diagnostics.test.cjs`, `src/errors.ts`, `src-tauri/src/diagnostics.rs`,
cette preuve.

Modifications : `sidecar/main.cjs`, `sidecar/assistant.cjs`, `sidecar/host.cjs`,
`sidecar/applications.test.cjs`, `sidecar/availability.test.cjs`,
`sidecar/protocol.test.cjs`, `src-tauri/src/bridge.rs`,
`src-tauri/src/bridge_tests.rs`, `src-tauri/src/lib.rs`,
`src-tauri/tauri.conf.json`, `src/App.vue`, `src/types.ts`,
`src/components/ProfileTransfer.vue`, `src/components/MediaControls.vue`,
`src/components/CommandAliases.vue`, `tests/profile-recovery.test.mjs`,
`tests/fixtures/bridge-sidecar.cjs`, `README.md`.

Aucun fichier de contrôle ou protocole modifié ; aucun push, publication ou
programme personnel commandé. Vérification par le même worker, sans revue indépendante.
