# Catalogue court des commandes

Depuis la racine du checkout propre à l'OS, avec les
[versions et dépendances requises](development.md#versions-communes-au-poste-à-docker-et-à-la-ci).
Les noms ci-dessous sont ceux de `package.json`. Chaque suite garde son rôle et
ses prérequis : une commande ciblée ne remplace aucun contrôle obligatoire.
Les tests peuvent créer des fixtures et des rapports ; « produit » désigne ici
un build, des ressources ou un paquet à distinguer du résultat d'un test.

| Besoin                                            | Commande exacte                                                                            | Plateforme, prérequis et effet                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| État du poste                                     | `npm run diagnose:environment` ou `node scripts/diagnose-environment.mjs`                  | Windows/Linux x64 documentés ; Node suffit pour l'invocation directe. Rapport informatif stdout en lecture seule, sans test ni fichier produit ; [limites ci-dessous](#diagnostic-en-lecture-seule).                                                                                                                                                                     |
| Compatibilité des dépendances avant développement | `npm run check:development`                                                                | Windows x64 / Linux x64 glibc, dépendances de cet OS. Charge réellement les deux bindings et vérifie le lanceur vue-tsc ; contrôle bloquant existant.                                                                                                                                                                                                                    |
| Front en développement                            | `npm run dev`                                                                              | Windows/Linux ; serveur Vite après `check:development`. Services natifs non lancés.                                                                                                                                                                                                                                                                                      |
| Desktop en développement                          | `npm run tauri dev`                                                                        | Windows x64, Rust/MSVC/SDK et WebView2. Lance PAM ; le hook utilise `npm run dev:desktop`, qui prépare le runtime et lance Vite. [Installation](development.md#clone-neuf-sous-windows).                                                                                                                                                                                 |
| Build front / aperçu                              | `npm run build` ; `npm run preview`                                                        | Windows/Linux ; build TypeScript/Vite dans `dist/`, puis serveur d'aperçu de ce build. Ce ne sont pas des tests natifs.                                                                                                                                                                                                                                                  |
| Contrôles rapides complets                        | `npm run ci:quick`                                                                         | Windows/Linux, dépendances de l'OS ; contrôles, tests Node/composants et **build front**, plus rapports `artifacts/ci/quick/`. [Ordre obligatoire](ci-quality.md#ordre-et-commandes).                                                                                                                                                                                    |
| Contrôles rapides ciblés                          | `npm run check:workflows` ; `npm run format:check` ; `npm run lint`                        | Windows/Linux ; contrôlent politique, format et ESLint sur les périmètres existants. `npm run format` **réécrit** les fichiers de son périmètre.                                                                                                                                                                                                                         |
| Tests Node sans modèles                           | `npm test`                                                                                 | Windows/Linux ; `sidecar/*.test.cjs` et `tests/*.test.mjs`, sans les intégrations natives. Les skips Windows sur Linux restent visibles.                                                                                                                                                                                                                                 |
| Tests Vue ciblés                                  | `npm run test:components`                                                                  | Windows/Linux ; renderer en mémoire, déjà inclus dans `npm test`. [Couverture et limites](frontend-tests.md#ce-que-chaque-niveau-vérifie).                                                                                                                                                                                                                               |
| Campagne Rust/WebView2 sans modèles               | `npm run ci:native`                                                                        | Windows x64, Node officiel épinglé, Rust/MSVC/SDK, WebView2 et historique Git complet. **Prépare et compile** les fixtures/hôtes, puis teste Rust, historique, WebView2, nettoyage et permissions ; écrit des rapports. [Détail](native-tests.md) et [ordre](ci-quality.md#ordre-et-commandes).                                                                          |
| Hôte WebView2 modal                               | `npm run test:modals:build`, puis `npm run test:webview` et `npm run test:webview:cleanup` | Windows x64 ; la première **compile** l'hôte, les deux autres testent. Définir `PAM_MODAL_TEST_HOST` selon [frontend-tests.md](frontend-tests.md#commandes-pour-le-développement-et-la-ci), même si le binaire existe au chemin habituel. `npm run test:modals` est l'alias existant de `test:webview`.                                                                  |
| Permissions Tauri réelles                         | `npm run build`, puis `npm run test:permissions:build`, puis `npm run test:permissions`    | Windows x64/WebView2 ; les deux premières **produisent** front et hôte, la dernière teste le handler/ACL. [Banc et paramètres](tauri-permissions.md).                                                                                                                                                                                                                    |
| Runtime Windows avec moteurs                      | `npm run prepare:runtime`                                                                  | Windows ou Linux pour préparer les ressources Windows ; **télécharge/copie/vérifie** modèles, DLL, Node et npm. Internet/espace requis au premier passage ; aucun test.                                                                                                                                                                                                  |
| Intégrations avec moteurs réels                   | `npm run ci:integration`                                                                   | Windows x64/Rust, ressources et capacité mémoire ; prépare le runtime puis tests Cargo `engine-integration`, `npm run test:integration:node`, `npm run test:integration`, `npm run test:confidence`, `npm run test:deezer:routing`, `npm run test:media:commands`. Suites distinctes et profils jetables ; [effets et limites](ci-quality.md#niveaux-de-test-et-effets). |
| Cargo ciblé et tests d'isolation/catalogue        | Commandes exactes de [native-tests.md](native-tests.md#intégrations-avec-moteurs-réels)    | Windows x64 ; compilation avec les features et arguments de fixtures documentés. `npm run test:processes` et `npm run test:applications` exigent les binaires de test appropriés ; [arguments applications](../README.md#développement).                                                                                                                                 |
| Construire et vérifier un portable                | `npm run build:portable`, puis `npm run package:portable`, puis `npm run verify:bundle`    | Windows x64/Rust/MSVC. Les deux premières **produisent** build/reçu puis publication locale du portable ; la dernière **teste** le paquet final, lance ses binaires/moteurs avec profil jetable et PATH vide. [Procédure](portable.md).                                                                                                                                  |
| Installeur Windows non signé                      | `npm run package:windows`                                                                  | Windows x64, outils de build et runtime ; **produit** NSIS. La configuration de signature n'est pas chargée automatiquement. [Diffusion et signature](windows-release.md).                                                                                                                                                                                               |
| Packaging de la CI                                | `npm run ci:package`                                                                       | Windows, après toutes les barrières et le rapport d'intégration valide du même SHA. **Construit/assemble**, vérifie le paquet final, produit provenance et ZIP ; [preuves requises](ci-quality.md#diagnostics-et-provenance).                                                                                                                                            |
| Conteneur Linux / paquet Windows                  | `npm run package:docker`                                                                   | À exécuter **dans** l'image de développement, avec cargo-xwin ; produit build Windows et portable. Commandes Docker hôte et extraction dans [development.md](development.md#linux-dans-docker-depuis-windows-ou-linux). Ne valide pas l'exécution native Windows.                                                                                                        |
| Préparer la configuration de signature            | `npm run signing:config`                                                                   | Poste Windows de signature provisionné et paramètres explicites ; **écrit** `artifacts/release/tauri.signing.json`, ne signe rien. [Prérequis](windows-release.md#configuration-de-signature-préparée).                                                                                                                                                                  |
| Vérifier une signature précise                    | `npm run signing:verify -- '<chemin absolu>' '<SHA256 attendu>' '<empreinte editeur>'`     | Windows, SignTool et hôte PowerShell approuvés ; fichier non exécuté, chaîne/révocation/horodatage réellement contrôlés. [Paramètres et limites](windows-release.md#vérification-native-des-fichiers-finaux).                                                                                                                                                            |
| Tests de signature natifs                         | `npm run test:signing:native`                                                              | Windows, SignTool signé et hashes/empreinte de fixture approuvés ; refuse les prérequis absents. Ne remplace pas la [matrice VM propre](windows-release.md#matrice-obligatoire-sur-vm-propre).                                                                                                                                                                           |

Pour les campagnes spécialisées, conserver leurs prérequis et effets :
[média/lecteurs réels](windows-media-deezer.md) (`test:media`, `test:media:players`,
`test:media:deezer`, `test:media:refresh`), [langues](languages.md) (`test:languages`),
[exécution](execution-policy.md) (`test:execution`, `test:execution:calibration`),
[performance](performance.md) (`bench:performance`), [contraste](frontend-tests.md)
(`test:contrast`) et [sécurité](dependency-security.md) (`security:sbom`,
`security:audit`, `security:gate`). Les variantes avec lecteurs personnels sont
des essais interactifs explicitement autorisés, pas une étape du diagnostic.

## Diagnostic en lecture seule

```powershell
npm run diagnose:environment
# Sans passer par le lanceur npm (utile si un .ps1 est refusé) :
node scripts/diagnose-environment.mjs
# Seulement pour préparer une vérification de signature / VM :
npm run diagnose:environment -- --release
```

Chaque observation indique `disponible`, `manquant` ou `non vérifié`, avec sa
cause. `disponible` qualifie seulement le fait décrit : fichier présent,
version observée ou déclaration locale. Les versions attendues viennent de
`package.json` et `rust-toolchain.toml`. npm est identifié par le manifeste du
CLI trouvé ; son lanceur n'est pas exécuté. Les bindings sont résolus sans
chargement, en réutilisant la liste de `check-development.mjs`, dont le
comportement reste inchangé.

Les commandes enfants se limitent aux versions, à la lecture locale Git,
à `vswhere` et à l'inventaire PowerShell sans profil, sans shell intermédiaire,
avec une borne de cinq secondes par appel. Rust est inspecté dans la toolchain
épinglée déjà installée sous `RUSTUP_HOME` ou `~/.rustup`, via ses binaires
directs ; les proxies pouvant installer une toolchain et les overrides actifs
ne sont pas exécutés. Rustup lui-même est seulement repéré dans le PATH :
[son code de gestion de version](https://github.com/rust-lang/rustup/blob/1.28.2/src/cli/rustup_mode.rs#L520-L537)
consulte aussi la configuration active. Une installation Rust ailleurs reste non vérifiée.
WebView2 est recherché dans les déclarations EdgeUpdate HKCU/HKLM (vues 32/64) ;
un runtime privé non enregistré peut échapper à ce contrôle. Le SDK est repéré
par ses en-têtes/bibliothèques x64 et MSVC par sa déclaration Visual Studio,
sans compilation. Les hôtes de test respectent `CARGO_TARGET_DIR`,
`PAM_MODAL_TEST_HOST` et `PAM_PERMISSION_TEST_HOST` ; leur présence ne prouve
ni leur fraîcheur ni leur fonctionnement.

Le rapport masque valeurs d'identité, URLs, chemins et sorties brutes des outils.
La présence du remote est locale : aucun accès réseau ni droit distant n'est
testé. Un hôte PowerShell disponible ne prouve pas l'autorisation des scripts
locaux. L'option `--release` inspecte seulement la présence de SignTool et le
format de la configuration ; elle ne lit pas les certificats, ne vérifie pas
une signature et ne pilote aucune VM.

Le diagnostic ne fait aucune installation, réparation, préparation de runtime,
modification Git/politique/permission, suppression, compilation ou exécution de
PAM, de moteur ou de test. Il écrit uniquement sur stdout et n'est raccordé à
aucun démarrage/build/job CI. Sa sortie normale a le code 0 même avec des
absences ; un argument inconnu donne le code 1. Ce rapport **ne vaut ni validation
native ni preuve de livraison**. Les suites et les conditions de livraison
documentées restent obligatoires.
