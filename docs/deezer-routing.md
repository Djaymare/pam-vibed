# Commandes Deezer et confiance

Les commandes simples Deezer sont reconnues avant Needle. La reconnaissance cible une application active munie du plugin Deezer Music et un nom ou alias non partagé. Pour Flow seulement, le nom du lecteur peut être omis si une seule fiche Deezer est active. Elle fixe l’action et les paramètres tirés de la demande, puis présente à Needle un seul outil avec une formulation anglaise courte. Le nom interne du lecteur officiel reste « Deezer Music », quel que soit le nom donné à sa fiche.

Les paramètres fixés ne sont pas générés par le modèle : la recherche conserve ses accents et sa casse, les identifiants numériques ne sont pas tronqués et les identifiants de sélection conservent leur casse. Needle valide l’action ; un paramètre ajouté, plusieurs appels ou une autre action sont refusés. Les demandes libres ou composées conservent le traitement général. Les contrôles de la demande d’origine et les limites des protocoles Deezer restent appliqués.

Le score est exactement celui de Needle pour cette action reconnue. Il ne mesure pas la fidélité de Whistle : « Dave Pink » reste une recherche de Dave Pink tant que l’utilisateur ne la corrige pas. Les préférences d’exécution et le seuil existants restent actifs. Une correction manuelle est toujours à valider et ne reçoit aucun score.

## Formulations reconnues

« Deezer » et « Diseur » doivent être des noms ou alias configurés pour le lecteur. Ils peuvent être remplacés par son nom complet.

| Fonction | Exemple |
| --- | --- |
| Ouvrir le lecteur | Ouvre Deezer |
| Reprendre, pause, suivante, précédente, arrêt | Joue Deezer ; Pause Deezer ; Piste suivante Deezer ; Piste précédente Deezer ; Stop Deezer |
| Basculer lecture/pause | Bascule lecture pause dans Deezer |
| Flow | Démarrer Flow dans Diseur ; Diseur Flow ; Démarrer Flow |
| Coups de cœur | Lire les coups de cœur dans Diseur |
| Recherche | Rechercher Daft Punk dans Diseur |
| Afficher un contenu | Afficher la chanson 3135556 dans Diseur |
| Pages | Afficher la page classements dans Diseur |
| Rechargement | Recharge Diseur |
| Afficher une sélection | Affiche la sélection smarttracklist [identifiant] dans Diseur |
| Lire une sélection | Démarre la sélection smarttracklist [identifiant] dans Diseur |

Les contenus acceptés sont chanson/titre, album, artiste, playlist, podcast, épisode et profil, avec un identifiant numérique explicite. Les huit pages sont accueil, podcasts, Explorer, classements, ambiances, radios, réglages audio et apparence. « Affiche l’accueil », « Affiche les podcasts » et « Affiche les réglages d’apparence », suivis du lecteur, sont également reconnus.

Le lecteur peut aussi précéder la commande : « Diseur, démarre Flow », « Diseur rechercher Daft Punk », « Diseur afficher la page radios ». Les noms de sélection « Diseur Flow » et « Diseur coups de cœur » suffisent. Une recherche avec le lecteur en premier conserve sa ponctuation et sa casse.

« Démarrer Flow », « Lance le Flow » et « Joue Flow » utilisent l’unique fiche Deezer active, même si d’autres lecteurs sont configurés. Plusieurs fiches Deezer actives ou un alias partagé exigent un nom unique ; aucun choix arbitraire n’est soumis au modèle. Sans plugin Deezer actif, un message demande de l’activer. Si une application s’appelle réellement « Flow », son lancement garde la priorité. Les formulations personnelles enregistrées conservent aussi leur priorité. Les recherches, pages et favoris sans lecteur restent des demandes libres.

« Opera GX Flow » ou « Démarrer Flow dans Opera GX » est refusé explicitement : une commande Flow ne devient pas l’ouverture ou la reprise d’un autre lecteur.

Les formes `cœur` et `coeur` sont reconnues. Dans une commande de lecture des favoris Deezer seulement, « coûts de cœur » est accepté comme erreur de transcription de « coups de cœur ». Aucun mot d’une recherche libre n’est remplacé par cette règle.

## Corrections personnelles

**Corriger la demande → Je voulais cette action** propose désormais Flow, coups de cœur, recherche, contenus, pages, sélections et rechargement. Pour la recherche, **Recherche à transmettre** permet de corriger l’artiste. Cocher **Mémoriser une formulation pour cette action** conserve la phrase transcrite avec la recherche corrigée. Par exemple : « Rechercher Dave Pink dans Diseur » → recherche de « Daft Punk », si c’est bien ce que l’utilisateur voulait dire.

**Préférences → Formulations personnelles** permet les mêmes associations. Une page ou un contenu peut ainsi être associé à une phrase personnelle et ses paramètres explicitement choisis. Les anciens alias de lancement et de lecture restent compatibles. Les paramètres sont vérifiés lors de l’enregistrement et à chaque requête. Un alias ne permet ni URI libre, ni effacement du cache, ni lecture d’une chanson précise, ni insertion dans la file.

## Mesures et validation

Essais du 11 octobre 2026 avec les modèles épinglés, la fiche « Deezer Music », deux lecteurs simulés et les formulations ci-dessus :

| Demande | Ancien routage dans le même profil | Nouveau routage |
| --- | ---: | ---: |
| Démarrer Flow dans Diseur | 10,88 % | 78,75 % |
| Lire les coûts de cœur dans Diseur | 10,18 %, mauvaise action | 88,57 %, coups de cœur |
| Rechercher Dave Pink dans Diseur | 24,96 % | 83,57 % |

Les scores des contenus testés vont de 73,60 à 86,59 %, et ceux des huit pages de 84,27 à 89,60 %. La bascule lecture/pause est correctement routée avec 63,45 % dans cette fixture ; une confirmation reste nécessaire au seuil de 70 %. Les scores ne garantissent pas toutes les formulations ni toutes les configurations, notamment un catalogue comportant des noms en doublon.

Les formes courtes « Démarrer Flow » et « Diseur Flow » atteignent également 78,75 % dans ce profil : elles utilisent la même action et la même formulation interne que « Démarrer Flow dans Diseur ».

`npm run test:deezer:routing` vérifie 48 cas avec le vrai modèle, dont les sept contenus, huit pages, identifiants longs, recherches Unicode, favoris mal transcrits, deux modes de sélection, alias de recherche corrigée, commandes courtes ou lecteur en premier et refus. Aucune application personnelle ni commande de lecture réelle n’est exécutée. Le rapport est dans `artifacts/deezer-routing-results.json` ; le profil temporaire est supprimé. Le même test accepte le dossier portable en argument.

`sidecar/deezer-routing.test.cjs` vérifie aussi les changements de paramètres proposés par le modèle, les autres lecteurs, les répétitions, les corrections explicites, la parité texte/vocal, la persistance et les seuils. Les commandes courtes sont testées sans plugin, avec plusieurs Deezer, un alias partagé, une application appelée Flow et des négations ou citations après le lecteur. L’interface réelle est vérifiée dans un profil isolé avec des commandes de lecture simulées.

Les [routes et limites Deezer](windows-media-deezer.md) sont inchangées : afficher un contenu ou des résultats ne lance pas une chanson précise et ne modifie pas la file.
