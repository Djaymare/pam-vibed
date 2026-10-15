# PAM-18 — Centraliser les définitions d’actions et capacités

Ticket : https://app.notion.com/p/3f7b3e0422a481cab17ed22b46135dc2

Run `c6124deb-00ca-405c-94f8-dd71183eebb3`, worker
`01a1417d-1dba-7d00-af3e-93269e5688b1`, génération 19.
Base : `13d319207d5002053a7f85693d41b75859d65337`, branche
`codex/deezer-routing`. Autorisation humaine d’origine vérifiée dans le chat
de lancement ; relais nominatif, empreintes et index vérifiés avant écriture.
PAM-13 relu dans Notion à Terminé, avec sa livraison intégrée vérifiée.

## Contrat et réalisation

Le ticket demande un registre des identifiants, paramètres, libellés, prérequis,
effets attendus et corrections, utilisé entre Vue et Node, avec une validation
native indépendante et un contrôle de concordance. Aucun protocole, page ou
effet Deezer supplémentaire n’est ajouté.

`sidecar/action-registry.json` décrit les 13 actions, huit pages, sept types de
contenu, deux mixes et deux modes de sélection. Node produit ses outils et
valide ses paramètres depuis ce registre. Vue utilise une sortie générée pour
les choix, libellés, options, champs de correction et limites de saisie. L’enum
IPC CommandAction est dérivé automatiquement ; sa valeur reste identique.
Les métadonnées des outils et déclencheurs existants sont conservées dans le
registre. Les formulaires ne recopient plus les options ni les schémas.

Le natif garde ses listes et ses validations de structure indépendantes. Une
requête média avec une action ou route inconnue est refusée avant COM, lecture
des sessions ou lancement. Aucun repli vers le lecteur courant n’est ajouté.
La distinction capacité théorique / capacité disponible et la procédure d’ajout
sont détaillées dans `docs/action-registry.md`.

## Critères et preuves

| Critère | Preuve exécutée |
| --- | --- |
| Ajouter une page/action ne demande plus plusieurs listes manuelles susceptibles de diverger ; test front/routage/routes autorisées | Génération unique du catalogue Vue et de CommandAction. Catalogue Node et schémas depuis le registre. Tests des choix Vue, outils, alias de pages/contenus et corpus de 22 URI ; comparaison exacte aux listes Rust. |
| Une nouvelle action ne nécessite pas de recopier plusieurs listes sans contrôle | Choix et champs génériques, enums résolues depuis les options, génération vérifiée dans npm test ; la frontière native demeure indépendante et toute divergence fait échouer les tests. Documentation des adaptations métier et de la revue native nécessaires. |
| Action ou route inconnue refusée côté natif même envoyée par l’UI | Test Rust unknown_ui_actions_and_routes_fail_before_native_services : méthode inconnue, action inconnue, __proto__ et flushCache refusés par le point d’entrée de production avant services natifs. Tests IPC existants et validation Node conservés ; paramètres hostiles et media_toString refusés sans appel d’adaptateur. |
| Un test signale toute divergence entre front, routage et routes Windows | Tests de concordance des catalogues, paramètres, capacités et options ; mutations page, contenu, action, protocole et liste native ; génération --check ; tests Rust des listes indépendantes, du corpus et des limites des identifiants/URI. |

Les tests Vue montent les composants de production avec le renderer mémoire.
Ils vérifient les champs, valeurs par défaut, enums, bornes et événements de
correction, ainsi que l’activation du seul bouton correspondant à une capacité
vivante. Catalogue théorique, session absente, session ambiguë et session en
erreur sont distingués. Les ressources Tauri et le vérificateur de bundle sont
testés pour l’inclusion des deux nouveaux fichiers sidecar.

## Validations

Windows x64, Node 24.21.0, npm 11.19.0, cible Rust x86_64-pc-windows-msvc.
Traces locales dans `artifacts/autonomy/` ; aucune fixture suivie ne dépend de
ce répertoire.

| Commande | Résultat et trace |
| --- | --- |
| npm test | 272/272, aucun échec/ignoré ; pam18-npm-test.log. Les 265 tests initiaux sont conservés et sept sont ajoutés. |
| npm run build | vue-tsc et Vite réussis dans la copie Windows, 97 entrées vérifiées octet pour octet ; pam18-build.log, pam18-build-inputs.json. |
| npm run test:deezer:routing | 48 contrôles avec Needle réel réussis ; pam18-deezer.log. Effets simulés. |
| npm run test:media:commands | 65 contrôles avec Needle réel réussis ; pam18-media.log. Effets simulés. |
| cargo test --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc --features process-tests -- --test-threads=1 | 44/44, aucun échec/ignoré, dont les quatre tests de routes ; pam18-cargo-serial.log. |
| cargo clippy --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc --features process-tests --all-targets -- -D warnings | Réussi sans avertissement ; pam18-clippy-final.log. |
| cargo fmt --manifest-path src-tauri/Cargo.toml --check | Réussi ; pam18-rustfmt-final.log. |
| npm run lint, npm run format:check | Réussis dans la copie Windows avec les mêmes sources ; pam18-lint.log, pam18-format.log. |
| ESLint/Prettier des composants et actions touchés hors périmètre historique | Réussis ; pam18-components-lint.log, pam18-components-format.log. |
| node scripts/generate-contracts.mjs --check ; git diff --check | Réussis ; pam18-generation.log, pam18-diff-check.log. |

Le build racine est refusé par le contrôle de développement car son node_modules
est Linux ; il est préservé. Le build Windows équivalent utilise le même verrou.
La première compilation Vue a détecté une clé trop largement typée, corrigée
avant le build final. Les premiers essais de tests et Clippy ont conduit aux
corrections puis aux passages réussis ci-dessus ; aucun échec n’est compté comme
un succès.

Un passage parallèle de la suite Rust a réussi 44/44. Un second a échoué sur
l’assertion existante turns().is_empty() dans automatic_recovery_runs_real_cleanup_without_replaying_emitted_effect
(43/44, pam18-cargo-final.log). La suite complète relancée séquentiellement
passe 44/44 sans modifier ce test ni le superviseur. Cet échec intermittent est
conservé comme limite de la validation parallèle. Les tests ciblés des routes
passent aussi directement (pam18-rust-routes.log).

## Fichiers et limites

Fichiers de réalisation : registre JSON/CJS, generate-contracts,
check-action-registry, catalogue intent, formulations, deezer/deezer-commands,
media et needle-tools ; actions Vue et sortie générée, CommandArguments,
MediaControls ; media.rs et ressources Tauri ; verify-bundle ; tests de
concordance et corpus généré, fixture de copie des contrats et chargeur Vue ;
documentation du registre et cette preuve.

Les effets média sont simulés et aucun lecteur personnel n’est commandé.
Le validateur Windows de production est réellement exécuté par les tests Rust,
mais aucune lecture GSMTC personnelle ni ouverture Deezer n’est nécessaire.
Les tests de composants ne revendiquent pas de clics WebView2. Aucun paquet
portable/NSIS, signature ou déploiement n’est validé par ce ticket. Vérification
effectuée par le worker implémenteur. Aucun push ni publication.
