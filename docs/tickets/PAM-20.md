# PAM-20 — Suppression avec confirmation du périmètre

Ticket : https://app.notion.com/p/3f7b3e0422a48197babcc4f0f2bba8ad

Run `c6124deb-00ca-405c-94f8-dd71183eebb3`, worker
`01a14288-40d0-7ed2-b649-03cbb222db95`, génération 21.
Base `45266c237e5e31de300024d328b8952c1ec1aa86`, branche
`codex/deezer-routing`. Autorisation humaine d’origine, relais nominatif,
checkout/index propres et empreintes de contrôle vérifiés à l’entrée.
PAM-17 est terminé dans Notion, avec preuve et commit intégrés.
Vérification effectuée par le worker implémenteur.

## Choix et comportement

Le contrat autorise annulation/restauration ou confirmation explicite. Le choix
retenu est la confirmation avant perte : la désactivation fréquente possède déjà
son interrupteur réversible, alors que la suppression retire définitivement
l’apprentissage. La confirmation reçoit le focus sur Annuler, se ferme avec
Échap/clic extérieur sans écrire et énumère les données concernées.

Pour une application : nom, description, cible, arguments, noms reconnus, nombre
et liste exacte des formulations, avec leurs actions. La fiche PAM et toutes
ses formulations sont supprimées ensemble par l’écriture atomique existante ;
l’application Windows reste installée. Pour une formulation : phrase, action
et application, avec conservation annoncée de la fiche et des autres formulations.

Le périmètre est un snapshot indépendant du profil réactif. Une empreinte SHA-256
canonique traverse les contrats TypeScript/Rust/Node et doit correspondre au
périmètre encore présent avant suppression. Une nouvelle formulation ou une
modification de la cible refuse la confirmation ancienne. Les autres fiches
peuvent évoluer sans être écrasées. Le contrôle de concurrence sur le fichier
complet continue de protéger l’écriture entre lecture et remplacement.

L’empreinte est optionnelle pour les anciens clients IPC version 1 ; l’interface
de production l’envoie systématiquement. Ce mécanisme lie la confirmation à son
contenu et ne remplace pas les validations natives.

Le handler réserve l’opération avant calcul de l’empreinte et attente IPC.
Double clic/double événement : une seule requête. Une erreur garde le périmètre
et le dialogue, bloque les nouvelles confirmations directes et demande annulation
et actualisation avant nouvel essai. Après envoi, l’annulation est indisponible
et explicitement annoncée ; une navigation/désinstallation du composant ignore
la réponse tardive sans rejouer l’effet. La navigation avertit qu’il faut vérifier
le résultat par actualisation. Le succès consomme la confirmation et annonce
le résultat. L’éditeur de formulation ferme seulement quand la disparition est
constatée dans le profil ; l’ouverture puis l’annulation ne le ferme plus.

Aucune restauration locale n’est proposée ; aucun identifiant n’est recréé,
fusionné ou réattribué. L’UX n’utilise pas la sauvegarde globale comme substitut.

## Critères et preuves

| Critère du contrat | Preuve |
| --- | --- |
| Clic accidentel sans destruction irréversible, périmètre visible | Snapshot exact, confirmation explicite avant toute requête ; tests Vue et contrôles WebView2 pour application, formulations et zéro formulation associée. |
| Annulation ou confirmation décrivant réellement la perte | Énumération des noms et formulations avec actions ; Annuler initial, Échap et restitution du focus testés dans WebView2 ; aucun appel delete avant confirmation. |
| Aucune formulation orpheline ou duplication | Suppression atomique de la fiche et de toutes ses références avec vrai sidecar et profil isolé ; suppression individuelle conservant les autres identités ; aucun chemin de restauration ni génération d’ID. |
| Échec, double clic, annulation tardive explicites | Huit régressions dans tests/deletion.test.mjs : erreur E/S réelle du magasin, échec UI sans nouvelle tentative aveugle, empreintes périmées, double confirmation, navigation/démontage et effet tardif ; WebView2 vérifie refus d’Échap après envoi. |

## Contrôles exécutés

Windows x64, Node 24.21.0, npm 11.19.0, WebView2 Edge 155,
cible Rust `x86_64-pc-windows-msvc`. Traces locales sous `artifacts/autonomy/`.

| Contrôle | Résultat |
| --- | --- |
| npm test | 288/288, aucun échec/ignoré ; pam20-npm-test.log. Huit nouveaux tests, assertions antérieures conservées. |
| node --test tests/deletion.test.mjs | 8/8 ; pam20-deletion.log. Vrais composables, vrai sidecar et stockage isolé ; effets interdits. |
| npm run build | vue-tsc et Vite réussis sur copie Windows aux entrées identiques, même package-lock ; pam20-build.log et pam20-build-inputs.json. |
| npm run lint / npm run format:check | Réussis ; pam20-lint.log et pam20-format.log. |
| ESLint/Prettier des composants et helpers touchés | Réussis ; pam20-components-lint.log et pam20-components-format.log. |
| node scripts/generate-contracts.mjs --check | Réussi ; quatre fixtures de payload partagées valides/invalides ajoutées pour Node, navigateur et Rust. |
| npm run test:modals | 77 contrôles réussis, dont les 63 antérieurs ; pam20-modals.log. Clavier, focus, arbre d’accessibilité, confirmation, erreur, double clic et annulation tardive dans WebView2 réel. |
| cargo test --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc -- --test-threads=1 | 44/44 ; pam20-cargo-final.log. Deux avertissements préexistants de méthodes inutilisées hors process-tests. |
| cargo clippy --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc --features process-tests --all-targets -- -D warnings | Réussi sans avertissement ; pam20-clippy.log. |
| cargo fmt --manifest-path src-tauri/Cargo.toml --check | Réussi ; pam20-fmt.log. |
| Build natif process-tests et smoke-contracts | Pont Rust/Node de production reconstruit, profil et effet Node jetables ; empreinte transmise, refus périmé puis suppressions individuelle/application. Traces pam20-native-build.log et pam20-native-ipc.log. |
| git diff --check, empreintes, base et intégration | Vérifiés avant clôture ; reçu local PAM-20. |

Le build racine refuse le node_modules Linux préexistant (pam20-build-root.log),
préservé. Le build Windows équivalent est vérifié par comparaison des octets.
Les premiers passages ont détecté le type optionnel des formulations, le nouveau
module dans le chargeur de récupération et son placement hors ressources Tauri ;
ils sont corrigés avant les validations finales. Le helper Node est inclus dans
le répertoire assistant déjà distribué ; les tests de fermeture transitive et de
démarrage d’un arbre déployé passent. Le premier cargo test a rencontré un verrou
sur l’hôte WebView2 ouvert ; la relance après sa fermeture passe intégralement.

## Fichiers et limites

App, useProfile, CommandAliases, DeleteConfirmationDialog, helper de périmètre
TypeScript et Node, dépôt de configuration, contrats et sorties générées,
configuration ESLint, tests de suppression/contrats, chargeur de récupération,
fixtures et scripts WebView2/IPC, documentation des modules et du contrat.

WebView2 simule les services natifs ; le smoke IPC utilise réellement le pont Rust
et Node avec un profil temporaire et un exécutable de test. Aucun microphone,
lecteur personnel, paquet portable/NSIS, signature ou restauration après
confirmation n’est revendiqué. Aucun changement de dépendance. Aucun push,
publication ou commande d’application personnelle. Processus et profils de test
arrêtés/nettoyés avant clôture.
