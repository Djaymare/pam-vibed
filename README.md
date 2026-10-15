# PAM — assistant vocal local pour Windows x64

Prototype Tauri 2 + Vue 3 : **microphone → Whistle → résolution des noms et alias → Needle 3 → application Windows**.
Le paquet embarque Node.js **24.21.0**, npm **11.19.0**, le moteur Cactus Windows x64 et les modèles `whistle.cact` et `needle3.cact`. L’utilisateur final n’installe ni Node, ni npm, ni Python, ni les modèles. L’installeur NSIS inclut l’installeur hors ligne de WebView2 et le lance silencieusement si nécessaire. Les moteurs locaux fonctionnent sans clé API ni connexion Internet ; un service de musique comme Deezer conserve ses propres exigences de connexion et de compte.

## Utilisation

1. Installer PAM avec l’installeur Windows, puis ouvrir l’application.
2. Dans **Applications → Ajouter une application**, choisir une application Windows dans la liste, puis décrire son action. Les applications de bureau et du Microsoft Store sont proposées avec leur icône ; la recherche ignore les accents. **Choisir un .exe** permet d’ajouter une application portable ou absente du catalogue. Ajouter des alias si utile, par exemple « VS Code » et « éditeur de code ».
3. Dans **Assistant**, cliquer sur le microphone, parler et cliquer à nouveau pour traiter la demande. L’enregistrement s’arrête automatiquement après environ 30 secondes. Une demande écrite est aussi disponible.
4. PAM affiche la transcription, les applications proposées, le score de confiance et le résultat des lancements. Par défaut, les appels dont la confiance atteint 70 % sont exécutés ; les autres demandent une validation. L’exécution automatique peut être désactivée dans **Préférences**.

Windows doit autoriser l’accès au microphone pour les applications de bureau. La langue par défaut est le français ; détection automatique et six autres langues sont disponibles.

### Correction et accès rapide

**Corriger la demande**, dans l’activité récente, permet de modifier la transcription ou de choisir explicitement « Je voulais cette application ». Pour une application avec `{input}`, le texte à transmettre est vérifiable dans un champ séparé. La correction annule une ancienne proposition en attente et prépare une nouvelle action qui exige toujours votre validation. Elle n’annule pas une action déjà exécutée. Cochez **Enregistrer un autre nom** uniquement si vous souhaitez conserver l’alias proposé ; il est éditable, limité à 40 caractères, et ne peut pas désigner une autre application.

Une proposition attend votre validation pendant dix minutes ; son heure limite est affichée. À l’échéance, après modification des applications/formulations ou après une correction ayant retiré l’ancien plan, son bouton d’exécution disparaît avec une cause et une invitation à reformuler. Toutes les propositions encore en attente restent visibles, même au-delà de vingt demandes ; seules les entrées résolues sont limitées aux vingt plus récentes.

Au redémarrage du sidecar/PAM, les anciennes permissions d’exécution sont retirées explicitement, sans restauration ni exécution automatique. Le dossier local `proposals` conserve les états `pending`, `expired`, `invalidated` et `consumed`, l’échéance et la cause ; un identifiant inconnu rend `unknown`. Les anciens fichiers `pending` sont migrés avant nettoyage. Les états terminaux restent dans le profil pour distinguer une proposition expirée d’une proposition inconnue ; l’activité visuelle n’est pas restaurée. Ces fichiers contiennent le texte et le plan, sans audio. Ils ne sont pas supprimés automatiquement par la limite d’historique.

Pour corriger « pose/pause » ou « mais/mets », choisissez l’application puis **Je voulais cette action → Mettre en pause**. Cochez **Mémoriser une formulation pour cette action** et conservez la transcription erronée, par exemple « pose le navigateur ». **Préparer la correction** enregistre cette association et prépare la pause à valider. Une action choisie explicitement ne reçoit pas de score Needle.

