# PAM-06 — Dialogues utilisables au clavier

Ticket : https://app.notion.com/p/3f7b3e0422a48107853ad37baa6c820c

Run `c6124deb-00ca-405c-94f8-dd71183eebb3`, worker
`01a13185-cde2-7720-b866-0aa3278761e9`, génération 7. Base :
`1210cf04b0bdb89391a7082c3cd14c2e722d400b`, branche `codex/deezer-routing`.
Contrat Notion complet relu, aucun prérequis bloquant. Cette vérification est
celle du worker qui a réalisé le changement.

## Comportement livré

`ModalDialog.vue` est utilisé par le sélecteur d’applications, l’éditeur et la
correction. Le dialogue HTML ouvert par `showModal()` appartient à la couche
modale native : le reste du document devient inerte, y compris pour un appel
de focus depuis le code. Les titres existants donnent les noms accessibles.
Le focus initial va à la recherche, au nom de l’application ou au texte corrigé.
Tab/Maj+Tab parcourent les contrôles visibles et disponibles et bouclent aux
extrémités. Les contrôles désactivés, cachés et les contenus de détails repliés
sont exclus. Un dialogue sans contrôle disponible garde le focus sur son
conteneur ; une mutation qui retire ou désactive le contrôle focalisé replace
le focus dans le dialogue.

Échap, clic hors du rectangle du dialogue et boutons explicites demandent une
fermeture au parent. `closeDisabled` bloque ces demandes pendant l’opération.
Le parent peut aussi intercepter la demande pour protéger un brouillon (PAM-19).
À la fermeture, le déclencheur encore disponible reprend le focus ; sinon la
navigation courante sert de repli. Le passage sélecteur → éditeur conserve le
déclencheur d’origine. La correction ferme sa fenêtre après la fin de son
opération asynchrone, lorsque ce déclencheur est réactivé.

Le [pattern WAI-ARIA](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
a servi de référence. La modalité, la navigation et le nom accessibles ont été
contrôlés dans WebView2, au-delà de la seule présence de `aria-modal`.

## Preuves des critères

| Critère | Preuve exécutée |
| --- | --- |
| Ajout, édition et correction entièrement au clavier, fond inaccessible et focus conservé après fermeture | `npm run test:modals` monte le vrai App et ses composants dans Windows WebView2. Événements clavier via CDP, sélection installée et manuelle, ajout, édition et correction réussis avec services simulés. Retour au bouton d’ajout, au bouton Modifier dont le libellé change, et au bouton de correction. Une tentative de focus du fond reste dans le dialogue. |
| Tab et Maj+Tab restent dans la modale | 30 Tab puis 30 Maj+Tab dans le composant et dans chaque parcours, après les erreurs aussi ; contrôle de l’appartenance du focus à chaque touche. Boucles premier/dernier, contrôles cachés/désactivés, détails repliés et zéro contrôle disponible testés. |
| Focus initial pertinent et restitution après chaque fermeture | Recherche/nom/texte vérifiés. Échap, fermeture explicite, clic extérieur, interception par le parent, blocage pendant busy et repli après suppression du déclencheur testés. Transition sélecteur → éditeur vérifiée. |
| Trois parcours au clavier, y compris après erreur de formulaire | Ajout avec validation native des champs requis puis premier enregistrement refusé par le service simulé, nouvelle soumission réussie ; édition enregistrée ; correction vide non soumissible puis premier appel refusé, nouvelle soumission réussie. Focus et boucle conservés après erreurs. Le sélecteur, sans formulaire soumis, permet sélection installée et choix manuel au clavier. |

La suite native contient 41 contrôles réussis, dont les régressions ciblées du
composant et cinq contrôles de rôle/nom `dialog` dans l’arbre d’accessibilité
WebView2 : composant, sélecteur, nouvelle application, modification, correction.
Les fixtures sont suivies dans `tests/fixtures/modal-*`, sans dépendance aux
anciens artefacts d’audit.

## Validation et reproduction

Windows x64, Node 24.21.0, npm 11.19.0, Rust/Cargo 1.99.0/MSVC,
WebView2 154.0.4258.62 (UA Edge 154). Aucun lecteur ou exécutable personnel lancé.

| Commande | Résultat | Journal local |
| --- | --- | --- |
| `npm test` | 0 ; 164 réussis, aucun échec/ignoré | `artifacts/autonomy/pam06-npm-test.log` |
| `npm run build` dans le checkout Windows isolé existant PAM-34 | 0 ; vue-tsc et Vite | `artifacts/autonomy/pam06-windows-build.log` |
| `npm run test:modals:build` | 0 ; hôte Windows compilé avec manifeste Common Controls v6 | `artifacts/autonomy/pam06-webview-host-build.log` |
| `npm run test:modals` | 0 ; 41 contrôles composant et parcours dans WebView2 | `artifacts/autonomy/pam06-modals.log` |
| `cargo test --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc` | 0 ; 15 tests Rust réussis, aucun ignoré | `artifacts/autonomy/pam06-cargo-test.log` |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc --all-targets -- -D warnings` | 0 | `artifacts/autonomy/pam06-clippy.log` |
| `rustfmt --check --edition 2021 src-tauri/examples/modal-test-host.rs` | 0 | `artifacts/autonomy/pam06-format.log` |
| `git diff --check` | 0 | Chat/reçu |

Le build à la racine refuse les dépendances Linux préexistantes ; elles restent
préservées. Le build Windows réutilise le checkout isolé existant et compare
ses 21 entrées de build aux sources livrées (fins de ligne normalisées). Un
premier appel sandboxé Vite a échoué avec `spawn EPERM` ; le build autorisé a
réellement réussi. L’hôte natif initial manquait du manifeste Common Controls
v6 et quittait avant navigation ; le script de build suivi ajoute ce manifeste.
Il émet encore un avertissement d’icône de ressource absente, sans empêcher le
chargement, les parcours ou l’arbre d’accessibilité. La capture de l’éditeur
initial `artifacts/autonomy/pam06-editor.png` a été inspectée.

Sur un checkout Windows avec ses outils installés :

```powershell
npm run test:modals:build
$env:PAM_MODAL_TEST_HOST = "$PWD\src-tauri\target\x86_64-pc-windows-msvc\debug\examples\modal-test-host.exe"
npm run test:modals
```

Adapter le chemin si `CARGO_TARGET_DIR` est configuré. Le test accepte
`PAM_TEST_DEPENDENCY_ROOT` pour réutiliser des dépendances Windows isolées,
comme lors de cette validation. Il crée un profil WebView2 temporaire, arrête
son hôte et son serveur puis supprime uniquement ce profil identifié.

## Fichiers et limites

Modifiés : App.vue, ApplicationPicker.vue, style.css, package.json.
Ajoutés : ModalDialog.vue, scripts de build/test des modales, exemple Rust
`modal-test-host.rs`, trois fixtures frontend et cette preuve.

L’hôte jetable utilise Tauri/WebView2 avec les vrais composants Vue ; il ne
démarre ni sidecar, ni tray, ni raccourci global. Les services Tauri sont
simulés pour éviter les effets externes. La validation ne revendique pas un
paquet installé ou une lecture avec un lecteur d’écran externe. Les routines
de focus utilisent le vrai DOM et l’arbre d’accessibilité WebView2. Aucune
validation requise du contrat n’est remplacée par une lecture de code.
La confirmation de récupération de profil de PAM-05 reste hors des trois
dialogues visés. Aucun fichier de protocole modifié et aucun test neutralisé.
