# PAM-40 — Déclarer des permissions Tauri plus fines

Ticket : https://app.notion.com/p/3f7b3e0422a4817fb43fe2dadcf64449

Consolidation manuelle demandée dans le chat
`01a15e55-d265-7030-8b45-c7b5474a75c0` : le 21 octobre, l'utilisateur précise
« Aucun ajout précis, il s'agissait de consolider l'application avant d'ajouter
de nouvelles features », puis demande « reprends » le 22 octobre 2026.
Cette reprise poursuit le périmètre préventif de main existante. Aucune extension
d'accès planifiée n'est inventée, aucune condition du manifeste autonome modifiée.
Le chat reste extérieur à la chaîne ; ni acquisition de relais, ni automation,
ni successeur. L'état du run arrêté et ses fichiers de contrôle restent intacts.

Base : `1fc7faf034b19ad60f16b0fa10e9df18e4c94fc8`, branche
`codex/deezer-routing`, index et checkout propres à l'entrée. PAM-13 et PAM-31
relus intégralement dans Notion, tous deux Terminé et livraisons intégrées.
Ancêtres vérifiés : `ed7a2ac1962e964cd939caf75e026fe6d06ecfb8` et
`e4c0002673daa684c34d78fe32634b5b2c5912ae`. L'API GitHub confirme les deux jobs
Windows réussis de PAM-31, run 39606909360, SHA `8c57384` ; le job Linux annulé
n'est pas présenté comme réussi. Vérification effectuée par l'implémenteur.

## Changement

`build.rs` déclare assistant_request dans AppManifest, activant l'ACL des commandes
applicatives. Sa permission générée n'est accordée qu'à la webview locale main.
La liste active de capabilities est explicite. core:default devient les deux
permissions d'écoute/retrait des événements ; dialog.open est conservé. Windows
est vide, webviews vaut main : Tauri additionne ces deux listes. La garde Rust
de fenêtre, la CSP, les 26 méthodes et leurs validateurs sont conservés.

L'inventaire et la procédure d'ajout de commande sont dans
`docs/tauri-permissions.md`. Audit des .exe/arguments manuels, cibles du catalogue,
bridge inverse et routes deezer/dzr documenté ; aucun élargissement des protocoles
ni changement des validations, confirmations, budgets ou lancements sans shell.

Le handler IPC de production est réutilisé par un exemple derrière process-tests
et custom-protocol. Trois vraies WebView2 utilisent une page minimale, les grants
et le contexte Tauri de production. Le backend est volontairement indisponible,
la préférence de raccourci a un double et aucun tray n'est initialisé. Une commande
témoin ajoutée au handler sans permission doit rester inaccessible. La suite est
ajoutée au job native existant, avec préparation des assets locaux ; ses rapports
se trouvent sous le dossier de diagnostics WebView2 déjà collecté par la CI.

## Critères et preuves

| Critère | Résultat observé |
| --- | --- |
| Refus établis selon fenêtre/origine | 117 contrôles réels WebView2 : autre fenêtre locale, origine HTTP de boucle locale, puis main naviguée vers HTTP ; refus par l'ACL native, distingué d'une erreur de payload. |
| Commandes sensibles inaccessibles depuis un contexte non autorisé | Les 26 méthodes sont refusées avant décodage depuis l'autre fenêtre et HTTP ; main distante refuse aussi assistant_request, écoute et dialogue. Émission d'événements, création de fenêtre, raccourcis JS et dialog.save refusés dans les trois contextes. |
| Parcours autorisés avec droits minimaux | Superviseur, lecture du raccourci, actions listening/idle/hide ; réception d'un événement Rust puis retrait effectif du listener. Les 26 méthodes locales atteignent leur vrai validateur de payload. Le plugin dialog réel admet l'appel puis rejette l'argument invalide. Après retour de main à son origine locale, l'IPC fonctionne à nouveau. |
| Régression pour une nouvelle commande trop exposée | Commande témoin permission_canary refusée par Tauri, même depuis main ; test de politique refusant commande ajoutée sans examen, wildcard, grant de fenêtre main entier, origine distante, core:default et raccourcis JS. Le test sur le dépôt initial échouait : AppManifest absent. |

## Contrôles exécutés

Windows x64, Node 24.21.0/npm 11.19.0, Rust/MSVC 1.99.0 et toolchain préparée
par PAM-34. Sources du checkout courant, Cargo.lock conservé. Les journaux sont
locaux sous `artifacts/autonomy/` ; toutes les fixtures nécessaires sont suivies.

| Contrôle | Résultat | Journal |
| --- | --- | --- |
| Régression ciblée avant correction | Code 1 attendu, manifeste applicatif absent | Sortie du chat avant édition |
| Tests politique Tauri et barrière CI | 22 réussis, zéro échec/ignoré | pam40-policy-final.log |
| npm test | 470 réussis, zéro échec/ignoré | pam40-npm-test-delivery.log |
| npm run build | vue-tsc et Vite réussis, dépendances Windows du checkout | pam40-build.log |
| cargo test --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc | 57 réussis, zéro échec/ignoré | pam40-test.log |
| cargo clippy, même manifeste/cible, --locked --all-targets --all-features -- -D warnings | Réussi sans avertissement | pam40-clippy.log |
| cargo fmt --manifest-path src-tauri/Cargo.toml --check | Réussi | pam40-fmt.log |
| npm run test:permissions:build, MSVC/Common Controls v6 | Réussi | pam40-host.log |
| npm run test:permissions | 117 contrôles WebView2 réussis ; hôte/serveur terminés et profil supprimé | pam40-webview.log, pam40-webview/report.json |
| Tauri CLI build --no-bundle --target x86_64-pc-windows-msvc --config avec beforeBuildCommand vide -- --locked, après le build front | Release optimisée réussie | pam40-tauri.log |
| npm run lint, format:check, check:workflows et prettier des nouveaux scripts/tests | Réussis | pam40-lint.log, pam40-workflows.log et sorties du chat |

Le premier npm test était 469/470 : Windows PowerShell 5.1 refusait son script
de signature sous sa politique par défaut. RemoteSigned limité au processus a
permis son exécution, puis révélé une collision de modules hérités de PowerShell 7
(Get-FileHash absent). Le chemin des modules Windows a été placé en premier
uniquement pour le processus de test. Le contrôle signature ciblé puis la suite
complète réussissent ; aucune politique persistante, signature ou test modifié
pour masquer l'échec. Les tentatives initiales restent conservées dans les logs.

## Limites et fichiers

Le banc vérifie l'admission du sélecteur par son désérialiseur, pas le clic dans
le dialogue système. Les effets d'assistant et l'enregistrement global du
raccourci ne sont pas exécutés par ce banc ; leurs tests existants restent actifs.
L'avertissement d'icône de l'exemple sans ressources Windows est distinct du
binaire de production construit par Tauri. Aucune application personnelle,
capture microphone, exploitation distante antérieure, paquet NSIS, signature ou
nouvelle exécution CI hébergée revendiqué. Aucun push ni publication.

Fichiers de production : build.rs, capability default, sélection des capabilities
dans tauri.conf.json et factorisation du handler dans lib.rs. Tests : garde de
host.rs, exemple/fixture natifs feature-gated, tests de politique, runner/build
WebView2, scripts npm et intégration native CI. Documentation : inventaire des
permissions, IPC, tests natifs et cette preuve. Aucun changement d'AGENTS.md,
d'AGENT.md, de docs/autonomy ou d'état du run.