Dans **Préférences → Formulations personnelles**, vous pouvez ajouter, modifier et supprimer ces associations, par exemple « mais le film en pose » → **Mettre en pause · Navigateur Opera GX**. Chaque phrase complète désigne une application et son lancement ou une commande de lecture Windows. Elle est reconnue à l’écrit et après transcription vocale ; la casse, les accents, les espaces répétés et la ponctuation finale sont ignorés. Les mots ne sont pas remplacés dans les autres textes. Les demandes suivantes passent par Needle avec l’action correspondante ; le score réel, les préférences de validation et les capacités du lecteur restent appliqués. Une cible désactivée ou une commande indisponible est signalée. Consultez [les règles et la validation](docs/command-aliases.md).

Les formulations personnelles et la correction proposent aussi les actions du plugin Deezer : Flow, coups de cœur, recherche, contenus, huit pages, sélections et rechargement. **Recherche à transmettre** permet de mémoriser un artiste mal transcrit avec son nom corrigé. Les commandes simples Deezer fixent leurs paramètres avant Needle ; « coûts de cœur » est reconnu dans la commande des favoris. Le score de choix d’action ne mesure pas la qualité de transcription. Consultez [les commandes et les mesures Deezer](docs/deezer-routing.md).

Le nom du lecteur peut précéder l’action : « Diseur Flow » ou « Diseur rechercher Daft Punk ». « Démarrer Flow » sans nom de lecteur cible l’unique fiche Deezer active ; plusieurs fiches exigent de préciser son nom ou un alias unique.

« Diseur piste suivante », « Prochaine piste sur Diseur » et « Mais Diseur empose » ciblent aussi l’action exacte avant Needle. « Prochaine piste » ou « Mets le média en pause » sans nom de lecteur utilisent uniquement l’unique lecteur configuré avec une session Windows disponible ; plusieurs lecteurs exigent de préciser lequel. Une pause indisponible ne devient pas un arrêt. Les transcriptions comme « des heures » restent personnalisables par phrase complète. Consultez [les formulations multimédias](docs/media-commands.md).

**Ctrl + Maj + Espace** démarre ou arrête l’enregistrement depuis les autres applications et réaffiche PAM. Fermer la fenêtre ou choisir **Réduire PAM** masque PAM dans la zone de notification et coupe le microphone. Un clic gauche sur l’icône réaffiche PAM ; le menu propose parler/arrêter et **Quitter PAM**, qui libère les modèles. **Quitter PAM** est également disponible dans les préférences. Un raccourci déjà utilisé par un autre programme est signalé dans l’interface ; le bouton microphone et le menu restent utilisables. Une seule instance de PAM peut fonctionner.

### Applications et arguments

La liste des applications provient du catalogue natif Windows **AppsFolder**, complété par les raccourcis du menu Démarrer utilisateur et commun. **Actualiser** relit ces sources après une installation. Les doublons détectés sont marqués **Déjà ajoutée**. Les noms, la source et les icônes PNG (64 pixels maximum) sont récupérés localement, sans scanner les fichiers personnels et sans installer PowerShell, un module npm ou un service supplémentaire. Les liens de documentation, de désinstallation et les scripts ouverts par des terminaux sont filtrés ; certaines applications absentes du menu Démarrer devront être ajoutées manuellement.

Pour une application détectée, PAM conserve son identifiant Windows et utilise `explorer.exe` avec un unique argument `shell:AppsFolder\<identifiant>`, ou le chemin du raccourci `.lnk` si Windows ne l’a pas encore intégré dans AppsFolder. Windows gère ainsi le lancement et les paramètres du raccourci, y compris pour les applications du Store dont les exécutables sont protégés. Le formulaire masque ces détails. **Choisir un .exe** revient au mode manuel si vous avez besoin d’arguments personnalisés, notamment `{input}`. Les anciennes configurations restent compatibles et ne sont pas modifiées automatiquement.

**Tester le lancement**, dans le formulaire d’ajout ou de modification, ouvre explicitement l’application choisie sans enregistrer le brouillon et sans appeler Needle. Pour les arguments contenant `{input}`, renseigner le texte, le fichier ou l’URL du test. Le résultat confirme l’envoi de la commande ; vérifiez ensuite que la fenêtre attendue s’est ouverte. Le test ne certifie pas qu’une application déjà ouverte a créé une nouvelle fenêtre.

