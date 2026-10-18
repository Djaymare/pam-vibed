# PAM-37 — durcissement des workflows GitHub Actions

- Fiche : https://app.notion.com/p/3f7b3e0422a481aea5afd095f201a409
- Run : `c6124deb-00ca-405c-94f8-dd71183eebb3`.
- Worker : `01a14e59-07d2-70d0-85be-49d69c439f56`, génération 37.
- Branche : `codex/deezer-routing`.
- Base : `91d91e8cbe9c15825e82f65a90f602263b711310`.
- Environnement : Windows x64, Node 24.21.0, npm 11.19.0 ; 18 octobre 2026.
- Prérequis PAM-34 : fiche intégralement relue, « Terminé », preuve et commit
  `6acefc795ee3185c62635b43f579ac65df1ac796` présents dans la branche.
- Outcome : **blocked**, uniquement sur la validation GitHub distante obligatoire.
  L'implémentation locale complète est conservée avec ses contrôles réussis.

## Modifications et preuves locales

Les deux workflows existants, Windows/Linux et suivi de sécurité, utilisent
les commits complets de cinq dépôts d'actions officiels. Les références sont
résolues par `git ls-remote`, chaque SHA est confirmé comme objet commit par
l'API GitHub du dépôt officiel et son `action.yml` est accessible à ce SHA.
Le tag annoté rust-cache est déréférencé vers son commit, au lieu d'utiliser
l'objet tag. Le registre `.github/action-pins.json` et `docs/ci-security.md`
documentent origines, mise à jour et limites de l'épinglage.

Node 24.21.0 et Rust 1.99.0 restent alignés sur les fichiers du projet. Les
runners hébergés ont une version d'OS explicite, tout en restant des images
maintenues par GitHub. Permissions héritées `contents: read` pour tous les jobs,
aucune élévation, référence à un secret ou environnement de déploiement.
Checkout utilise `persist-credentials: false`. Aucun circuit de signature ou
publication n'est ajouté ; les règles de sa future séparation sont documentées.

Les limites sont 45 minutes pour les tests natifs, 90 pour le build Windows,
60 pour Linux et 30 pour la sécurité. La concurrence groupe workflow,
événement et PR/ref, avec annulation du run antérieur. Les PR différentes
restent distinctes. Cette configuration ne prouve pas encore un timeout ou une
annulation effectivement constaté dans le service GitHub.

Les caches npm/Rust sont réservés aux pushes sur main/master ; aucune
restauration/écriture en PR ou en lancement manuel. Rust isole branche/job et
ne conserve ni target compilé, ni binaires Cargo, ni cache après échec. npm
utilise package-lock.json. Les artefacts portent événement, run et tentative,
avec rétention sept jours, fichiers cachés exclus et chemins de sortie précis.
Aucun job privilégié ne consomme les sorties de PR.

`check:workflows` lit réellement le YAML avec `yaml` 2.9.1 (dépendance de
développement exacte, intégrité dans le lockfile), refuse clés dupliquées et
alias, vérifie versions, SHA connus, permissions, événements, caches, artefacts
et budgets. Il s'exécute dans les workflows après installation verrouillée.
Les tests sont autonomes et versionnés ; ils ne dépendent d'aucun artefact local.
Vingt-quatre mutations adverses, plus la lecture des workflows réels et le
refus de YAML ambigu, donnent 26 tests ciblés. Ils sont inclus dans `npm test`.
Ce garde-fou local ne remplace ni les protections du dépôt GitHub ni une revue
des changements de workflow ; un auteur peut aussi proposer de modifier sa
politique et ces modifications doivent être revues.

## Critères d'acceptation

