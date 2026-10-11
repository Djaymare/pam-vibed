# Commandes multimédias et erreurs de transcription

PAM reconnaît les commandes ci-dessous avant de soumettre à Needle un ordre court avec l’unique outil correspondant. Le texte ou la transcription original reste affiché ; la confiance reste le score brut de Needle et les préférences de confirmation continuent à s’appliquer.

## Formulations reconnues

Le nom du lecteur peut précéder ou suivre l’action. Les noms et alias viennent des fiches **Applications** : « Diseur » doit être un alias de Deezer. La casse, les accents, la ponctuation finale et les variantes de genre/pluriel des pistes sont acceptés.

| Action | Exemples |
| --- | --- |
| Piste suivante dans la file actuelle | `Diseur piste suivante`, `Prochaine piste sur Diseur`, `Diseur prochain piste`, `Passe à la chanson suivante dans Deezer` |
| Piste précédente | `Diseur piste précédente`, `Précédente chanson sur Deezer` |
| Pause | `Mets Deezer en pause`, `Mais Diseur empose`, `Mais pose sur Diseur`, `Pose Diseur`, `Pause le média dans Diseur` |
| Reprendre la lecture | `Joue Diseur`, `Diseur reprends la lecture`, `Play sur le navigateur` |
| Arrêter | `Arrête la musique dans Deezer`, `Stop Diseur` |
| Basculer lecture/pause | `Diseur bascule lecture / pause` |

`Pause`, `pose`, `empose` et `pauiser` ciblent la **pause**. Si cette capacité manque, PAM signale son indisponibilité. Il ne substitue pas un arrêt, une reprise ou l’ouverture d’une application. Les noms inconnus ou partagés demandent une précision. Une application désactivée ou sans commande multimédia reste indisponible. Un nom d’application littéral comme « Pause » conserve son sens de lancement.

## Commandes sans lecteur

`Prochaine piste`, `Prochaine chanson`, `Passe la chanson`, `Mais le média en pause`, `Pause le média`, `Pauiser`, `Lecture`, `Piste précédente`, `Stop` et `Bascule lecture / pause` sont reconnues.

Selon le choix de l’utilisateur, PAM cible automatiquement **l’unique lecteur configuré et activé ayant une session Windows disponible**. Une session déjà en pause compte aussi : le ciblage ne repose pas uniquement sur l’état « en lecture ». Les lecteurs configurés avec une session disponible comptent même lorsqu’ils ne proposent pas l’action demandée ; PAM ne choisit pas un autre lecteur sur cette seule base.

Avec plusieurs lecteurs, PAM demande d’en préciser le nom dans la commande. Sans lecteur disponible, il invite à ouvrir un média et vérifier ses sessions. Plusieurs sessions du même identifiant empêchent aussi le choix. Aucune session Windows « courante » ou dernier lecteur utilisé ne sert de cible implicite. Les capacités et l’identité de la session sont revérifiées avant l’exécution.

## Enseigner une erreur de transcription

Une transcription comme `Des heures prochaines pistes`, `Pose sur dix heures` ou `Pause au Dieu` ne suffit pas à identifier Deezer. PAM ne remplace pas globalement ces mots par un nom de lecteur. Une phrase sans action reconnue comme `Tous médias` ou `Pour ça` ne justifie pas l’ouverture d’EA ni une commande de lecture.

Pour mémoriser une formulation :

1. Cliquer sur **Corriger la demande** dans l’activité récente.
2. Dans **Je voulais cette application** et **Je voulais cette action**, choisir par exemple **Deezer Music → Passer à la piste suivante**.
3. Cocher **Mémoriser une formulation pour cette action** et conserver la phrase complète mal transcrite dans **Formulation à reconnaître**, par exemple `Des heures prochaines pistes`.
4. Cliquer sur **Préparer la correction**, puis confirmer l’action proposée.

La formulation se retrouve aussi dans **Préférences**, où elle peut être modifiée ou supprimée. Elle s’applique à cette phrase complète en texte et en vocal. Les formulations personnelles ont priorité sur le ciblage implicite ; elles conservent le lecteur explicitement choisi. Les négations, citations et collisions avec une autre commande native restent refusées. Les variantes mal transcrites `pose/mais/empose` peuvent être personnalisées. Le nom d’un artiste dans une recherche n’est jamais corrigé arbitrairement.

Les commandes composées et les autres formulations libres restent soumises au modèle et aux vérifications de la demande. Une négation ou une proposition pour une autre application ne peut pas être exécutée. Les [limites des protocoles Deezer](windows-media-deezer.md) restent inchangées : la piste suivante lit l’élément déjà dans la file ; aucune lecture d’une chanson précise ou insertion de celle-ci n’est proposée.

## Validation

`npm test` couvre les exemples des captures, les négations, citations, mauvais lecteurs/actions, paramètres inventés, appels répétés, capacités manquantes, absence/ambiguïté des sessions et les formulations persistées en texte et en vocal.

`npm run test:media:commands -- <dossier-portable>` utilise Needle réellement, avec un profil et des sessions de test isolés. Les hooks d’exécution interdisent toute commande à un lecteur personnel. Le rapport est enregistré dans `artifacts/media-commands-results.json`. Ce test vérifie le routage d’un texte déjà transcrit ; il ne mesure pas la qualité acoustique de Whistle.

Validation du **11 octobre 2026** sur `artifacts/PAM-windows-media-commands` : **124 tests automatisés**, **65 contrôles média**, **48 contrôles Deezer** et **36 contrôles de confiance/formulations** réussis. Le paquet Windows x64 et le démarrage de son sidecar avec `PATH` vide sont vérifiés. Les commandes Deezer de piste suivante ont obtenu **80,66 %** et celles de pause **78,13 %** dans ce profil. Piste précédente et bascule restent autour de **63 %** et continuent donc à demander confirmation au seuil par défaut de 70 %. Ces scores observés ne garantissent pas ceux de tous les profils.