Chaque application active devient un outil Needle distinct. L’exécutable est choisi par l’utilisateur et le modèle ne peut pas le remplacer. Les arguments sont un **tableau JSON**, sans passage par un shell :

| Cas | Arguments |
| --- | --- |
| Lancer simplement l’application | `[]` |
| Transmettre un fichier, un texte ou une URL explicitement demandé | `["{input}"]` |
| Ouvrir une nouvelle fenêtre avec une entrée | `["--new-window", "{input}"]` |
| Ouvrir un projet fixe dans un éditeur | `["C:\\projets\\mon-projet"]` |

`{input}` est remplacé dans chaque élément du tableau et reste un argument distinct, même s’il contient des espaces. L’application cible doit accepter ces arguments. Le lancement **ouvre des exécutables et transmet des arguments**. Les lecteurs configurés disposent en plus des commandes Windows et du plugin Deezer décrits ci-dessous. PAM ne pilote pas les menus et ne tape pas dans les fenêtres. Une description doit correspondre aux capacités réelles de l’application.

Les demandes écrites et vocales utilisent la même résolution des noms et alias : une invocation simple comme « diseur » ou « Ouvre Diseur » est transmise à Needle sous la forme « Ouvre deezer », avec uniquement l’outil Deezer. La transcription Whistle originale reste affichée. La casse est ignorée. Les déclencheurs ne forcent pas un choix pour un alias partagé par plusieurs applications actives, une négation ou plusieurs actions. Ces demandes restent confiées au modèle. Le score affiché sous « confiance Needle » est exactement celui renvoyé par Needle après cette résolution ; il ne mesure pas la précision de la transcription Whistle et n’est pas augmenté artificiellement. La confiance et les préférences d’exécution continuent de déterminer si une confirmation est nécessaire.

La liste est persistée dans `%APPDATA%\com.enkis.pam\applications.json`. L’activité reste en mémoire pour la session. Les demandes à valider sont temporairement persistées dans le sous-dossier `pending`, avec leur transcription ; elles expirent après dix minutes et deviennent invalides si la liste des applications change. Les plans expirés sont nettoyés au prochain appel. Les fichiers audio et mots-clés temporaires sont supprimés à la fin d’une demande qui rend la main. Après un arrêt brutal ou un timeout natif, les dossiers identifiés par PID/session sont collectés au démarrage du sidecar et au prochain appel dès que leur propriétaire est mort (rétention supplémentaire : zéro). Les anciens dossiers non marqués et anciens fichiers JSON `.tmp` ont une rétention de dix minutes, puis sont collectés lors de ces mêmes occasions. Une demande active est préservée ; le nettoyage ne suit aucun lien/jonction et ne supprime rien récursivement. Un disque indisponible, une identité invalide ou un PID encore vivant peut reporter la suppression. Les fichiers restent sur disque tant que PAM ne peut pas accéder au profil ; aucune suppression pendant l’arrêt de PAM n’est garantie. Préférences signale les échecs constatés au dernier contrôle. Limites du prototype : 32 applications, 8 appels par demande, 30 secondes d’audio.

### Lecteurs Windows et Deezer Music

Dans le formulaire d’application, ouvrir un média puis **Actualiser les sessions** et choisir la session Windows du lecteur. PAM propose lecture, pause, suivante, précédente, arrêt et bascule selon les capacités réellement annoncées. Une session absente, fermée ou ambiguë produit un message explicite. Les commandes ciblent uniquement l’identifiant enregistré. Sur la machine testée, Deezer Music publie `Deezer.exe`, Opera publie `opera.exe`, et VLC 3.0.24 ne publie aucune session compatible.

Sélectionner **Deezer Music** du Microsoft Store pour activer son plugin. Il permet la recherche, l’affichage d’une chanson, album, artiste, playlist, podcast, épisode ou profil par identifiant, les pages et réglages établis, Flow, les coups de cœur et les sélections smarttracklist. Les liens de navigation n’annoncent pas une lecture réussie. **Jouer une chanson précise et l’insérer en prochaine position ne disposent pas de protocole vérifié et restent indisponibles.** « Piste suivante » parcourt la file existante.

