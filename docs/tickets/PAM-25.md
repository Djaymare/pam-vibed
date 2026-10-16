# PAM-25 — Actualisation des sessions média

Ticket : https://app.notion.com/p/3f7b3e0422a481eabd59e39b1b2b6cb0

Run `c6124deb-00ca-405c-94f8-dd71183eebb3`, worker
`01a14411-4232-7610-97d5-b0f8abbc94a3`, génération 26.
Base : `383f5971d1a17b2d3d0b42656264115f24b4210d`, branche
`codex/deezer-routing`. Vérification par le worker implémenteur.

Autorisation humaine d’origine relue dans le chat
`01a1302e-073c-7c53-9a09-84a51b1ab6af`, tour
`01a1302e-bbe7-7a12-b52c-e190cbd18e4d`, message
`01a1302e-be0e-7f21-b801-56d9d7a578e7`. Transfert nominatif
`6acb10fc-a701-43d6-92e1-fc38ea3766d8` vérifié, verrou court libéré,
checkout/index propres à l’entrée et fichiers de contrôle inchangés.
Contrat complet et prérequis Notion relus. PAM-17 et PAM-18 sont `Terminé` ;
leurs commits `13d319207d5002053a7f85693d41b75859d65337` et
`73df40b1fe5857b8237f941d002e58bb33874ea5` sont ancêtres du HEAD.

## Changement

`useMediaSessions` possède une lecture exclusive, une génération de livraison,
une temporisation et les listeners DOM de focus/visibilité. Il relit au montage,
au retour au premier plan, au changement de lecteur/source et après déverrouillage
du composant. Ce dernier couvre les résultats automatiques, confirmations réussies
et issues incertaines des contrôleurs existants. Aucune commande n’est rejouée.

Le sondage reprend 5 s après la fin réelle de la lecture, puis 10/20/30 s après
des erreurs. Il est suspendu sans cible, hors premier plan, pendant une opération
ou après démontage. Une invalidation pendant un appel conserve la réservation
jusqu’à sa fin et demande au plus une lecture suivante. Un rendu sans changement
de cible ne provoque aucun appel. Les résultats de l’ancienne génération sont
ignorés ; les capacités antérieures sont retirées lors d’une invalidation/erreur.

Le retrait de l’application sélectionnée n’active plus automatiquement la suivante.
Une session absente, ambiguë, en erreur ou sans capacité publiée laisse les boutons
indisponibles. Les motifs sont visibles et reliés par `aria-describedby` ; un handler
direct recontrôle cette disponibilité. L’état de lecture inconnu reste explicite.
Le client IPC, la confirmation et les validations Node/Rust restent inchangés :
résolution exacte, capacités courantes et appartenance de l’objet natif à l’ensemble
vivant avant l’effet, sans repli vers le lecteur courant.

## Critères et preuves

| Critère de la fiche | Preuve |
| --- | --- |
| Lecture, pause et titre se mettent à jour sans Actualiser ; backend obligatoire | Neuf régressions dans `tests/media-refresh.test.mjs`, dont vrais contrôleurs requête/confirmation après succès et échec incertain. `npm run test:media:refresh` pilote réellement un `MediaPlayer` Windows via le bridge de production recompilé, puis vérifie le composant Vue. Le test backend refuse cible absente, autre source, ambiguïté et capacité retirée avant tout effet. |
| Titre, lecture/pause et capacités se mettent à jour sans clic | Le lecteur natif change ses capacités play/pause avec son état ; ces changements et le titre après Next sont observés dans Vue. Le test déterministe vérifie aussi les motifs, le retour d’erreur, les capacités inconnues et la réapparition de la session. |
| Aucune commande redirigée après disparition | Tests d’un handler conservé après disparition de session/retrait d’application, choix explicite du second lecteur, et revalidation backend. Le contrôle natif refuse tout marqueur perdu, source préexistante ou ambiguë ; aucune session personnelle commandée. |
| Navigation/réponses inversées sans ancien état ni boucle de charge | Promesses contrôlées : changement répété de lecteur pendant un appel, réponse ancienne après remontage, doublons manuels, arrière-plan/masquage/verrouillage, nettoyage des listeners et timers. Nombre exact d’appels/minuteries et délais 5/10/20/30 s vérifiés. |

## Contrôles réellement exécutés

Windows x64, Node 24.21.0, npm 11.19.0 ; Rust/MSVC x86_64.
Les traces locales ci-dessous sont dans `artifacts/autonomy/`. Les fixtures nécessaires
sont versionnées ; aucun test ne dépend des résultats de l’audit non suivis.

