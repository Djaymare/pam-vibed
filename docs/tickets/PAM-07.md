# PAM-07 — Contrastes, petits textes et focus

Ticket : https://app.notion.com/p/3f7b3e0422a481b29ebdd1d49dffec06

Run `c6124deb-00ca-405c-94f8-dd71183eebb3`, worker
`01a1319b-699c-7e62-b089-4ff91aac86e4`, génération 8. Base :
`622d9aad6f99069709e92fee4af8217586eb8b6f`, branche `codex/deezer-routing`.
Contrat complet relu dans Notion, sans prérequis bloquant. Les vérifications
ci-dessous sont celles du worker qui a réalisé le changement.

## Changement et inventaire

Les couleurs de texte de `style.css`, `CommandAliases.vue` et
`CommandArguments.vue` utilisent les tokens texte, secondaire, accent, succès,
erreur et attente. Cela couvre navigation, aides, placeholders, chemins,
formulations, paramètres, détails, messages, badges et états de runtime.
Les textes auparavant à 8–11 px sont portés à 12 px minimum ; les labels de
formulaire disposent d'un token à 13 px et le corps reste à 14 px.
Les titres et la structure visuelle générale sont conservés.

Le focus utilise un contour de 3 px contrasté, y compris dans la recherche du
sélecteur. Boutons et summaries ont une cible d'au moins 32 px ; cases à cocher
24 px, interrupteurs 44 × 28 px. L'opacité de toute une carte d'application
désactivée est remplacée par un contour discontinu : ses textes et ses actions
encore disponibles restent lisibles. Au zoom, les groupes se replient, les
dialogues défilent et la navigation compacte conserve ses noms accessibles.

En couleurs forcées, les contrôles utilisent ButtonText/GrayText, le focus
Highlight et les cartes/états CanvasText. La navigation sélectionnée conserve
un contour et un soulignement. Les erreurs, attentes et réussites gardent leurs
libellés, icônes et messages explicites ; leur compréhension ne dépend pas de
la couleur. L'icône du microphone reste blanche sur l'accent ou l'erreur.

## Mesures rendues avant/après

Les mesures lisent les styles calculés dans Windows WebView2 et compositent
les arrière-plans des ancêtres. Les textes courants sont vérifiés à 4,5:1 ;
le seuil de 3:1 ne s'applique qu'aux grands textes admissibles. Les icônes des
contrôles actifs et les contours de focus sont vérifiés à 3:1.

| Exemple réellement rendu | Avant | Après | Taille avant → après |
| --- | --- | --- | --- |
| Facultatif, formulaire | 2,15:1 | 6,24:1 | 9 → 12 px |
| Texte secondaire, session | 2,63:1 | 5,87:1 | 11 → 12 px |
| Action de réduction dans le tray | 3,51:1 | 6,54:1 | 11 → 12 px |
| Badge « À valider » | 2,72:1 | 6,60:1 | 9 → 12 px |

Avant : 21 états et 1 614 occurrences de texte, dont 1 376 échouent au contraste
ou au minimum de taille choisi. Après : 105 états principaux et 55 complémentaires,
10 665 occurrences de texte, aucun échec ; ratio minimal de texte 5,15:1.
Ces nombres incluent les mêmes textes présents dans plusieurs vues, pas autant
de textes uniques. Toutes les cibles actives mesurées atteignent 24 × 24 px :
aucune exception d'espacement n'est nécessaire dans ces vues.

Les contrôles réellement désactivés sont exclus des seuils de contraste et de
cible, conformément aux exceptions normatives. Les textes d'une application
désactivée ne sont pas exclus, puisque sa modification reste possible. Les
placeholders vides sont inclus. Les petits libellés masqués par la navigation
compacte ne sont pas du texte visuellement rendu ; les boutons conservent
leur nom accessible. Aucune exemption de texte actif n'a été ajoutée.

## Preuves des critères

| Critère | Preuve exécutée |
| --- | --- |
| Tous les états actifs, zoom, focus et contraste élevé | Vrais App et composants Vue montés dans l'hôte Tauri/WebView2 jetable. Matrice 1180 × 820, minimum natif 780 × 620, zoom natif WebView2 200 % au minimum (viewport 390 × 310), couleurs forcées claires au minimum et sombres au zoom 200 %. Mesures et captures dans chaque mode. |
| Textes actifs à 4,5:1 ou seuil de grand texte applicable | `tests/contrast-audit.js` mesure chaque texte rendu, les placeholders et les fonds composités. Les deux suites natives échouent sur une occurrence non conforme. Minimum observé après correction : 5,15:1. |
| Erreur, attente et succès sans couleur seule | Sept statuts d'activité et leurs résultats, runtime indisponible, erreurs de demande/session/découverte/formulaire, attente de traitement et de découverte, attente/refus/activité de microphone simulé, tests de lancement réussi/échoué, confirmation et résultat de récupération simulée. Les messages/badges gardent leur texte explicite et leurs icônes. |
| Focus visible et accès aux contenus/actions au zoom | Tab parcourt plus de contrôles que le document n'en contient, dans assistant, sélecteur, éditeur, formulations et récupération. Chaque focus actif a un contour visible contrasté et un rectangle entièrement dans le viewport après défilement. Aucun débordement horizontal des vues. Régressions de Tab/Maj+Tab, Échap, inertie du fond et restitution : 41 contrôles de la suite modale existante. |

