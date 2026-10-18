# Sécurité des workflows GitHub Actions

`windows.yml` construit et teste Windows/Linux ; `security.yml` inventorie les
dépendances. Tous leurs événements, PR de fork comprise, utilisent uniquement
`contents: read`, sans référence à des secrets ni environnement de déploiement.
Checkout ne conserve pas le jeton dans la configuration Git. Ces workflows ne
signent et ne publient rien ; leurs paquets CI ne sont pas des livraisons signées.

Les quatre jobs ont des limites explicites : tests natifs 45 minutes, build
Windows 90 minutes, Linux 60 minutes, inventaire 30 minutes. Sans matrice, le
plafond configuré cumulé est 195 minutes pour un run du workflow Windows et
30 minutes pour un run sécurité. Ce sont des budgets d'exécution, pas une
garantie de durée réelle ni une limite de coût globale du dépôt. Le runner et
les services GitHub peuvent ajouter du temps de file ou de nettoyage.

La concurrence identifie workflow, événement et numéro de PR ou ref. Deux mises
à jour d'une même PR ou deux pushes d'une même branche annulent le run précédent.
Des PR différentes, les pushes et les événements manuels ne s'annulent pas entre
eux. Les runners hébergés utilisent `windows-2022` et `ubuntu-24.04` ; leurs
images restent maintenues par GitHub. Node 24.21.0 et Rust 1.99.0 sont fixés,
en accord avec `.node-version` et `rust-toolchain.toml`.

## Caches et artefacts

- Aucun cache n'est restauré ou écrit pendant une PR ou un lancement manuel.
- Les caches npm/Rust sont réservés aux pushes sur `main` ou `master`. npm
  utilise le hash du lockfile via setup-node. Rust conserve ses clés automatiques
  OS/toolchain/manifeste/lockfile/job, plus la branche et le préfixe `pam-ci-v1`.
  Il ne conserve ni target compilé, ni binaires Cargo, ni cache après échec.
- Aucun cache de modèle, profil, runtime PAM ou paquet de livraison n'est ajouté.
- Les chemins d'upload sont limités aux sorties NSIS/portable et aux preuves de
  sécurité. Le nom contient événement, run et tentative ; rétention sept jours,
  fichiers cachés exclus, écrasement refusé, absence de sortie signalée.
- Tout artefact de PR reste une sortie non fiable. Aucun workflow privilégié
  ne le télécharge ni ne l'exécute pour publier.

Un futur circuit de signature/publication devra être un workflow séparé,
déclenché explicitement sur une révision approuvée, avec environnement protégé
et secrets réservés à son seul job de signature. Limiter les droits d'écriture
au seul job qui en a besoin et reconstruire les sorties depuis cette révision.
Ne pas ajouter `pull_request_target`/`workflow_run` exécutant du code de PR,
`secrets: inherit`, ni une réutilisation privilégiée d'artefacts/caches de PR.
La création de ce circuit et la modification des permissions du dépôt demandent
une autorisation distincte ; elles ne font pas partie du durcissement actuel.

## Épinglage et mise à jour

`.github/action-pins.json` conserve dépôt officiel, référence vérifiée, commit
complet et date de vérification. Ce registre local n'est pas le format natif
de lockfile de dépendances de workflows proposé par GitHub.

Pour chaque mise à jour :

1. Lire la release, le diff du code de l'action et son `action.yml` dans le
   dépôt officiel. Contrôler runtime, entrées, actions transitives, accès au
   réseau, jetons et comportement post-job. Ne pas mettre à jour seulement le
   commentaire de version.
2. Résoudre la référence dans le dépôt officiel, par exemple
   `git ls-remote https://github.com/actions/checkout.git 'refs/tags/v4.3.1*'`.
   Pour un tag annoté, utiliser le SHA du commit déréférencé `^{}`, jamais
   l'objet tag. `Swatinem/rust-cache` v2.8.2 est un tel tag : objet
   `401aff9a7a08acb9d27b64936a90db81024cff97`, commit
   `779680da715d629ac1d338a641029a2f4372abb5`.
3. Vérifier la présence du commit et son code dans ce dépôt. Mettre à jour
   ensemble tous les `uses: owner/repo@SHA`, commentaires et le registre.
   Une branche comme `master` est seulement une source de résolution ; elle
   n'est jamais une référence exécutable dans le YAML.
4. Exécuter `npm ci`, `npm run check:workflows`, `npm test`, puis actionlint sur
   les deux fichiers. Les tests incluent des mutations : secrets, élévation de
   droits, événements privilégiés, versions flottantes, caches non fiables,
   artefacts trop larges, budgets et annulation supprimés.
5. Après autorisation de push, exécuter la validation distante ci-dessous.
   L'épinglage ne prouve pas à lui seul l'absence de vulnérabilité dans l'action.

## Validation distante avant clôture de PAM-37

Sur un dépôt de test autorisé, sans aucun secret de livraison :

1. Ouvrir une PR depuis un fork avec la révision finale. Conserver URL de PR,
   SHA, URL/ID de chaque run et logs d'initialisation des jobs montrant les
   permissions effectives du GITHUB_TOKEN. Vérifier le checkout sans credentials
   persistés et l'absence de signature/publication/d'accès à des secrets.
2. Pendant un premier run, pousser une deuxième révision de la même PR ;
   constater `cancelled` sur le premier et l'exécution du second. Vérifier aussi
   que les runs d'une autre PR ne sont pas annulés.
3. Dans une variante temporaire de test, réduire le timeout à une minute et
   ajouter une attente supérieure à cette minute. Constater la terminaison par
   timeout dans GitHub, puis supprimer cette variante. Ne pas appeler cette
   simulation une exécution complète des jobs de production.
4. Vérifier les caches absents sur PR, les noms/rétentions/chemins des artefacts
   et les limites des jobs de la révision finale. Conserver les logs ; une
   inspection YAML ou une simulation locale ne prouve pas ces faits distants.

Références : [sécurité des actions](https://docs.github.com/en/actions/reference/security/secure-use),
[syntaxe des workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax),
[cache Rust](https://github.com/Swatinem/rust-cache/tree/779680da715d629ac1d338a641029a2f4372abb5),
[artefacts](https://github.com/actions/upload-artifact/tree/ea165f8d65b6e75b540449e92b4886f43607fa02).