| Commande / contrôle | Résultat |
| --- | --- |
| `npm test` | 312/312, zéro échec/ignoré ; `pam25-npm-test-final.log`. Neuf régressions ajoutées, assertions antérieures conservées. |
| `node --test tests/media-refresh.test.mjs` | 9/9 ; `pam25-targeted-final.log`. |
| `npm run build` | Réussi avec 64 entrées strictement identiques dans la copie de dépendances Windows ; `pam25-build-final.log`, `pam25-build-inputs.json`. |
| `npm run test:media:commands` | Needle réel, 65 contrôles corrects ; effets simulés, aucun lecteur personnel ; `pam25-media-commands.log`. |
| `cargo build --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc --example media` | Réussi sur les sources courantes ; deux avertissements dead_code préexistants de la bibliothèque, `pam25-native-build.log`. |
| Build verrouillé du lecteur autonome | Réussi ; `pam25-player-build-final.log`. Son propre manifeste/lock n’ajoutent aucune dépendance à PAM. |
| `npm run test:media:refresh` | Quatre contrôles GSMTC réels réussis, répétés sur le lecteur natif ; pause/capacités, lecture, titre par polling et retour au premier plan ; `pam25-native-final.log`, `pam25-native-results.json`. Processus arrêté et répertoire jetable supprimé. |
| Cargo fmt, Clippy `--all-targets -- -D warnings`, cargo test de la fixture avec `--locked` | Réussis ; `pam25-player-clippy.log`, `pam25-player-tests.log`. Cargo test ne contient aucun test unitaire Rust ; les quatre contrôles sont dans l’intégration Node ci-dessus. |
| `node scripts/test-modals.mjs --proposals-only` | 22/22 dans WebView2 Edge 155 ; `pam25-webview-proposals.log`. Services natifs de ce parcours simulés. |
| Lint, format et contrôles spécifiques du composant | Réussis avec les mêmes sources Windows ; `pam25-lint-final.log`, `pam25-component-lint-final.log`, `pam25-format-final.log`, `pam25-specific-format.log`. |
| Diff, empreintes, base/prérequis et nettoyage | `git diff --check` réussi ; recontrôlés avant commit et clôture. |

Le build racine a d’abord refusé les node_modules Linux préexistants :
`pam25-build-root.log`. Ils sont préservés. Le build Windows compare chaque entrée
par octets et SHA-256. Un lancement ESLint depuis la racine n’a pas résolu ses
dépendances ; le contrôle du composant dans cette copie Windows a ensuite réussi.
Cargo n’est pas dans le PATH initial ; le build courant utilise la chaîne MSVC/Rust
locale isolée, sans installation ni changement de permissions.

Les premiers tests ciblés ont détecté une attente de rendu manquante dans une fixture
puis un refresh redondant réel dû à la comparaison d’un tableau nouvellement créé.
L’attente a été ajoutée et le watcher utilise désormais des sources distinctes ;
les tests finaux ci-dessus prouvent le correctif.

Une première fixture navigateur a réussi deux fois, mais n’a ensuite plus publié sa
session malgré une lecture HTML active (`pam25-native-built.log`,
`pam25-native-current.log`, `pam25-native-signal.log`). Elle n’est pas livrée.
Le lecteur `MediaPlayer` dédié l’a remplacée et a réussi avec l’auxiliaire fraîchement
compilé. Le premier nettoyage Edge a nécessité l’arrêt vérifié de son seul arbre
de processus au profil jetable ; tous ces profils/processus ont été supprimés.

## Fichiers et limites

Fichiers fonctionnels : `MediaControls.vue`, `useMediaSessions.ts`.
Tests et outillage : renderer Vue partagé, neuf tests média, script GSMTC, fixture
Rust autonome et son lock/README, script npm. Documentation : ce document et
`docs/application-modules.md`.

Le composant est exécuté en renderer mémoire pour le test GSMTC ; focus/visibilité
et écoulement des cinq secondes sont simulés. Les métadonnées, capacités et commandes
GSMTC du lecteur natif sont réelles. Le parcours de confirmation est aussi testé
séparément dans WebView2 ; aucun comportement de tous les lecteurs, son audible,
microphone, paquet portable/NSIS ou signature n’est revendiqué. Les propriétés
GSMTC absentes restent inconnues. Aucune dépendance de production, validation native,
permission, application personnelle ou fichier du protocole autonome n’est modifié.
