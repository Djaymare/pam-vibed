# PAM — assistant vocal local pour Windows x64

Prototype Tauri 2 + Vue 3 : **microphone → Whistle → résolution des noms et alias → Needle 3 → application Windows**.
Le paquet embarque Node.js **24.21.0**, npm **11.19.0**, le moteur Cactus Windows x64 et les modèles `whistle.cact` et `needle3.cact`. L’utilisateur final n’installe ni Node, ni npm, ni Python, ni les modèles. L’installeur NSIS inclut l’installeur hors ligne de WebView2 et le lance silencieusement si nécessaire. Aucune clé API ni connexion Internet n’est nécessaire à l’utilisation.

## Utilisation

1. Installer PAM avec l’installeur Windows, puis ouvrir l’application.
2. Dans **Applications**, ajouter un fichier `.exe`, son nom et une description de son action. Ajouter des alias si utile, par exemple « VS Code » et « éditeur de code ».
3. Dans **Assistant**, cliquer sur le microphone, parler et cliquer à nouveau pour traiter la demande. L’enregistrement s’arrête automatiquement après environ 30 secondes. Une demande écrite est aussi disponible.
4. PAM affiche la transcription, les applications proposées, le score de confiance et le résultat des lancements. Par défaut, les appels dont la confiance atteint 70 % sont exécutés ; les autres demandent une validation. L’exécution automatique peut être désactivée dans **Préférences**.

Windows doit autoriser l’accès au microphone pour les applications de bureau. La langue par défaut est le français ; détection automatique et six autres langues sont disponibles.

### Correction et accès rapide

**Corriger la demande**, dans l’activité récente, permet de modifier la transcription ou de choisir explicitement « Je voulais cette application ». Pour une application avec `{input}`, le texte à transmettre est vérifiable dans un champ séparé. La correction annule une ancienne proposition en attente et prépare une nouvelle action qui exige toujours votre validation. Elle n’annule pas une action déjà exécutée. Cochez **Enregistrer un autre nom** uniquement si vous souhaitez conserver l’alias proposé ; il est éditable, limité à 40 caractères, et ne peut pas désigner une autre application.

**Ctrl + Maj + Espace** démarre ou arrête l’enregistrement depuis les autres applications et réaffiche PAM. Fermer la fenêtre ou choisir **Réduire PAM** masque PAM dans la zone de notification et coupe le microphone. Un clic gauche sur l’icône réaffiche PAM ; le menu propose parler/arrêter et **Quitter PAM**, qui libère les modèles. **Quitter PAM** est également disponible dans les préférences. Un raccourci déjà utilisé par un autre programme est signalé dans l’interface ; le bouton microphone et le menu restent utilisables. Une seule instance de PAM peut fonctionner.

### Applications et arguments

Chaque application active devient un outil Needle distinct. L’exécutable est choisi par l’utilisateur et le modèle ne peut pas le remplacer. Les arguments sont un **tableau JSON**, sans passage par un shell :

| Cas | Arguments |
| --- | --- |
| Lancer simplement l’application | `[]` |
| Transmettre un fichier, un texte ou une URL explicitement demandé | `["{input}"]` |
| Ouvrir une nouvelle fenêtre avec une entrée | `["--new-window", "{input}"]` |
| Ouvrir un projet fixe dans un éditeur | `["C:\\projets\\mon-projet"]` |

`{input}` est remplacé dans chaque élément du tableau et reste un argument distinct, même s’il contient des espaces. L’application cible doit accepter ces arguments. Le prototype **lance des exécutables et transmet des arguments** : il ne pilote pas les menus, ne tape pas dans les fenêtres et n’ajoute pas automatiquement une API à une application qui n’en possède pas. Une description doit donc correspondre à ce que son lancement peut réellement accomplir.

Les demandes écrites et vocales utilisent la même résolution des noms et alias : une invocation simple comme « diseur » ou « Ouvre Diseur » est transmise à Needle sous la forme « Ouvre deezer », avec uniquement l’outil Deezer. La transcription Whistle originale reste affichée. La casse est ignorée. Les déclencheurs ne forcent pas un choix pour un alias partagé par plusieurs applications actives, une négation ou plusieurs actions. Ces demandes restent confiées au modèle. Le score affiché sous « confiance Needle » est exactement celui renvoyé par Needle après cette résolution ; il ne mesure pas la précision de la transcription Whistle et n’est pas augmenté artificiellement. La confiance et les préférences d’exécution continuent de déterminer si une confirmation est nécessaire.