La couverture inclut Assistant et historique vide/rempli, Applications vides/
remplies/désactivées, Préférences et formulations, toutes les variantes de
paramètres Deezer, contrôles média développés et sessions ambiguës, les trois
dialogues avec erreurs et les états de récupération de profil.

## Validation et reproduction

Windows x64, Node 24.21.0, npm 11.19.0, Rust/Cargo 1.99.0/MSVC,
WebView2 154.0.4258.62. Les fixtures sont suivies dans le dépôt ; elles ne
dépendent pas d'un artefact d'audit antérieur. Le microphone, le sidecar,
les lecteurs, les fichiers de profil et les lancements d'applications sont
simulés. Seuls l'hôte de test, le DOM, le rendu et le clavier sont natifs.

| Commande | Résultat | Journal local |
| --- | --- | --- |
| `npm test` | 0 ; 164 réussis, aucun échec/ignoré | `artifacts/autonomy/pam07-npm-test.log` |
| `npm run build`, checkout Windows isolé existant | 0 ; vue-tsc et Vite | `artifacts/autonomy/pam07-build.log` |
| `npm run test:contrast` | 0 ; 105 états | `artifacts/autonomy/pam07-contrast.log` |
| `npm run test:contrast -- --extra` | 0 ; 55 états | `artifacts/autonomy/pam07-contrast-extra.log` |
| `npm run test:modals` | 0 ; 41 contrôles natifs | `artifacts/autonomy/pam07-modals.log` |
| `cargo test --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc` | 0 ; 15 tests réussis | `artifacts/autonomy/pam07-cargo-test.log` |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc --all-targets -- -D warnings` | 0 | `artifacts/autonomy/pam07-clippy.log` |
| `rustfmt --check --edition 2021 src-tauri/examples/modal-test-host.rs` | 0 | `artifacts/autonomy/pam07-format.log` |
| `npm run test:modals:build` | 0 ; hôte final compilé | `artifacts/autonomy/pam07-host-build.log` |
| `git diff --check` | 0 | Chat/reçu |

Les 22 entrées de build du checkout isolé sont comparées aux sources livrées,
après normalisation des fins de ligne : `artifacts/autonomy/pam07-build-inputs.json`.
Les dépendances Linux préexistantes de la racine restent préservées.

```powershell
npm run test:modals:build
$env:PAM_MODAL_TEST_HOST = "$PWD\src-tauri\target\x86_64-pc-windows-msvc\debug\examples\modal-test-host.exe"
npm run test:contrast
npm run test:contrast -- --extra
npm run test:modals
```

Adapter le chemin de l'hôte à CARGO_TARGET_DIR. `PAM_TEST_DEPENDENCY_ROOT`
permet de réutiliser des dépendances Windows isolées. Les rapports JSON et
captures se trouvent dans `artifacts/pam07/` (ignoré par Git). Les captures
de l'éditeur, du sélecteur au zoom, de l'erreur en contraste clair, des
préférences en contraste sombre et du microphone actif ont été inspectées.
La capture utilise la surface visible native ; le défilement au clavier
vérifie les actions situées plus bas dans les vues.

## Limites et références

Le contraste élevé est activé dans le vrai WebView2 Windows via l'émulation
DevTools des couleurs forcées et des palettes claire/sombre, méthode de test
[documentée par Microsoft](https://blogs.windows.com/msedgedev/2024/04/29/deprecating-ms-high-contrast/).
Le thème personnel Windows n'est pas modifié. Les palettes personnalisées,
un lecteur d'écran externe et un paquet installé ne sont pas revendiqués.
Le zoom et les dimensions sont réglés par l'API native du seul hôte jetable,
sans commande IPC ou permission ajoutée à PAM.

Un premier lancement sandboxé a échoué avec EPERM. L'hôte emprunté avait été
relié sans Common Controls v6 ; sa reconstruction avec le script existant
a permis les exécutions natives. L'avertissement d'icône de ressource de cet
hôte subsiste ; les chargements et contrôles passent. Les essais intermédiaires
ont aussi corrigé la mesure du focus (surface à l'extérieur du contrôle), le
contraste du microphone et le cadrage CDP au zoom natif.

Références : [WCAG contraste minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html),
[taille des cibles](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).
Fichiers : style.css, App.vue, CommandAliases.vue, CommandArguments.vue,
package.json, exemple Rust de l'hôte, test-contrast.mjs, contrast-audit.js,
quatre fixtures contrast et cette preuve. Aucun fichier de contrôle du
dispositif modifié et aucun test neutralisé.
