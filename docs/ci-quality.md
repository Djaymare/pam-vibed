# Barrière de qualité CI

Le workflow `Prototype Windows x64` construit les PR, les pushes autorisés et
les lancements manuels. Il reste en lecture seule, sans secret, signature,
release ni déploiement. Ses artefacts sont des paquets de test non signés.

## Ordre et commandes

| Check GitHub | Prérequis | Contrôles | Budget |
| --- | --- | --- | --- |
| `quick` | Aucun | `npm ci`, puis `npm run ci:quick` : bindings de l'OS, politique des workflows, format, ESLint, `npm test`, composants Vue, TypeScript et Vite | 20 min |
| `native-tests` | `quick` | `npm ci`, puis `npm run ci:native` : Node de test sans modèles, rustfmt, Clippy tous targets avec `-D warnings`, Cargo locked, régressions historiques, construction de l'hôte, parcours WebView2 et nettoyage provoqué | 45 min |
| `linux` | `quick` | Image Docker isolée, `npm ci` pendant sa construction, `npm test`, build front, préparation du runtime et `cargo xwin check --locked` de la cible Windows | 60 min |
| `build` | Les trois checks précédents | `npm ci`, `npm run ci:integration`, puis `npm run ci:package` et upload seulement en cas de succès | 90 min |

`ci:integration` prépare les moteurs, exécute Cargo avec
`engine-integration`, `test:integration:node`,
`test:integration`, `test:confidence`, `test:deezer:routing` et
`test:media:commands`. `ci:package` construit NSIS, assemble un portable frais,
exécute `verify:bundle` sur ce paquet final et produit sa provenance.

Les commandes Cargo utilisent `--manifest-path src-tauri/Cargo.toml`,
`--locked` lorsqu'il est accepté et la cible `x86_64-pc-windows-msvc`.
Les versions de Node/npm/Rust et les SHA des actions restent ceux du dépôt.
Les détails de permissions, caches et concurrence sont dans [ci-security.md](ci-security.md).

Les quatre jobs sont obligatoires pour produire l'artefact de paquet. Aucun
`continue-on-error`, condition de contournement ou upload `always()` de paquet
n'est autorisé. Le script de politique et ses mutations de régression contrôlent
ces dépendances. GitHub propage les échecs et les skips via
[`needs`](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idneeds).
Le plafond configuré cumulé du workflow est 215 minutes, sans matrice ;
`inventory-and-advisories` dans le workflow sécurité garde son budget de 30 min.

## Niveaux de test et effets

`npm test` fonctionne sans modèle. Les trois tests Node qui chargent réellement
la DLL et le sidecar ou mesurent le contexte natif résident dans `tests/integration/` et sont obligatoires
via `npm run test:integration:node` sous Windows. Cette commande refuse un
autre OS. Les tests Rust sans modèle restent séparés de la feature moteur.
Les skips spécifiques Windows de la suite Linux sont visibles ; les parcours
natifs et modèles sont exécutés dans les jobs Windows.

WebView2 rend les vrais composants avec les services IPC métier simulés et
un microphone synthétique. Ces assertions ne valent pas une intégration du
sidecar. Les suites Needle utilisent les vrais modèles, des profils jetables
et des sessions média simulées. Les lancements du smoke runtime et du paquet
visent uniquement un script Node de test. Aucun `--deezer`, `--players`,
application personnelle ou microphone matériel n'est utilisé par ces jobs.
`verify:bundle` vérifie aussi le binaire final et ses ressources avec PATH vide.

Les tests de reprise audio décrivent des chemins Windows sur tous les hôtes.
Ils ne tentent pas d'enregistrer `/usr/local/bin/node` comme cible Windows.
Un enfant qui meurt avant son message de préparation provoque un échec borné.
L'image de développement installe Git, utilisé par les fixtures de packaging.

## Diagnostics et provenance

Le runner `scripts/ci-run.mjs` lance ses enfants sans shell et s'arrête au
premier échec. Chaque commande est bornée à 15 minutes, ou 30 pour Cargo ;
Node borne également chaque test à 120 secondes et deux fichiers concurrents.
Un timeout tue seulement l'arbre du processus de test possédé par le runner.
`artifacts/ci/<phase>/report.json` enregistre commit, état du checkout, commande,
code de sortie, durée et chemin de log. stdout et stderr sont conservés.

Un upload de diagnostics `always()` par job conserve `artifacts/ci/` et les
rapports WebView2, même après échec. Linux conserve les logs Docker avec
`pipefail`. Ces uploads excluent le portable et l'installeur. Un échec avant
création des fichiers reste visible dans les logs GitHub ; l'upload absent
échoue aussi et n'est jamais compté comme une preuve réussie.

L'upload de paquet suit toutes les vérifications. Son nom inclut le SHA
GitHub, l'événement, le run et sa tentative. Il contient NSIS, portable et
rapports d'intégration/packaging. `artifacts/ci/delivery.json` lie le commit
testé, le buildId, l'empreinte du manifeste portable et de l'installeur, ainsi
que le rapport d'intégration. Un checkout différent du SHA GitHub ou un rapport
d'intégration non réussi, sale ou d'un autre commit est refusé. Rétention sept
jours, fichiers cachés exclus et écrasement interdit.

## Checks requis côté dépôt

Configurer sur les branches protégées les checks `quick`, `native-tests`,
`linux` et `build` du workflow `Prototype Windows x64`. Choisir leur contexte
effectivement observé dans GitHub, exiger la branche à jour et conserver ces
quatre jobs sur chaque PR sans filtre de chemin. La politique locale ne peut
pas installer une protection de branche. Cette configuration n'est pas
activée par PAM-33 et exige l'accès/autorisation de l'administrateur.

Le workflow sécurité indépendant est filtré par chemins ; ne pas le déclarer
obligatoire sur toutes les PR sous cette forme, car une absence d'exécution
laisserait un check attendu en attente. Ses résultats et avis à analyser restent
visibles séparément ; un succès du workflow Windows ne signifie pas que le
scan de sécurité est réussi. La revue des avis de sécurité est un prérequis
supplémentaire d'un futur circuit de publication/signature.

Un futur workflow de signature/publication devra reconstruire depuis une
révision approuvée et vérifier ces checks sur ce SHA, avec un environnement
protégé et une autorisation distincte. L'existence d'un ancien artefact ou
d'un check seulement `skipped` ne suffit pas.

## Validation distante après autorisation de push

Préparer des branches de test distinctes : une révision complète valide, une
faute de format Rust, un test Rust volontairement rouge, un test UI rouge et
un paquet rendu incomplet juste avant `verify:bundle`. Ne pas intégrer ces
défauts à la branche partagée. Pour chaque scénario conserver SHA, lien du run,
résultat des jobs, étape fautive, présence des diagnostics et absence de tout
artefact de paquet après échec. Les défauts de format/Rust/UI doivent empêcher
le démarrage du packaging ; le paquet incomplet doit interdire son upload.

Le run valide doit aller jusqu'au bout et fournir l'artefact lié à son SHA.
Vérifier son manifeste et ses rapports, puis fermer les PR et supprimer les
branches de test autorisées sans fusion. Une mutation YAML locale ou une
commande locale réussie ne remplace pas cette exécution GitHub. Les liens et
résultats réellement observés appartiennent à la preuve du ticket.
