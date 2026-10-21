# Développement reproductible Windows / Linux x64

PAM est une application **Windows x64**. Linux sert à tester le front et le
sidecar et à vérifier/compiler la cible Windows avec cargo-xwin ; il ne fournit
pas une version desktop Linux.

## Versions communes au poste, à Docker et à la CI

| Outil | Version retenue |
| --- | --- |
| Node.js | 24.21.0, fichier `.node-version` et `engines.node` |
| npm | 11.19.0, livré avec ce Node, `packageManager` et `engines.npm` |
| Rust / Cargo | 1.99.0, fichier `rust-toolchain.toml` |
| MSRV de PAM | 1.99, `src-tauri/Cargo.toml` ; versions plus anciennes non validées |
| Clippy / rustfmt | Composants de la toolchain Rust 1.99.0 |
| cargo-xwin (Linux) | 0.23.1, installé avec `cargo install --locked` |

`.npmrc` rend les versions Node/npm obligatoires. Conserver `package-lock.json`
et `src-tauri/Cargo.lock`. Utiliser `npm ci` et les commandes Cargo `--locked` ;
ne pas effacer un lockfile pour résoudre un problème de plateforme. Garder les
dépendances optionnelles npm, qui contiennent les bindings natifs.

## Contrat d'isolation

Chaque OS possède son **checkout et son `node_modules`**. Un répertoire installé
sous Linux ne fonctionne pas nécessairement sous Windows, même si les sources et
le lockfile sont identiques. Cela concerne aussi les lanceurs `.bin`, Rolldown
(Vite) et la CLI Tauri. Ne partager ni `node_modules`, ni `src-tauri/target`.

Si un checkout contient les dépendances d'un autre environnement, créer un
nouveau clone pour l'OS courant. `npm ci` supprime le `node_modules` du checkout
où il s'exécute : ne pas le lancer sur celui d'un autre OS pour le « réparer ».
L'ancien environnement reste disponible dans son propre checkout.

`npm run check:development` charge réellement les modules natifs Rolldown et
Tauri attendus (`win32-x64-msvc` ou `linux-x64-gnu`) et vérifie le lanceur
vue-tsc. Le build et les commandes desktop l'exécutent avant la compilation.
Un module absent/incompatible produit une erreur et ne remplace aucun fichier.
Les tests de ce contrôle utilisent des fixtures ; la commande sur chaque OS
charge les vrais bindings installés par `npm ci`.

## Clone neuf sous Windows

Installer Node 24.21.0 x64 (npm 11.19.0 inclus), Git, rustup et Visual Studio
Build Tools avec **Développement Desktop en C++**, MSVC x64 et Windows SDK.
WebView2 est nécessaire pour lancer PAM. Installer rustup selon la
[procédure Windows officielle](https://rust-lang.github.io/rustup/installation/windows.html).
Les outils sont requis pour le développement, pas chez l'utilisateur final.

Dans PowerShell, remplacer l'URL par celle du dépôt :

```powershell
$DepotUrl = 'URL_DU_DEPOT'
git clone $DepotUrl pam-windows
Set-Location pam-windows
node --version
npm --version
rustup show
cargo --version
cargo clippy --version
cargo fmt --version
npm ci
npm run check:development
npm run build
npm run prepare:runtime
npm test
cargo check --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc
```

`rustup show` installe/sélectionne la toolchain du fichier versionné, sa cible
Windows et les deux composants. Pour une installation explicite :

```powershell
rustup toolchain install 1.99.0 --profile minimal --component clippy --component rustfmt --target x86_64-pc-windows-msvc
```

Pour lancer le desktop : `npm run tauri dev`. Pour créer l'installeur :
`npm run package:windows`. Les scripts de packaging Tauri passent `--locked` à Cargo.
`prepare:runtime` télécharge des ressources Windows dont les SHA-256 sont
vérifiés ; le premier passage nécessite Internet et de l'espace disque pour
les modèles. Les ressources et caches générés restent ignorés par Git.

## Linux dans Docker, depuis Windows ou Linux

Installer Docker Engine/Desktop avec des conteneurs Linux x64, puis cloner le
dépôt dans un répertoire de sources. Ce parcours fonctionne aussi depuis le
clone Windows ci-dessus : l'image reçoit uniquement une **copie filtrée** des
sources. Elle n'utilise aucun bind mount et n'écrit pas dans le checkout hôte.
`.dockerignore` exclut les `node_modules`, caches, profils, ressources natives
générées et répertoires `target` de l'hôte.

Depuis la racine du clone, mêmes commandes dans PowerShell et dans un shell Linux :

```sh
docker build -f Dockerfile.development -t pam-development .
docker run --rm pam-development
```

Le Dockerfile fixe Node/npm et Rust, installe Clippy/rustfmt et cargo-xwin,
exécute `npm ci` dans l'image et charge les bindings **Linux glibc x64**.
Le conteneur exécute `npm test`, `npm run build`, `npm run prepare:runtime`, puis
`cargo xwin check --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc`.
cargo-xwin appelle Cargo pour cette cible en configurant le compilateur et le
SDK Windows. Il télécharge le SDK/CRT Microsoft à son premier usage ; ses
[prérequis et conditions sont documentés par le projet](https://github.com/rust-cross/cargo-xwin).
La préparation ne lance aucun exécutable Windows sous Linux.

Pour consulter les outils de cette image :

```sh
docker run --rm pam-development sh -c 'node --version && npm --version && cargo --version && cargo clippy --version && cargo fmt --version && cargo xwin --version'
```

Pour produire un portable dans un conteneur jetable, choisir un nom libre
(ici `pam-package`, sans dépendre d'un conteneur déjà présent sur une machine) :

Créer d'abord le dossier `artifacts/` sur l'hôte :
`New-Item -ItemType Directory -Force artifacts` dans PowerShell, ou
`mkdir -p artifacts` dans un shell Linux.

```sh
docker run --name pam-package pam-development npm run package:docker
docker cp pam-package:/workspace/pam/artifacts/PAM-windows-x64 ./artifacts/PAM-windows-x64
docker rm pam-package
```

Le paquet reste une application Windows. Sa validation native s'effectue sur
Windows avec un profil jetable ; une compilation Linux ne valide ni WebView2,
ni les lecteurs Windows, ni un installeur NSIS. Refaire `docker build` après une
modification des sources. Les installations apt proviennent de Debian bookworm ;
les versions des outils de projet sont fixées, l'image entière n'est pas un
snapshot bit à bit de la distribution.

## CI et vérification des lockfiles

`.github/workflows/windows.yml` utilise Node 24.21.0 et Rust 1.99.0 avec les mêmes
composants/cible. Les contrôles rapides, Rust/WebView2 et Linux précèdent le
job d'intégration/packaging Windows via des dépendances obligatoires. Le job
Linux construit et exécute exactement `Dockerfile.development`, dont
`cargo xwin check --locked`. Voir [ci-quality.md](ci-quality.md). Les caches des
jobs restent séparés par OS. Aucune exécution de la CI distante n'est nécessaire
pour effectuer les validations locales ci-dessus.

Après les contrôles, `git diff --exit-code -- package-lock.json src-tauri/Cargo.lock`
doit confirmer que les installations verrouillées n'ont pas modifié les
lockfiles. Une mise à jour volontaire de dépendances fait l'objet d'un diff
distinct et de validations sur les deux environnements.
