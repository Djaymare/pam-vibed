# PAM-13 — Contrats typés et versionnés

Ticket : https://app.notion.com/p/3f7b3e0422a481eb9eafdb109ecfd557

Run `c6124deb-00ca-405c-94f8-dd71183eebb3`, worker
`01a13d93-233c-7303-802e-b13b161c9d50`, génération 14.
Base : `b75a1fb142a600387ad0a17a8d7e26823985f17c`, branche
`codex/deezer-routing`. Contrat et prérequis PAM-03/PAM-10/PAM-12 relus dans
Notion ; leurs livraisons sont intégrées. Vérification par le worker implémenteur.

## Livraison

Source commune `sidecar/contracts.json`, types et unions discriminées TypeScript,
modèles/enums et appels/résultats discriminés Rust générés. Les anciens types
manuels réexportent le contrat ; PamError réutilise les champs et le catalogue
de PAM-12. Vue valide requêtes et réponses au lieu de supposer `invoke<T>` sûr.
Les 24 méthodes, y compris découverte et fenêtre, passent par la même enveloppe
Tauri. Rust admet uniquement les appels valides, puis partage son traitement
avec l’hôte de tests natifs. Node valide le transport et les payloads ; Rust
valide résultats, progression et demandes natives avant effet. L’inventaire et
le format sont documentés dans `docs/ipc-contracts.md`.

Version 1, id par tentative, requestId corrélable Vue/Rust/Node, UUID par effet
natif. Version incompatible refusée, réponse périmée écartée, aucune relance
automatique. Les validations natives, confirmations, empreintes, consommation
avant effet et échéances restent en place. Une interruption conserve les
résultats partiels. La disponibilité d’une cible et ses paramètres ne sont pas
déduits de la seule conformité au schéma.

## Critères et preuves

| Critère | Preuves exécutées |
| --- | --- |
| Méthode/payload invalides refusés, Turn/actions/erreurs concordants | Fixtures communes Node/navigateur/Rust ; modèles Rust réellement désérialisés ; tests TypeScript négatifs. `tests/ipc.test.mjs`, `sidecar/contracts.test.cjs`, `contracts::tests::shared_fixtures_conform_in_rust`. |
| Méthode inconnue, payload et version incompatibles avant effet | Vrai point d’entrée Node refusant sans profil/exécution ; `scripts/smoke-contracts.mjs` utilise le même traitement que la commande Tauri et vérifie le profil vide avant toute demande valide. Le bridge refuse une demande native contenant un champ interdit avant création du marqueur. |
| Changement non répercuté détecté | Génération `--check` dans npm test ; altération du schéma dans une copie jetable, refus de dérive confirmé ; tests négatifs de type de réponse et payload. |
| Résultats partiels, erreurs et propositions expirées identiques | Fixtures partial/expired/invalidated/consumed et erreurs dans les trois validateurs. Tests Rust timeout/EOF avec performed/unknown/not_started, retrait/réutilisation sans rejeu ; smoke natif configuration → préparation → confirmation → consumed et expiration simulée → expired, proposition inconnue et export diagnostic. |

Les tests de réponses périmées injectent mauvais id et requestId, puis une
réponse correcte : une seule requête et une seule émission. Les tests Rust
refusent version incompatible, résultat incomplet, erreur mal formée et requête
native invalide. L’effet éventuel du test natif est seulement un Node copié ou
le Node de test écrivant un marqueur jetable. Les anciens tests de pipe utilisent
maintenant des payloads et résultats conformes ; leurs assertions de délai,
ordre, saturation, arrêt, mort des enfants et non-rejeu sont conservées.

## Contrôles

Windows x64, Node 24.21.0, npm 11.19.0, Rust/MSVC 1.99.0 préparés par PAM-34.
Traces locales sous `artifacts/autonomy/` ; les fixtures nécessaires sont suivies.

| Contrôle | Résultat | Trace |
| --- | --- | --- |
| `npm test` | 235 réussis, aucun échec/ignoré | `pam13-test-final.log` |
| `npm run build` avec dépendances Windows isolées | Réussi, vue-tsc + Vite, 31 entrées identiques | `pam13-build-windows-final.log`, `pam13-build-inputs.json` |
| `cargo test --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc` | 24 réussis, aucun échec/ignoré | `pam13-cargo-final.log` |
| Clippy, même manifeste/cible, `--locked --all-targets -- -D warnings` | Réussi sans avertissement | `pam13-clippy-final.log` |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | Réussi | `pam13-format-check.log` |
| Build `--features process-tests`, puis smoke natif des contrats | Réussi, chemin de production Rust/Node | `pam13-native-build.log`, `pam13-native-contracts.log` |
| Catalogue et lancement de raccourci de test | Réussi, paramètres conservés, aucun modèle chargé pour le test de brouillon | `pam13-applications.log` |
| Disponibilité native, désactivation/réparation/réactivation | Réussi, cible absente refusée | `pam13-availability.log` |
| `npm run test:integration` | Whistle/Needle réels, Node jetable | `pam13-integration.log` |
| `npm run test:deezer:routing` | 48 contrôles corrects, effets simulés | `pam13-deezer.log` |
| `npm run test:media:commands` | 65 contrôles corrects, effets simulés | `pam13-media.log` |
| Génération et `git diff --check` | Réussis avant commit | Contrôle du worker |

Les premiers essais ont détecté des fixtures non versionnées, des payloads
libres, une ancienne assertion de message technique, des erreurs TypeScript
et des avertissements Clippy. Ils ont été corrigés, sans retirer les contrôles
d’effet. La première invocation du smoke de catalogue omettait son deuxième
argument ; l’invocation complète a réussi. Le test de cible absente vérifie
maintenant le code stable et le message de réparation, au lieu d’un détail
technique que PAM-12 masque.

Le build racine refuse le node_modules Linux préexistant (code 1,
`pam13-build-root.log`), préservé. Le build Windows emploie les mêmes sources,
manifestes et verrou de dépendances, comparés avant compilation. Aucun
node_modules étranger supprimé ou remplacé.

## Limites

Tests Vue dans un renderer mémoire et services natifs simulés ; le test IPC
natif exerce la fonction de production sans WebView2. Aucun parcours de clics
WebView2, paquet portable/NSIS ni signature revendiqué. Les deux ressources
de contrat sont déclarées dans Tauri et dans la vérification de paquet, sans
annoncer un paquet validé. Les auxiliaires média et moteurs conservent leurs
protocoles privés. Aucun programme personnel commandé ; profils, raccourcis
et marqueurs de test nettoyés. Aucun push, publication ou changement du protocole
autonome. La reprise de quota a conservé le même worker et le travail partiel.

Fichiers : schéma/validateurs/générateurs, sorties TS/Rust, client IPC Vue,
App et composants profil/média, bridge/hôte Rust et Node, ressources Tauri,
fixtures et tests de contrats/transport/profil, smokes natifs et vérification
du paquet, cette preuve et la documentation IPC. Le diff du commit fournit
la liste exhaustive.
