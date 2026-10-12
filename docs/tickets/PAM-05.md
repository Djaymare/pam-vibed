# PAM-05 — Validation du profil et récupération explicite

Ticket : https://app.notion.com/p/3f7b3e0422a481c99828cd35f53bd2b3

Run `c6124deb-00ca-405c-94f8-dd71183eebb3`, worker
`01a1316e-44ef-77f1-bc14-fe9f59106536`, génération 6. Base :
`54f28e95f4fa15ff384589ba116f728c8018c096`, branche `codex/deezer-routing`.
Aucun prérequis bloquant. Contrat Notion complet relu avant implémentation.
Cette vérification est celle du worker qui a réalisé le changement.

## Comportement livré

`config-schema.cjs` définit le schéma de version 1 utilisé par la lecture,
toutes les écritures du profil et la récupération. La validation structurelle
ne consulte pas le disque pour vérifier l’exécutable. L’ajout ou le changement
de cible et le lancement conservent leur contrôle de disponibilité. Une fiche
existante reste lisible et désactivable si son exécutable a disparu.

La lecture est bornée à 2 Mio, vérifie UTF-8 et JSON, puis le schéma. Une erreur
de profil donne un diagnostic avec l’index de la fiche ou la rubrique concernée.
`status` renvoie `configError`, `ready: false` et un profil sûr sans applications ;
les autres opérations refusent le profil avant inférence, effets ou écriture.
Le contrôle de santé retire aussi les fiches devenues invalides du rendu Vue.
Les préférences valides en cours d’édition restent préservées lors de ce contrôle.

Le bouton « Récupérer le profil » ouvre une confirmation décrivant le retrait
des applications/formulations actives et le retour aux préférences par défaut.
L’utilisateur peut annuler. La confirmation appelle `recover_config` avec
l’empreinte observée. Le sidecar refuse une empreinte obsolète ou un profil
désormais valide, copie l’original sous un nom unique avec création exclusive,
vérifie la copie et l’état de l’original, puis remplace atomiquement le profil
par la configuration vide de version 1. Le chemin de sauvegarde est affiché.
Une copie ou un remplacement refusé laisse l’original intact. Aucune réparation
n’est déclenchée automatiquement par lecture ou erreur.

## Inventaire du schéma

| Rubrique | Champs et contraintes |
| --- | --- |
| Profil | `version` vaut le nombre 1 ; `applications` contient au plus 32 fiches ; `commandAliases` contient au plus 64 formulations. Les anciens profils v1 sans `commandAliases` obtiennent une liste vide en mémoire uniquement. Champs inconnus refusés. Fichier/JSON sérialisé : 2 Mio maximum. |
| Préférences | `language` : auto/fr/en/de/es/it/nl/pl ; `autoExecute` booléen ; `confidenceThreshold` nombre fini entre 0,1 et 1. |
| Application | `id` UUID, unique sans distinction de casse ; `name` non vide, 60 caractères ; `description` non vide, 240 ; `executable` chemin Windows absolu `.exe`, 1024. NUL refusé. Noms uniques après normalisation. `enabled` booléen. |
| Arguments et alias | `arguments` : 20 chaînes maximum, 2048 caractères chacune, sans NUL ; substitution `{input}` conservée. `aliases` : tableau requis, six textes non vides de 40 caractères maximum, uniques après normalisation dans chaque fiche. Les alias partagés entre applications restent possibles et soumis aux protections d’ambiguïté existantes. |
| Application Windows | Optionnelle ; `appId` non vide, 1024, sans caractères de contrôle ni `{input}`, unique sans distinction de casse ; `kind` desktop/store ; `launchArgument` doit correspondre à AppsFolder ou au raccourci desktop `.lnk`. Exécutable explorer.exe et argument cohérents avec la cible. `icon` PNG base64 ou null, 32768 caractères maximum, en-tête et dimensions 1–64 vérifiés. |
| Multimédia | Optionnel ; `sourceAppId` non vide, 1024, sans contrôle ; `deezer` booléen. Plugin Deezer lié à son AppUserModelID et à ses sources de session connues. Les capacités live restent obtenues depuis les sessions Windows, sans être inventées dans le profil. |
| Formulation | `id` UUID, `phrase` non vide de 200 caractères maximum sans contrôle ; identifiants et phrases uniques ; `applicationId` référence une fiche existante ; `action` appartient à la liste autorisée et à une capacité configurée de cette fiche ; `arguments` contrôlés par le validateur Deezer ou vides pour les autres actions. |

## Preuves des critères