Les boutons de **Lecteurs multimédias** préparent toujours une action à valider ; les demandes textuelles et vocales suivent les préférences habituelles de confiance. Les alias fonctionnent aussi pour `Pause Diseur` ou `Piste suivante Diseur`. Consultez [l’inventaire, les preuves et les essais Windows](docs/windows-media-deezer.md) pour les routes, les prérequis et les limites propres à chaque lecteur.

## Développement

Les outils de compilation sont nécessaires **sur la machine de développement uniquement** : Node 24.21.0 / npm 11.19.0, Rust 1.99.0 avec la cible `x86_64-pc-windows-msvc`, Clippy/rustfmt et outils C++ Microsoft. Le contrat d’isolation des dépendances, les clones neufs Windows et le parcours Linux/Docker sont décrits dans [Développement reproductible](docs/development.md).

```powershell
npm ci
npm run check:development
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

Le parcours Linux utilise une image dédiée, sans monter ni remplacer les `node_modules` Windows :

```powershell
docker build -f Dockerfile.development -t pam-development .
docker run --rm pam-development
```

Les versions, contrôles verrouillés et commandes de packaging Docker sont dans [la procédure de développement](docs/development.md). Le hook Tauri prépare les ressources **Windows x64**, même lorsque la compilation tourne dans Linux. L’exécutable créé par `--no-bundle` doit être accompagné de `pam-node.exe`, `runtime/` et `sidecar/` ; le script portable assemble ces fichiers. Fermer le portable de PAM avant de recréer son dossier, car Windows verrouille un exécutable en cours d’utilisation. La cible est Windows 10/11 x64, avec les composants système UCRT fournis par Windows.

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
npm run test:media
npm run test:confidence
npm run test:deezer:routing
npm run build
npm run verify:bundle
```

Pour vérifier la découverte native et les nouveaux raccourcis après compilation :

```powershell
docker run --name pam-discovery pam-development cargo xwin build --manifest-path src-tauri/Cargo.toml --locked --release --target x86_64-pc-windows-msvc --example discovery
New-Item -ItemType Directory -Force src-tauri/target/x86_64-pc-windows-msvc/release/examples | Out-Null
docker cp pam-discovery:/workspace/pam/src-tauri/target/x86_64-pc-windows-msvc/release/examples/discovery.exe ./src-tauri/target/x86_64-pc-windows-msvc/release/examples/discovery.exe
docker rm pam-discovery
```

Puis, sur Windows, compilez aussi PAM avec `cargo build --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc --features process-tests`. Exécutez `npm run test:applications -- chemin/discovery.exe chemin/pam.exe` (ou définissez `PAM_APPLICATION_TEST_HOST` pour le second chemin). Le contrôle vérifie les cibles et les icônes du catalogue réel. Il crée un raccourci temporaire dans le menu Démarrer vers une copie unique du Node embarqué, teste son lancement et ses arguments via le bridge Rust, puis supprime ce raccourci et son profil. `node scripts/smoke-application-availability.mjs chemin/pam.exe` vérifie aussi disparition, désactivation et réparation dans un profil jetable. Aucune application personnelle n’est lancée. `npm test` comprend les régressions des applications détectées et manuelles, de leur disponibilité, des GUID, des formulations, des doublons, des icônes et du test de lancement sans enregistrement.

Les tests Windows couvrent la validation des appels, les applications désactivées, la confirmation non rejouable, l’invalidation après modification, les scores manquants, les appels supprimés par Needle, le silence, le format/durée audio, le nettoyage après erreur, le mélange des canaux, la limite de capture à 30 secondes et les alias (casse, accents, caractères spéciaux, ambiguïtés, négations, demandes composées et transmission à Whistle). Ils vérifient aussi la résolution vocale avant Needle, la conservation de la transcription et du score réel, la langue détectée, le transport des textes Unicode et le budget partagé entre les deux étapes. Ils couvrent également les corrections, la validation obligatoire, l’enregistrement explicite des alias, les collisions, la réutilisation et la reprise du worker, le renouvellement des sessions et l’arrêt du sidecar à la fermeture de son pipe. Le test d’intégration Windows utilise le **vrai moteur et les vrais modèles**, vérifie npm embarqué, le routage texte, les alias avec plusieurs applications concurrentes, le silence Whistle et un lancement réel avec un exécutable de test isolé. Il n’ouvre pas les applications personnelles. Pour tester un fichier de parole PCM 16 bits mono 16 kHz :