La liste est persistée dans `%APPDATA%\com.enkis.pam\applications.json`. L’activité reste en mémoire pour la session. Les demandes à valider sont temporairement persistées dans le sous-dossier `pending`, avec leur transcription ; elles expirent après dix minutes et deviennent invalides si la liste des applications change. Les plans expirés sont nettoyés au prochain appel. Les fichiers audio temporaires sont supprimés après chaque demande, y compris en cas d’erreur. Limites du prototype : 32 applications, 8 appels par demande, 30 secondes d’audio.

## Développement

Les outils de compilation sont nécessaires **sur la machine de développement uniquement** : Node 24, Rust avec la cible `x86_64-pc-windows-msvc`, outils de compilation C++ Microsoft. Ils ne font pas partie des prérequis de l’utilisateur final.

```powershell
npm ci
npm run prepare:runtime
npm run tauri dev
```

`prepare:runtime` télécharge les binaires officiels et les modèles, vérifie leurs SHA-256, embarque npm et conserve les licences. Les versions, révisions Hugging Face et empreintes sont fixées dans `scripts/prepare-runtime.mjs`. La DLL Cactus et le module Windows x64 Koffi sont extraits directement pendant la préparation, sans exécuter Python ni installer de paquet chez l’utilisateur. Le manifeste résultant est dans `src-tauri/runtime/manifest.json`. Les téléchargements n’ont lieu que pendant la préparation et la compilation. Les runtimes et le cache sont ignorés par Git.

Pour tester l’application dans un profil isolé, définir `PAM_PROFILE_DIR` avec un chemin absolu avant de la lancer. Cette variable facultative redirige la configuration et les propositions temporaires, afin d’éviter de modifier le catalogue personnel. Sans cette variable, PAM utilise le dossier AppData habituel.

Dans cet espace de travail, si npm n’est pas dans le PATH, le runtime déjà préparé peut l’exécuter :

```powershell
& .\src-tauri\binaries\pam-node-x86_64-pc-windows-msvc.exe .\src-tauri\runtime\npm\bin\npm-cli.js run build
```

### Compilation et distribution

Ce projet est compilé via le bind mount `C:\projets` → `/usr/projets` du conteneur Docker `practical_ganguly`. La commande habituelle reste utilisable :

```powershell
docker exec -w /usr/projets/pam practical_ganguly sh -lc "npm ci && npm run tauri build -- --runner cargo-xwin --target x86_64-pc-windows-msvc --no-bundle"
```

Le hook Tauri prépare automatiquement les ressources **Windows x64**, même lorsque le build tourne dans Linux. Fermer la version portable de PAM avant de recréer son dossier, car Windows verrouille un exécutable en cours d’utilisation. Pour créer ensuite le dossier exécutable complet :

```powershell
docker exec -w /usr/projets/pam practical_ganguly sh -lc "npm run package:portable && npm run verify:bundle"
```

Ou, en une commande après `npm ci`, utiliser `npm run package:docker`. L’exécutable seul créé par `--no-bundle` doit être accompagné de `pam-node.exe`, `runtime/` et `sidecar/` ; le script portable assemble ces fichiers. L’inspection des imports PE vérifie les exécutables, la DLL Cactus et le module Koffi x64 et l’absence de DLL Visual C++/Python/libgcc à installer séparément. La cible est Windows 10/11 x64, avec les composants système UCRT fournis par Windows.

Pour créer un installeur complet sur une machine Windows de développement :

```powershell
npm run package:windows
```

L’installeur se trouve dans `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`. Il contient tous les composants nécessaires, y compris l’installeur WebView2 hors ligne. Le paquet est plus volumineux pour garantir l’installation sans téléchargement de dépendances. La signature de code nécessite un certificat de distribution ; le prototype local est non signé.

Après compilation, `npm run package:portable` crée `artifacts/PAM-windows-x64/`. **Distribuer le dossier entier**, pas uniquement `PAM.exe`. Cette variante utilise le WebView2 déjà présent sur Windows ; utiliser l’installeur NSIS pour une machine sans WebView2.

Le workflow `.github/workflows/windows.yml` vérifie et compile le projet sur Windows, puis conserve l’installeur et le dossier portable comme artifacts. Il s’exécute manuellement ou lors d’un push/PR une fois le projet placé dans un dépôt GitHub.

### Vérifications

```powershell
npm test
npm run test:integration
npm run build
npm run verify:bundle
```

