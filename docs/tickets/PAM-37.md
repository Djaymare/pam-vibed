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

## Blocage et reprise — tentative initiale du 18 octobre 2026

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

## Reprise du 21 octobre 2026 — génération 41

Worker `01a15f6a-941b-77f3-91a6-56ebcd99ab66`, après transfert nominatif
`deb0b6a1-85df-49e7-89bd-e39c407ed98d`. Base de reprise :
`e4c0002673daa684c34d78fe32634b5b2c5912ae`, branche `codex/deezer-routing`.
L'autorisation humaine d'origine a été relue dans son chat source ; la fiche
PAM-37 et le prérequis PAM-34 ont été relus intégralement dans Notion. PAM-34
reste « Terminé », avec son commit intégré. Les huit fichiers de contrôle
correspondent aux empreintes du run ; index et checkout étaient propres.

Le remote `origin` est maintenant `https://github.com/Djaymare/pam-vibed.git`.
Sa branche par défaut pointe sur `8c57384f0bc4f80be4290d8c179ba0c612798a9f`.
La reprise du run a été autorisée par un message humain du 21 octobre ; le
contrat transmis précise que les permissions de push précédentes ne couvrent
que trois commits de PAM-31. Elles ne constituent pas une autorisation de
nouveaux pushes PAM-37. Aucun push ni nouvelle PR de ce ticket n'a été effectué.

Le run hébergé PAM-31
[39606909360](https://github.com/Djaymare/pam-vibed/actions/runs/39606909360),
événement `push`, a été relu : conclusion globale `cancelled`, jobs Windows
natifs/build réussis dans les preuves PAM-31 ; Linux annulé après échecs connus.
Il ne constitue pas un run de PR PAM-37 ni une preuve d'annulation automatique
ou d'expiration. Aucun succès global de CI n'est annoncé.

Contrôles réellement rejoués sur la base de reprise :

| Commande | Résultat | Journal sous `artifacts/autonomy/` |
| --- | --- | --- |
| `npm run check:workflows` | 0 ; deux workflows, quatre jobs bornés sans autorité de livraison | `pam37-g41-policy.log` |
| `node --test tests/workflow-security.test.mjs` | 0 ; 27 réussis, aucun échec/ignoré | `pam37-g41-targeted.log` |
| `npm test` | 0 ; 436 réussis, aucun échec/ignoré | `pam37-g41-npm-test.log` |
| actionlint 1.7.12 sur les deux workflows et la variante de timeout | 0 | `pam37-g41-actionlint.log` |
| Propriété, empreintes, SHA-256 du contrat et ancêtre PAM-34 | Réussis ; contrat `088c493426f0a485615807321f0d9e6908176f5455d3e85ad3bc8041392b4807` | État du run et acquisition génération 41 |

Les workflows de production restent inchangés. Quatre objets commits de test
ont été préparés localement avec un index temporaire distinct, sans changer de
branche ni toucher à l'index d'intégration. Ils ne sont pas des livraisons
intégrées et ne doivent jamais être fusionnés :

| Étape | Commit préparé | Diff depuis la base |
| --- | --- | --- |
| Première PR de test | `789c59630efdece8176a4020b75dc4c3c558eb79` | Un marqueur texte |
| Deuxième push sur cette PR | `339dba7db764f6373c96e7a5b2dcd1b464d69d53` | Le marqueur mis à jour |
| PR témoin indépendante | `6a00ffd0ade6e2b8800ff462f185193bb1156778` | Un marqueur texte |
| Variante temporaire d'expiration | `cd1b72190cf2b34620c2ac781456ab1cd6c39b27` | Marqueur et variante du workflow Windows |

Le plan exact est `artifacts/autonomy/pam37-g41-probe-plan.json` ; le YAML de
test est `artifacts/autonomy/pam37-g41-timeout-variant.yml`. Les branches
proposées sont `codex/pam37-validation-g41` et `codex/pam37-control-g41`,
initialement absentes du remote. Deux PR brouillon permettraient d'observer
les permissions des vrais jobs, l'annulation du premier run par une mise à
jour de sa PR et l'absence d'annulation de la PR indépendante. La variante
conserve permissions, concurrence et checkout épinglé ; elle borne le job
natif à une minute et attend trois minutes sans lancer d'application. Les
jobs coûteux build/Linux sont exclus de cette seule variante pour les PR.
Les runs de production seraient annulés après collecte des preuves utiles.
Fermeture des PR et suppression des deux branches font partie du nettoyage
proposé ; aucune fusion, signature, publication ou modification de permissions.

Ce scénario utilise des PR du même dépôt. Il ne démontre pas les mécanismes
propres aux forks (approbation initiale et rétention des secrets). Aucun secret
de livraison n'est référencé ou transmis par ces workflows ; les limites du
scénario devront rester explicites dans la preuve distante. L'expiration
contrôlée ne sera pas présentée comme un build complet de production.

**Outcome de cette reprise : blocked, autorisation ciblée en attente.** Les
preuves distantes restent non exécutées et les critères 1, 3 et 4 restent
ouverts. La demande d'autorisation porte uniquement sur les quatre pushes
préparés, les deux PR de test, leurs runs et leur nettoyage. Les résultats
locaux et ce plan ne remplacent pas la validation GitHub requise. La clôture
Notion et la création d'un successeur attendent cette validation.