```powershell
node scripts/smoke-runtime.mjs chemin\parole.wav
```

Un deuxième fichier WAV facultatif peut contenir « Diseur » ou « Ouvre Diseur » : `node scripts/smoke-runtime.mjs chemin\bloc-notes.wav chemin\diseur.wav`. Le test compare l’action et la confiance obtenues en vocal et en texte pour la même transcription.

Le modèle peut refuser ou mal router une demande : le score, les actions et leur résultat sont visibles. PAM utilise des noms d’outils courts et une formulation interne anglaise pour les commandes simples reconnues sans ambiguïté, en conservant la demande française et le score brut Needle. Les contrôles des négations et du lecteur nommé sont décrits avec les mesures et les tests dans [docs/needle-confidence.md](docs/needle-confidence.md).

## Architecture

- `src/audio/` et `public/pcm-worklet.js` : capture PCM avec AudioWorklet, conversion filtrée en mono 16 kHz et encodage WAV.
- `src/App.vue` : assistant, correction, historique de session, applications, préférences et validation des actions.
- `src-tauri/src/lib.rs` : IPC limité à la fenêtre principale, raccourci global, zone de notification et instance unique. `src-tauri/src/bridge.rs` confie le pipe Node persistant à un acteur avec quatre places en file et un seul appel actif. Un Job Object Windows garantit la fermeture du sidecar avec PAM, même si PAM s’arrête brutalement. Aucun serveur HTTP local.
- `sidecar/assistant.cjs` : configuration, alias, validation des appels et lancement des exécutables sans shell.
- `sidecar/needle-tools.cjs` : noms et descriptions présentés à Needle, formulation des commandes reconnues et contrôle de la demande originale.
- `sidecar/command-aliases.cjs` et `src/components/CommandAliases.vue` : phrases personnelles associées à un lecteur et une action, correction et gestion dans les préférences.
- `sidecar/deezer-commands.cjs` : reconnaissance des commandes Deezer et conservation des paramètres explicitement demandés.
- `src-tauri/src/media.rs` et `sidecar/media.cjs` : sessions GSMTC, capacités, ciblage et commandes Windows avec résultat vérifié.
- `sidecar/deezer.cjs` et `src/components/MediaControls.vue` : protocoles Deezer validés et préparation des commandes à confirmer.
- `sidecar/main.cjs` : requêtes et réponses JSON par lignes sur stdin/stdout, sérialisées dans un seul processus.
- `sidecar/engine.cjs` et `engine-worker.cjs` : bibliothèque native officielle Cactus avec Koffi embarqué. Whistle et Needle restent chargés dans un worker ; chaque demande réinitialise la session et actualise les outils, sans recharger les poids ni réutiliser le contexte précédent. Le transport UTF-8 préserve les accents et les arguments Unicode, en texte comme en vocal.

Whistle transcrit d’abord le clip ; PAM résout les noms et alias puis appelle Needle. Le silence arrête le traitement. Les étapes partagent un budget de 40 secondes ; le sidecar dispose de 45 secondes. Le délai de **50 secondes** du bridge commence avant la sérialisation et couvre l’attente en file, le démarrage, l’écriture du pipe et la réponse. Une file pleine est refusée immédiatement ; une demande expirée en file n’est pas exécutée. Les erreurs distinguent saturation (`bridge_queue_full`), attente en file (`bridge_queue_timeout`), écriture bloquée (`bridge_write_timeout`), absence de réponse (`bridge_response_timeout`) et sortie fermée (`bridge_eof`). Un délai atteint pendant un effet natif donne `bridge_host_timeout` : son résultat peut être incertain et il n’est pas rejoué.