| Critère du contrat | Preuve suivie et résultat |
| --- | --- |
| Profils incomplets, types incorrects, doublons et versions incompatibles : erreur exploitable ; aucun écrasement silencieux | `sidecar/config.test.cjs` : champs absents, types/null, listes/tailles, UUID, noms/alias doublons, UTF-8/JSON invalide et version future ; diagnostics stables sur deux lectures ; original identique en octets après status et écritures refusées. Tests de copie refusée, remplacement refusé, empreinte périmée, sauvegarde exacte et récupération confirmée. |
| `{id:'broken', enabled:true}` refusé avant normalize | Fixture suivie `sidecar/fixtures/profiles/broken.json`, statut sûr sans fiches ; erreur `applications[0]`, sans TypeError normalize ; process_text, settings, save/delete application, save alias et confirm refusés ; compteurs d’inférence/lancement à zéro. |
| Types, doublons, référence inconnue, taille excessive et version future déterministes | Mutations de la fixture valide, références/capacités de formulations, plus de 32 fiches/64 formulations/20 arguments, chaînes trop longues et fichier dépassant 2 Mio. Résultats et empreintes identiques pour les lectures répétées. Écriture sans capacité encore référencée refusée ; suppression d’application retire ses formulations. |
| Un exécutable absent ne rend pas le profil structurellement invalide | Fixture valide avec `C:\PAM-test-absent\editor.exe` absent : lecture identique, changement `enabled` accepté sans disponibilité du fichier, status sans configError. Ajout/changement de cible et lancement continuent de vérifier le fichier. |

`tests/profile-recovery.test.mjs` compile et monte le vrai composant App avec
le renderer Vue en mémoire. Quatre tests : profil valide chargé ; profil
invalide avec demande désactivée et annulation sans effet ; confirmation avec
empreinte et sauvegarde affichée ; erreur de sauvegarde sans annonce de succès.
Services Tauri, temporisateurs
et composants enfants non concernés simulés. Ces tests ne prouvent pas WebView2.

## Validations exécutées

Windows x64, Node 24.21.0, npm 11.19.0, Rust/Cargo 1.99.0 et MSVC. Profils
jetables, aucune application ni aucun lecteur personnel commandé.

| Commande | Résultat | Journal local |
| --- | --- | --- |
| `npm test` | 0 ; 164 réussis, aucun échec/ignoré | `artifacts/autonomy/pam05-npm-test.log` |
| `npm run build` dans le checkout Windows isolé PAM-34 | 0 ; vue-tsc et Vite | `artifacts/autonomy/pam05-windows-build.log` |
| `npm run test:integration` | 0 ; Whistle/Needle réels, lancement d’un Node jetable écrivant un marqueur, alias de lancement | `artifacts/autonomy/pam05-integration.log` |
| `npm run test:deezer:routing` | 0 ; 48 contrôles corrects avec Needle réel, effets simulés | `artifacts/autonomy/pam05-deezer-routing.log` |
| `npm run test:media:commands` | 0 ; 65 contrôles corrects avec Needle réel, sessions/effets simulés | `artifacts/autonomy/pam05-media-commands.log` |
| `cargo test --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc` | 0 ; 15 tests Rust Windows réussis, aucun ignoré | `artifacts/autonomy/pam05-cargo-test.log` |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc --all-targets -- -D warnings` | 0, sans avertissement | `artifacts/autonomy/pam05-clippy.log` |
| `rustfmt --check --edition 2021 --config skip_children=true src-tauri/src/lib.rs` | 0 | `artifacts/autonomy/pam05-format.log` |
| `git diff --check` | 0 | Chat/reçu |

Le build à la racine refuse les dépendances Linux préexistantes (code 1,
`pam05-build.log`) ; aucun node_modules n’a été remplacé. Son empreinte
`.package-lock.json` reste `b26e0751970b1fd8d7d738a65a51a600e1ee604de9d25fc41af9e4a409296691`.
Le build réussi réutilise les dépendances Windows isolées existantes avec copie
explicite de App.vue/types.ts/package.json identiques aux sources livrées ; autres
entrées de build vérifiées identiques après normalisation des fins de ligne.
Rust compile les sources du checkout partagé avec le
cache/toolchain Windows PAM-34. Le premier appel Clippy a perdu le séparateur
PowerShell `--` et échoué avant compilation ; l’appel en tableau d’arguments
ci-dessus a réellement réussi.

## Fichiers et limites

Ajouts : `sidecar/config-schema.cjs`, `sidecar/config-store.cjs`,
`sidecar/config.test.cjs`, les deux fixtures de profils, le test de récupération
Vue et cette preuve. Changements : `sidecar/assistant.cjs`, quatre suites
existantes d’assistant/Deezer/média, les deux smoke tests de routage, App.vue,
types.ts et l’autorisation de méthode dans `src-tauri/src/lib.rs`.

Les fixtures multimédia représentent maintenant une vraie cible AppsFolder ;
elles continuent de simuler tous les effets. Le doublon de cible Windows est
refusé avant Needle ; la protection d’ambiguïté du résolveur est aussi testée.
Aucun test n’est désactivé. Aucun fichier de protocole ou contrôle modifié.

La récupération restaure un profil vide après conservation de l’original ;
elle ne fournit pas migration successive, import/export ni restauration
automatisée de sauvegardes (PAM-11). Les fichiers non ordinaires/symlinks sont
refusés sans récupération automatique. Pour les profils trop volumineux,
l’empreinte utilise le préfixe de lecture borné, la taille et la date de
modification ; la copie sauvegarde le fichier entier. Pas de paquet Windows,
signature ou parcours WebView2 revendiqué pour ce ticket.