Les 43 tests Windows couvrent la validation des appels, les applications désactivées, la confirmation non rejouable, l’invalidation après modification, les scores manquants, les appels supprimés par Needle, le silence, le format/durée audio, le nettoyage après erreur, le mélange des canaux, la limite de capture à 30 secondes et les alias (casse, accents, caractères spéciaux, ambiguïtés, négations, demandes composées et transmission à Whistle). Ils vérifient aussi la résolution vocale avant Needle, la conservation de la transcription et du score réel, la langue détectée, le transport des textes Unicode et le budget partagé entre les deux étapes. Ils couvrent également les corrections, la validation obligatoire, l’enregistrement explicite des alias, les collisions, la réutilisation et la reprise du worker, le renouvellement des sessions et l’arrêt du sidecar à la fermeture de son pipe. Le test d’intégration Windows utilise le **vrai moteur et les vrais modèles**, vérifie npm embarqué, le routage texte, les alias avec plusieurs applications concurrentes, le silence Whistle et un lancement réel avec un exécutable de test isolé. Il n’ouvre pas les applications personnelles. Pour tester un fichier de parole PCM 16 bits mono 16 kHz :

```powershell
node scripts/smoke-runtime.mjs chemin\parole.wav
```

Un deuxième fichier WAV facultatif peut contenir « Diseur » ou « Ouvre Diseur » : `node scripts/smoke-runtime.mjs chemin\bloc-notes.wav chemin\diseur.wav`. Le test compare l’action et la confiance obtenues en vocal et en texte pour la même transcription.

Le modèle peut refuser ou mal router une demande : le score, les actions et leur résultat sont visibles. Des noms et descriptions d’outils précis ainsi que des alias adaptés améliorent le routage.

## Architecture

- `src/audio/` et `public/pcm-worklet.js` : capture PCM avec AudioWorklet, conversion filtrée en mono 16 kHz et encodage WAV.
- `src/App.vue` : assistant, correction, historique de session, applications, préférences et validation des actions.
- `src-tauri/src/lib.rs` : IPC limité à la fenêtre principale, Node persistant, raccourci global, zone de notification et instance unique. Un Job Object Windows garantit la fermeture du sidecar avec PAM, même si PAM s’arrête brutalement. Aucun serveur HTTP local.
- `sidecar/assistant.cjs` : configuration, alias, validation des appels et lancement des exécutables sans shell.
- `sidecar/main.cjs` : requêtes et réponses JSON par lignes sur stdin/stdout, sérialisées dans un seul processus.
- `sidecar/engine.cjs` et `engine-worker.cjs` : bibliothèque native officielle Cactus avec Koffi embarqué. Whistle et Needle restent chargés dans un worker ; chaque demande réinitialise la session et actualise les outils, sans recharger les poids ni réutiliser le contexte précédent. Le transport UTF-8 préserve les accents et les arguments Unicode, en texte comme en vocal.

Whistle transcrit d’abord le clip ; PAM résout les noms et alias puis appelle Needle. Le silence arrête le traitement. Les étapes partagent un budget de 40 secondes ; le sidecar dispose de 45 secondes et le bridge de 50 secondes. Un worker arrêté est repris pendant l’inférence ; si Node se termine ou si un appel natif se bloque, Rust recrée et réchauffe le sidecar à la demande suivante ou via sa surveillance périodique, même lorsque PAM est masqué. Les confirmations et lancements ne sont jamais rejoués automatiquement. Le bouton **Recharger les moteurs** permet aussi une reprise manuelle.

`prepare:runtime` extrait la DLL officielle depuis le wheel Cactus : Python n’est ni installé ni exécuté. Il extrait également Koffi 3.3.2 et son module Windows x64, avec versions et empreintes SHA-256 fixées. PAM vérifie la totalité du plan avant de lancer un exécutable. Les chemins/arguments non déclarés et les outils inconnus sont refusés. npm est fourni dans `runtime/npm` ; aucune installation ni aucun téléchargement ne sont lancés chez l’utilisateur.

## Références et licences

- [Whistle : formats audio et moteur commun](https://cactuscompute.com/blog/whistle)
- [Needle 3 : outils, confiance et Windows x64](https://cactuscompute.com/needle)
- [Source officielle Needle](https://github.com/cactus-compute/needle)
- [Modèles et moteur Needle](https://huggingface.co/Cactus-Compute/needle3)
- [Modèle Whistle](https://huggingface.co/Cactus-Compute/whistle)
- [Sidecars Tauri](https://v2.tauri.app/develop/sidecar/)

Les licences de Node, Needle et Whistle accompagnent les ressources distribuées. Les modèles et le moteur Cactus sélectionnés sont distribués sous Apache 2.0 ; Node et npm conservent leurs licences et mentions tierces d’origine.