| Critère exact du contrat                                                                                                                 | État et preuve                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Une PR non fiable n'accède pas aux secrets de publication ; les versions exécutées et la consommation maximale d'un job sont maîtrisées. | Configuration et régressions locales prouvées : SHA complets, budgets 45/90/60/30, aucun secret, jeton en lecture seule. **Non entièrement satisfait** : permissions effectives et run de PR non vérifiés sur GitHub.                                    |
| Le workflow référence des versions immuables et la toolchain attendue.                                                                   | **Satisfait** pour les références exécutables des actions et les toolchains du projet : cinq commits officiels confirmés, Node/Rust concordants, contrôle YAML et actionlint réussis. Les images de runner et paquets OS ne sont pas déclarés immuables. |
| Une PR n'accède pas aux secrets de livraison et les droits d'écriture sont limités au job nécessaire.                                    | Aucun de ces jobs CI n'a besoin de droits d'écriture ; tous héritent `contents: read`, sans secret ni publication. **Non entièrement satisfait** : contrôle effectif dans un run de PR encore absent.                                                    |
| Deux pushes successifs annulent les builds obsolètes concernés et un job bloqué expire.                                                  | Groupe et limites vérifiés dans les deux YAML, mutations retirant annulation/budgets refusées. **Non satisfait à distance** : aucun run annulé ni expiré observé.                                                                                        |

## Commandes réellement exécutées

Les journaux locaux sont sous `artifacts/autonomy/` ; ce document versionné
conserve les résultats. Les SHA de livraison sont dans le reçu distinct.

| Commande                                                                           | Résultat                                                           | Journal                    |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------- |
| Vérification des cinq références officielles, objets commits et sources action.yml | 0, cinq vérifiés, dont rust-cache `^{}`                            | `pam37-pins.json`          |
| `npm ci`                                                                           | 0, installation verrouillée, audit npm sans avis                   | `pam37-npm-ci.log`         |
| `npm run check:workflows`                                                          | 0, deux workflows et quatre jobs bornés sans autorité de livraison | `pam37-policy.log`         |
| `node --test tests/workflow-security.test.mjs`                                     | 0, 26 réussis, aucun échec/ignoré                                  | `pam37-targeted.log`       |
| `npm test` après installation verrouillée                                          | 0, **435 réussis, 0 échec, 0 ignoré**                              | `pam37-npm-test-final.log` |
| `npm run build`                                                                    | 0, contrôle des bindings Windows, TypeScript et Vite réussis       | `pam37-build-final.log`    |
| `actionlint.exe .github/workflows/windows.yml .github/workflows/security.yml`      | 0, aucune erreur de syntaxe/sémantique Actions signalée            | `pam37-actionlint.log`     |
| Prettier sur YAML, registre, checker, tests et documentation                       | 0                                                                  | `pam37-format.log`         |
| `git diff --check` et relecture du diff/index explicite                            | 0 ; fichiers de contrôle inchangés                                 | `pam37-diff-check.log`     |

actionlint 1.7.12 provient de la release officielle, archive Windows amd64
vérifiée avant extraction/exécution avec SHA-256
`6e7241b51e6817ea6a047693d8e6fed13b31819c9a0dd6c5a726e1592d22f6e9`.
Il valide le YAML et les expressions ; il n'exécute pas le service GitHub.

## Blocage restant et reprise

Le contrat exige un run de PR de test sans secret et la vérification des
permissions effectives, de l'annulation et de l'expiration. **Aucun remote Git
n'est configuré** (`git remote -v` vide). La demande humaine de lancement
exclut les pushes/publications et ne fournit pas de dépôt de test autorisé.
Aucun push, création de PR ou déclenchement de workflow distant n'est réalisé.
Les tests locaux ne sont pas présentés comme cette validation distante.

Reprise : disposer d'un dépôt/runner GitHub autorisé avec cette livraison,
réaliser la procédure de `docs/ci-security.md`, conserver liens de runs/SHA/logs
montrant permissions, annulation et timeout, puis réconcilier avant clôture.
Le ticket reste ouvert en pause. Le même worker a vérifié sa livraison locale ;
aucune revue indépendante n'est revendiquée.

Aucun changement Rust, moteur, transport audio ou packaging n'est livré : les
suites natives, modèles et paquets ne sont pas reconstruites pour ce changement
de configuration CI. Les jobs Windows/Linux complets hébergés n'ont pas été
exécutés. Aucun profil, audio ou programme personnel n'est utilisé.

## Fichiers concernés

`.github/workflows/windows.yml`, `.github/workflows/security.yml`,
`.github/action-pins.json`, `scripts/check-workflows.mjs`,
`tests/workflow-security.test.mjs`, `package.json`, `package-lock.json`,
`docs/ci-security.md` et ce document. Aucun fichier du dispositif autonome n'est
modifié.
