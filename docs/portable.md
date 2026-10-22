# Paquet portable Windows traçable

Depuis un checkout Windows propre avec les dépendances installées :

```powershell
npm ci
npm run build:portable
npm run package:portable
npm run verify:bundle
```

`build:portable` prépare et vérifie le runtime épinglé, compile TypeScript/Vite,
puis appelle Tauri pour la cible x64 avec Cargo `--locked` et `custom-protocol`.
`package:windows` utilise le même parcours avec NSIS ; `package:docker` utilise
cargo-xwin. Un build Cargo direct ne produit pas de reçu de distribution.

La préparation de la signature, du canal privé et des essais d'installation,
upgrade/rollback et désinstallation est décrite dans
[windows-release.md](windows-release.md). Ce parcours de build reste non signé ;
la configuration de signature préparée est distincte et n'est pas chargée ici.

Le reçu `artifacts/build/windows-x64.json` nomme explicitement le binaire produit,
son SHA-256, la version, le commit, un identifiant unique et les empreintes des
sources, du front, du sidecar et du runtime. Le binaire embarque cette identité
et la renvoie avec `PAM.exe --pam-build-info`, avant toute initialisation Tauri.
Le front embarqué contient également `build-identity.json` ; sa copie distribuée
permet de vérifier ses empreintes. Une source non committée, un binaire changé,
un reçu absent ou une ressource manquante impose un nouveau build. Seuls les
comptes rendus `docs/tickets/` et les fichiers de contrôle de l'autonomie sont
exclus de l'empreinte des sources ; ils ne sont pas distribués. Un commit de
preuve ultérieur est accepté si le commit du build est ancêtre de HEAD et si
toutes les autres sources restent identiques.

Windows ne remplace pas atomiquement un dossier non vide. La destination
`artifacts/PAM-windows-x64` est donc un **magasin de publications** :

- chaque assemblage utilise un staging neuf dans ce magasin ;
- `distribution.json` couvre chaque fichier livré (hors sa propre empreinte) ;
- le staging est vérifié puis renommé en `releases/<UUID>` ;
- un seul renommage atomique de `current.json` publie ce dossier complet.

`verify:bundle` résout ce pointeur et contrôle aussi le SHA-256 du manifeste.
Le consommateur lit le pointeur une fois et conserve ce chemin immuable.
Lancer `PAM.exe` dans le dossier indiqué par `current.json`, ou transmettre ce
seul dossier comme paquet portable. Les publications précédentes restent
intactes pour les lecteurs en cours ; elles ne font pas partie du paquet actif.
Aucun nettoyage automatique de ces anciennes publications n'est effectué.
Une sortie personnalisée doit rester sous `artifacts/` du checkout. Les liens
symboliques et jonctions de sortie sont refusés. Ne pas modifier un dossier
publié. Un ancien portable en dossier plat reste distinct de ce nouveau magasin.

La vérification native lance le binaire et le sidecar du paquet avec PATH vide,
profil temporaire, sans NODE_PATH/NODE_OPTIONS. Elle contrôle l'identité du
binaire, les imports PE x64, GSMTC en lecture seule, le chargement Needle,
Whistle sur silence et une application de test qui écrit un marqueur après
confirmation. Compléter la livraison par un lancement de l'interface finale
avec `PAM_PROFILE_DIR` et `WEBVIEW2_USER_DATA_FOLDER` dans un dossier jetable,
PATH vide, puis vérifier le rendu WebView2 et l'état des moteurs. Ne pas activer
DevTools dans le produit pour obtenir cette preuve : l'inspection accessible
de la fenêtre suffit. WebView2 reste un prérequis Windows ; aucun lecteur personnel
n'est commandé. Les tests `tests/portable.test.mjs` utilisent de petits binaires
factices uniquement pour les contrôles de provenance/publication, et ne prouvent
pas l'exécution native. Un build Linux ne remplace pas la validation Windows.