Un worker arrêté est repris pendant l’inférence ; si Node se termine ou si son pipe se bloque, Rust termine son job interne sans attendre le pipe, puis recrée le sidecar à la demande suivante ou via sa surveillance périodique, même lorsque PAM est masqué. Les confirmations et lancements ne sont jamais rejoués automatiquement. Les réponses d’un transport interrompu sont abandonnées. Quitter PAM et **Recharger les moteurs** utilisent ce même contrôle d’arrêt indépendant ; les effets restent sérialisés par l’acteur et les applications utilisateur restent hors du job interne.

Le budget de travail de 40 secondes commence à l’admission côté Node, avant nettoyage et découverte des sessions. Il couvre Whistle, Needle, préparation et toutes les actions. Rust transmet son échéance et le temps restant après file/démarrage ; Node conserve la borne la plus courte, en tenant aussi compte du temps d’écriture du pipe. Les auxiliaires Windows et l’hôte utilisent au plus 12 secondes, réduites au budget restant. Aucun nouvel effet n’est émis après épuisement du budget.

Chaque résultat d’action expose `outcome` : `not_started` (non démarrée), `performed` (effectuée ou commande acceptée, selon le message), `failed` (échec connu), `unknown` (commande possiblement effectuée sans confirmation). Une séquence interrompue renvoie `status: "partial"` et conserve un résultat par appel, avec index et identité d’application. L’interface affiche ces issues séparément ; elle ne propose pas d’exécuter à nouveau la séquence partielle.

Avant chaque émission, PAM écrit un reçu dans le sous-dossier `executions` du profil et transmet une progression sur le pipe privé. Rust conserve la dernière progression si le sidecar disparaît ou expire. Après redémarrage, confirmer à nouveau l’identifiant d’une séquence interrompue renvoie son reçu sans émettre d’action ; une confirmation déjà achevée rend `consumed` sans nouvel effet. Les reçus contiennent le plan et les résultats, sans audio. Ils n’annulent pas un effet déjà commencé ; un résultat inconnu demande de vérifier l’application avant une nouvelle demande explicite.

Les régressions Rust Windows utilisent `tests/fixtures/bridge-sidecar.cjs` et des profils jetables : audio de 4 Mo sur stdin non lu, enfant interne héritant du pipe, arrêt/reprise pendant l’écriture, EOF, réponse tardive, saturation, expiration en file, ordre concurrent et conservation des résultats partiels. Exécuter `cargo test --manifest-path src-tauri/Cargo.toml --locked`, puis `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings`, sur Windows avec le runtime préparé. Les tests utilisent la même implémentation du transport avec des délais raccourcis ; ils ne simulent pas une inférence native bloquée.

`prepare:runtime` extrait la DLL officielle depuis le wheel Cactus : Python n’est ni installé ni exécuté. Il extrait également Koffi 3.3.2 et son module Windows x64, avec versions et empreintes SHA-256 fixées. PAM vérifie la totalité du plan avant de lancer un exécutable. Les chemins/arguments non déclarés et les outils inconnus sont refusés. npm est fourni dans `runtime/npm` ; aucune installation ni aucun téléchargement ne sont lancés chez l’utilisateur.

## Références et licences

- [Whistle : formats audio et moteur commun](https://cactuscompute.com/blog/whistle)
- [Needle 3 : outils, confiance et Windows x64](https://cactuscompute.com/needle)
- [Source officielle Needle](https://github.com/cactus-compute/needle)
- [Modèles et moteur Needle](https://huggingface.co/Cactus-Compute/needle3)
- [Modèle Whistle](https://huggingface.co/Cactus-Compute/whistle)
- [Sidecars Tauri](https://v2.tauri.app/develop/sidecar/)

Les licences de Node, Needle et Whistle accompagnent les ressources distribuées. Les modèles et le moteur Cactus sélectionnés sont distribués sous Apache 2.0 ; Node et npm conservent leurs licences et mentions tierces d’origine.
