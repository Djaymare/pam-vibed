# PAM-02 — Nettoyer l’audio après crash ou timeout dur

Ticket : https://app.notion.com/p/3f7b3e0422a481f5b82adb559c6dacb3

Branche : `codex/deezer-routing`. Base :
`c75a0455ebc731dee421ae0691b862d31ad9c4b3`.
Run : `c6124deb-00ca-405c-94f8-dd71183eebb3`. Worker :
`01a1306d-62f1-78e0-aff9-9ad604e2c7d7`, génération 3.
Contrat Notion relu intégralement ; aucun prérequis bloquant, condition `always`.
Vérification effectuée par le worker ayant implémenté ce ticket.

## Comportement livré

Chaque dossier de demande contient un marqueur PAM versionné avec PID, session
UUID, profil canonique et date. Son nom contient aussi PID/session. La collecte
démarre à la création de l’assistant, puis s’exécute avant chaque appel, dont
`status` et la reprise du moteur. Un propriétaire mort est collecté immédiatement
à cette occasion : rétention supplémentaire zéro. La session courante utilise
aussi un registre des demandes/écritures actives ; les autres PID vivants sont
préservés. Après une demande normale, le `finally` libère sa demande.

Les anciens dossiers `turn-XXXXXX` et `.json.UUID.tmp` ont une rétention de
**dix minutes**, puis sont collectés au démarrage/appel suivant. Les nouveaux
`.tmp` portent PID/session et sont collectés après mort du propriétaire ; les
échecs d’écriture/renommage exécutent aussi un `finally` de suppression.
Seuls les temporaires d’`applications.json` et des plans UUID dans `pending`
sont reconnus. La collecte des propositions expirées conserve son délai de dix
minutes, avec les mêmes vérifications de chemins.

Les chemins sont résolus et revérifiés avant suppression. Les liens/jonctions
sont refusés ; aucun `rm` récursif n’est utilisé par le collecteur. Seuls les
fichiers connus de la demande sont retirés, puis le dossier est supprimé s’il
est vide. Les configurations, formulations, plans récents et fichiers inconnus
restent présents. Une erreur de disque ne provoque pas de retry interne.
Le statut retourne les erreurs comptées ; Préférences les affiche. Le README
décrit la rétention et les limites réelles.

## Critères et preuves

| Critère Notion | Preuve exécutée |
| --- | --- |
| Arrêt brutal/timeout/reprise : audio absent après rétention, profil et demande active préservés | Tests `reprise après exit`, `timeout`, `kill` : enfant Node jetable, WAV/keywords/marqueur constatés après arrêt, puis absents après création d’un nouvel assistant et `status`. Configuration complète identique. Test de demande active interprocessus et locale, même avec date ancienne, puis suppression après mort de l’enfant. |
| Moteur simulé `process.exit(70)` après WAV | Fixture suivie `sidecar/fixtures/abandoned-audio.cjs`, mode `exit`, vérifie WAV/keywords puis quitte avec 70. Le test constate les fichiers avant collecte et leur absence à la reprise. |
| Timeout/crash/disque inaccessible : pas de boucle ni suppression hors profil | Mode `timeout` exécute le véritable timer de `engine.cjs`, réduit à 100 ms par l’appel de test, face à un worker simulant une inférence native bloquée. Mode `kill` termine réellement l’enfant. Test EACCES : un seul appel, résultat borné. Tests de jonctions vers un deuxième profil, y compris anciens plans expirés via `status`, conservent intégralement les fichiers externes. |
| Demandes actives, applications et formulations survivent | Enfant actif et demande locale préservés lors de deux collectes, écriture JSON active préservée avant renommage ; comparaison de la configuration avec application et formulation. Ancien dossier contenant un fichier de configuration inconnu : seul le WAV est retiré. |

Les autres régressions couvrent la rétention des anciens temporaires,
l’expiration des plans, un `.tmp` laissé par arrêt brutal du véritable writer,
et les erreurs après écriture partielle et avant renommage. Douze nouveaux tests
PAM-02 sont inclus dans la suite du dépôt, sans dépendre des anciens artifacts.

## Validation

Windows x64, Node **24.21.0**, npm **11.19.0**. Commandes depuis la racine,
sauf le build Windows isolé indiqué ci-dessous.

| Commande | Résultat réel | Sortie locale |
| --- | --- | --- |
| `npm test` | **0**, 145 réussis, 0 échec/ignoré | `artifacts/autonomy/pam02-npm-test.log` |
| `npm run test:integration` | **0**, vrais Needle/Whistle et modèles Windows, npm embarqué, confirmation/exécutable jetable et routage des alias | `artifacts/autonomy/pam02-integration.log` |
| `npm run build` dans le checkout partagé | **1**, garde correcte : dépendances Linux préexistantes, lanceur Windows absent, préservées | `artifacts/autonomy/pam02-build.log` |
| `npm ci`, puis `npm run build` dans `artifacts/pam02/windows` | **0**, installation verrouillée Windows, vue-tsc et Vite réussis | `artifacts/autonomy/pam02-windows-ci.log`, `pam02-windows-build.log` |
| Hash des sources du build isolé (`src`, `public`, `scripts`) et lockfile | Identiques au checkout livré ; lockfile SHA-256 `97e2dc5b6fcb418dec313bc8081c2dc96714ee7138b7b139342faaa009cc94ad` | Contrôle PowerShell dans le chat |
| `git diff --check` | **0** | Contrôle dans le chat |

Le premier test en sandbox a rencontré `spawn EPERM` avant exécution. La suite
autorisée avec enfants de test a ensuite réellement réussi. Les profils et
enfants de la suite sont fermés/supprimés par ses hooks ; le smoke ferme son
moteur et supprime son profil. Aucun lecteur ou application personnelle n’est
commandé. Les logs restent locaux et ignorés par Git.

## Limites explicites

Le test de timeout utilise le mécanisme réel d’arrêt du sidecar et un worker
simulé bloqué, sans bloquer volontairement une DLL native. L’intégration utilise
les vrais modèles sur un parcours normal, dont Whistle sur silence. Le processus
jetable est terminé sous Windows ; aucune nouvelle validation Rust, installateur
ou WebView2 n’est revendiquée, ces composants n’étant pas modifiés.

La collecte ne peut pas agir pendant l’arrêt de PAM ou sur un disque inaccessible.
La rétention désigne le seuil de collecte lors d’une reprise/appel, pas un service
de suppression lorsque PAM est fermé. Un PID réutilisé ou inaccessible est
conservé par prudence tant qu’il paraît vivant. Un marqueur invalide ou un chemin
redirigé reste conservé et produit une erreur de collecte. Les vérifications ne
constituent pas une protection OS contre un acteur modifiant simultanément tous
les chemins du profil. Aucun contenu audio n’est journalisé. Le transport en
mémoire reste réservé au ticket conditionnel PAM-39.

## Fichiers concernés

`sidecar/temporary-files.cjs`, `sidecar/temporary-files.test.cjs`,
`sidecar/fixtures/abandoned-audio.cjs`, `sidecar/assistant.cjs`,
`src/types.ts`, `src/App.vue`, `README.md` et ce document.
