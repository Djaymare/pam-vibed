# Tests Vue et parcours Windows

Les tests chargent le code du dépôt. Aucun artefact d’audit ni modèle téléchargé
n’est une fixture nécessaire. Utiliser Node/npm épinglés dans package.json et des
dépendances installées pour l’OS courant (`docs/development.md`).

## Commandes pour le développement et la CI

```powershell
npm ci
npm run test:components
npm run build
npm run test:modals:build
$env:PAM_MODAL_TEST_HOST = "$PWD\src-tauri\target\x86_64-pc-windows-msvc\debug\examples\modal-test-host.exe"
npm run test:webview
npm run test:webview:cleanup
```

Les deux dernières commandes exigent Windows x64 et WebView2. Adapter le chemin
de l’hôte à CARGO_TARGET_DIR. Construire avec `test:modals:build` : un build Cargo
générique des exemples peut remplacer l’exécutable sans le manifeste Common
Controls v6 et provoquer un échec avant même le chargement de Vue. Le script de
build utilise Cargo/MSVC, le verrou Cargo et le manifeste Windows explicite.

`PAM_TEST_DEPENDENCY_ROOT` peut désigner un autre checkout avec les dépendances
Windows du même lockfile. Le runner charge toujours les sources de son dépôt
(ou PAM_TEST_SOURCE_ROOT explicite). Ne pas partager node_modules entre OS.
Les commandes échouent réellement en cas de contrôle manquant ou échoué.
`npm test` inclut aussi les tests de composants ; `test:components` sélectionne
les suites pertinentes pour une boucle front rapide, sans modèle ni effet externe.

## Ce que chaque niveau vérifie

| Niveau | Scénarios et assertions | Limites |
| --- | --- | --- |
| Vue sous Node | Demandes, édition, correction, suppression confirmée/annulée, brouillons, expiration, désactivation/runtime, statut, média, microphone et formulaires. Promesses contrôlées : doubles appels, succès, erreurs, timeout, navigation, démontage et permission tardive. | Renderer Vue en mémoire ; ne prouve ni focus DOM ni fonctionnement natif. |
| Client IPC de production + mockIPC officiel | component-journeys.test.mjs utilise le vrai ipc.ts, ses validations et invoke. Réponses versionnées, timeout structuré, confirmation incertaine sans rejeu, réponse obsolète ignorée et état récupérable. clearMocks après chaque test. | Rust et services simulés. Les autres suites injectent directement RequestFunction pour isoler leur comportement. |
| Hôte Tauri/Windows WebView2 | Vrais composants App et dialogues, rendu, clavier Tab/Maj+Tab/Entrée/Échap et arbre d’accessibilité Windows. Ajout/édition, correction, suppression, brouillons, expiration, runtime, navigation, focus et champs. Scénario PAM-32 : attente + double événement, navigation avant réponse, timeout annoncé puis reprise explicite, dialogue de correction nommé et restitution du focus. | Le module modal-native.js simule les services IPC, les fichiers et les applications. Cet hôte ne lance aucun sidecar ni application personnelle. Il ne prouve pas leur intégration métier. |
| Échec provoqué du runner | test:webview:cleanup crée un vrai AudioContext, provoque un échec après chargement, vérifie sortie non nulle, DOM/capture/rapport, fermeture du contexte, disparition de l’hôte et du profil. | Échec du scénario de test, pas panne réelle de moteur ou de microphone. |

Les assertions vérifient les effets et états observables ; aucun snapshot massif
ne remplace un contrat. Les régressions de propositions retirent Exécuter dès
expiration/invalidation. Les tests de timeout de confirmation interdisent une
seconde émission d’un effet dont le résultat est inconnu. Une annulation ignore
la réponse devenue périmée ; elle ne défait pas un effet natif déjà envoyé.

Le renderer Vue en mémoire possède tous ses montages et les démonte en fin de
test. Les suites recorder et microphone contrôlent pistes, AudioContext,
minuteries, listeners, acquisitions tardives et démontage avec des ressources
simulées. Les chemins utilisant mockIPC passent la validation du client réel ;
les fixtures de statut et de demande respectent désormais ses types complets.

## Diagnostic et nettoyage des parcours Windows

Le runner crée son propre profil WebView2 dans le répertoire temporaire et
un serveur local sur un port libre. Il attend le target exact de sa page.
Chaque page suit les pistes et contextes qu’elle crée, arrête les ressources au
pagehide et les libère avant la fin du test. Les parcours premier usage utilisent
un périphérique audio synthétique WebView2 ; ils n’accordent pas automatiquement
l’accès au microphone physique.

Le finally ferme les ressources audio, la socket, l’arbre de processus du seul
hôte lancé et le serveur, puis supprime uniquement son profil temporaire borné.
Tout échec de nettoyage fait échouer la commande. Le répertoire de rapport est
`artifacts/webview-tests/<horodatage>` (ou PAM_WEBVIEW_REPORT_DIR). `report.json`
donne runtime, contrôles réussis, erreurs JavaScript, stderr et résultats du
nettoyage. En cas d’échec après connexion : `failure-dom.html` et `failure.png`.
Une panne avant connexion garde l’erreur de démarrage et le résultat du nettoyage,
sans inventer de capture. Ces diagnostics ne contiennent que des fixtures ;
ne jamais pointer le runner vers un profil personnel.

Les sous-parcours existants restent disponibles via `test:modals -- --navigation-only`,
`--proposals-only`, `--status-only`, `--guided-only` ou `--first-use-only`.
La commande complète test:webview inclut le nouveau parcours PAM-32.
Les contrôles de contrastes et zoom restent dans `npm run test:contrast` et sa
variante `-- --extra` ; ils utilisent eux aussi le véritable hôte Windows.

## Contrôles qui demandent un autre environnement

Un aperçu Vite dans un navigateur sans bridge ne valide aucune intégration
native. Le runner refuse les OS autres que Windows pour WebView2. Le DOM/AX ne
prouve pas ce que NVDA annonce : pour cette vérification, utiliser la procédure
`docs/tickets/PAM-23.md` et `tests/fixtures/nvda-status.py` avec un profil NVDA
jetable et PAM_NVDA_SPEECH_LOG. Un lecteur d’écran absent ne devient pas un test
réussi. Les variantes clavier/AX automatisées ne requièrent pas NVDA.

Pour le matériel microphone, le refus/accord humain, le retrait USB et la veille,
suivre `docs/microphone.md` et le runner interactif `scripts/test-microphone.mjs`.
Les permissions/pistes simulées et le périphérique synthétique ne prouvent pas
ces scénarios physiques. Ne pas actionner les applications ou permissions
personnelles pour obtenir un test vert. L’intégration réelle Rust/sidecar et les
tests de paquet restent des niveaux distincts, documentés dans docs/native-tests.md.

Références : [mocks Tauri](https://v2.tauri.app/develop/tests/mocking/),
[niveaux de tests Vue](https://vuejs.org/guide/scaling-up/testing.html).
