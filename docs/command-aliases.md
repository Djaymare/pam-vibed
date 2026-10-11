# Formulations personnelles

Une erreur récurrente de transcription peut être enregistrée comme une phrase complète associée à une application et une action. Cela évite de corriger seulement le nom de l’application lorsque « pose le navigateur » signifie « mettre le navigateur en pause ».

## Utilisation

Depuis une demande, ouvrir **Corriger la demande**, choisir l’application et **Je voulais cette action**, puis cocher **Mémoriser une formulation pour cette action**. Le champ propose la transcription d’origine. La correction prépare directement l’action choisie, sans inférence ni score de confiance, et exige sa validation. Enregistrer une formulation ne commande pas le lecteur.

**Préférences → Formulations personnelles** permet aussi l’ajout, la modification et la suppression. Exemples pour un navigateur associé à sa session Windows :

| Phrase mémorisée | Action |
| --- | --- |
| pose le navigateur | Mettre en pause |
| mais le film en pose | Mettre en pause |
| play sur le navigateur | Reprendre la lecture |

Chaque association cible une application précise. Un autre lecteur exige sa propre formulation. Les actions disponibles sont l’ouverture, lecture, pause, piste suivante, piste précédente, arrêt et bascule lecture/pause. Les actions multimédias exigent une session configurée dans la fiche de l’application. Les protocoles Deezer restent limités à ceux déjà vérifiés ; cette fonction n’ajoute ni lecture d’une chanson précise ni insertion dans la file.

## Reconnaissance et persistance

Les demandes écrites et les transcriptions vocales utilisent la même résolution. La correspondance porte sur la phrase entière, après normalisation de la casse, des accents, des apostrophes typographiques, des espaces répétés et des points, points d’exclamation ou d’interrogation finaux. Aucun remplacement global de « pose » ou « mais » n’est effectué ; un préfixe, une autre phrase ou une négation ne correspond pas à la règle.

La phrase reconnue sélectionne l’action et l’application présentées à Needle. Le prompt interne est formulé comme les autres commandes simples, tout en conservant la transcription originale à l’écran. Le score affiché reste celui renvoyé par Needle et les préférences de confirmation restent actives. Aucun score n’est garanti pour une formulation nouvelle.

Les associations sont stockées dans `commandAliases` du fichier `%APPDATA%\com.enkis.pam\applications.json`. Les anciens profils sont lus sans réécriture. Une formulation possède un identifiant, une phrase de 200 caractères maximum, l’identifiant de l’application et l’action. La limite est de 64 formulations. Les expressions régulières, paramètres de commandes et actions arbitraires ne sont pas acceptés.

Les doublons après normalisation, négations, commandes citées, mauvaise application explicitement nommée et conflits avec les déclencheurs existants sont refusés. L’action peut être apprise alors que le lecteur est déjà en pause. Lors d’une demande ultérieure, une application inactive, une session absente ou une capacité indisponible produit un refus explicite. La commande n’est pas redirigée vers l’ouverture ou un autre lecteur. La capacité est revérifiée au moment de l’exécution.

Une modification ou suppression invalide les anciennes propositions à confirmer. Supprimer une application supprime ses formulations. L’échec de l’enregistrement pendant une correction laisse l’ancienne proposition disponible.

## Validation

`sidecar/command-aliases.test.cjs` couvre la correction explicite, la persistance, la parité texte/vocal, les variantes normalisées, l’ajout/modification/suppression, les collisions, les demandes négatives ou citées, les applications inactives, les capacités absentes, les anciennes configurations et la conservation des entrées `{input}`.

`npm run test:confidence` utilise le vrai modèle Needle avec des sessions simulées : apprentissage et routage de « Pose le navigateur » et « Mais le film en pose », refus de la négation, modification vers la lecture et suppression, en plus des 32 cas de commandes existantes. Aucun lecteur personnel n’est commandé. Le parcours d’interface est vérifié dans un profil isolé avec le vrai sidecar, les vrais modèles et des commandes de lancement et de lecture simulées.
