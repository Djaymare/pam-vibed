# Reprise après limite d'utilisation

État au 12 octobre 2026 : règles préparées, aucune tâche planifiée active,
aucun reset consommé. Elles s'appliquent après le démarrage humain de la boucle.
Ces fichiers définissent le comportement du worker propriétaire du relais ;
ils n'installent pas un service indépendant ni un hook natif de détection de
quota. Pendant le seul amorçage, ces règles s'appliquent aussi au chat de
lancement tant qu'il détient le relais avant le premier worker.

## Capacités et limites vérifiées

Les [hooks documentés](https://learn.chatgpt.com/docs/hooks) ne proposent pas
d'événement `RateLimitReached`. Ne pas inventer cet événement ni supposer que
`Stop` intercepte systématiquement un refus pour quota.

L'outil `get_usage_limits` fournit les quotas et leurs dates de réouverture.
La documentation de l'[App Server](https://learn.chatgpt.com/docs/app-server)
décrit aussi `account/rateLimits/updated`, notification utilisable par un client
indépendant du modèle. Un tel client n'est pas installé dans ce dispositif.

Les [tâches planifiées](https://learn.chatgpt.com/docs/automations?surface=app)
permettent de reprendre un chat existant. Pour le projet local, la machine
doit rester allumée et l'application ouverte. Un quota déjà épuisé peut empêcher
l'agent de planifier quoi que ce soit : armer la reprise avant cet épuisement.
Ne pas annoncer une reprise garantie après fermeture, veille ou échec du service.

## Lecture des quotas

Le propriétaire lit `get_usage_limits` à l'acquisition du relais, avant chaque
création de successeur, après une interruption ou un reset, et après une étape
longue lorsque l'outil est disponible. Les quotas sont communs au compte, y
compris aux autres chats. Relire d'abord l'état : un ancien worker qui a transmis
le relais ne reprend aucune action de quota pour le run.

Préférer `rateLimitsByLimitId.codex` à la vue historique `rateLimits`, en vérifiant
le bucket pertinent. Identifier les fenêtres par `windowDurationMins` (300 pour
5 h, 10080 pour la semaine). Le restant est `100 - usedPercent`, borné à 0–100.
Une donnée absente n'est ni un quota libre ni un quota épuisé.

Utiliser le `resetsAt` actuel du serveur, en secondes Unix. Ne pas calculer
« maintenant + 5 h » ni réutiliser une ancienne date après un reset. Présenter
les horaires en Europe/Paris, mais conserver le timestamp pour les calculs.

## Réaction 1 — reprise au prochain reset de 5 h

1. Après création du run puis à chaque acquisition du relais, enregistrer les
   limites lues. Si la fenêtre hebdomadaire bloque déjà, appliquer la réaction 2.
2. Préparer une reprise dans le chat du propriétaire pour `resetsAt + 60 s`.
   Cette minute laisse une marge de propagation. Armer cette reprise même si
   le quota n'est pas encore épuisé, afin qu'elle existe en cas d'arrêt brutal.
3. Utiliser uniquement `automation_update`, avec une automation de type
   `heartbeat` attachée à ce chat. Vérifier les paramètres réellement acceptés
   pour cette échéance et la date effective renvoyée. L'objectif est une seule
   reprise utile ; toute récurrence résiduelle doit être désactivée au réveil.
   Ne pas remplacer cela par un cron créant d'autres chats ou modifier à la main
   les fichiers internes de l'application. Si l'échéance n'est pas programmable,
   conserver le travail et signaler que la reprise automatique n'est pas armée.
4. Chercher les automations existantes dans `$CODEX_HOME/automations/` avant
   création, par nom et prompt. Réutiliser celle de ce run et de ce chat ;
   préserver les autres paramètres. Ne pas toucher aux automations étrangères.
   Après une réponse ambiguë, réconcilier avant toute nouvelle création.
5. Enregistrer l'identifiant confirmé, l'échéance et une clé logique composée
   de runId, ownerThreadId, ownerGeneration et resetsAt. Une seule reprise peut
   être en attente pour toute la chaîne, et non une reprise par ancien worker.
   Employer le modèle `quota-resume-prompt.md`, avec des valeurs vérifiées.
6. Si la limite est atteinte, conserver réservation, checkout et preuves.
   Aucun commit incomplet ni clôture Notion ne sert à contourner la pause.
   Ne pas relancer en boucle des appels refusés. Si la coupure empêche tout
   checkpoint, la reprise reconstitue les faits depuis Git et le chat existant.
7. Au réveil, vérifier le run, le propriétaire, sa génération, l'autorisation
   de poursuivre et les quotas réels. Si le relais a changé, terminer en lecture
   seule : un réveil tardif ne rend pas propriétaire. Sinon consommer logiquement
   la clé de reprise puis désactiver l'ancienne échéance après vérification de
   sa clé. Un réveil tardif ou dupliqué
   ne doit pas désactiver une automation déjà réarmée pour une nouvelle clé,
   même si elle conserve le même identifiant. Une clé déjà traitée ou un run
   arrêté rend le réveil sans effet sur le travail. Reprendre uniquement ce chat
   et son opération interrompue : implémentation, synchronisation Notion ou
   transmission déjà préparée, selon la réconciliation de `protocol.md`.
8. Avant une nouvelle étape de travail, armer la prochaine échéance observée.
   Un ancien `resetsAt` encore passé n'autorise pas une boucle immédiate :
   signaler l'absence de date fiable et conserver l'état. Si le quota hebdomadaire
   bloque toujours, passer à la réaction 2 au lieu de répéter des réveils de 5 h.

Un réveil n'est jamais une nouvelle autorisation de commencer la boucle,
d'annuler un arrêt humain ou de changer de modèle. À la fin du run, désactiver
sa reprise en attente. Aucune surveillance périodique générale n'est installée.

## Transmission de la reprise au worker suivant

Conserver la reprise du propriétaire pendant la préparation et la création
du successeur, qui attend en lecture seule. Juste avant le transfert atomique
du relais, désactiver cette reprise et relire son état effectif. Enregistrer
sa clé comme annulée pour transmission. Une réponse ambiguë doit être résolue
avant le transfert ; ne pas supposer qu'une automation a disparu.

Le successeur arme sa propre reprise seulement après acquisition du relais.
Il n'hérite ni d'une automation attachée au chat précédent ni d'une confirmation
de reset déjà consommée. L'historique des clés et tentatives de reset reste
dans l'état du run. Une ancienne échéance déjà en cours de déclenchement doit
constater le changement de propriétaire et terminer sans modifier l'état.

Une coupure après annulation mais avant réarmement peut nécessiter une reprise
humaine dans le chat identifié par l'état. Ne pas créer un surveillant central,
une deuxième automation ou un chat de remplacement pour masquer cette limite.

## Réaction 2 — limite hebdomadaire et banked reset

La règle exposée par `mcp__codex_app__consume_usage_reset` est :
« Get explicit user confirmation for each use ». Une autorisation générale de
travail autonome ou de gestion des quotas ne suffit donc pas pour un futur reset.
Ne pas contourner cette règle via une API de niveau inférieur ou un clic UI.

Lorsque la limite hebdomadaire est confirmée, enregistrer le blocage et demander
la confirmation de consommer **un** reset à cet instant, si un reset est disponible.
La question doit préciser que cette confirmation par utilisation est imposée
par l'outil. En l'absence de réponse, ne rien consommer. Si aucun reset n'est
disponible, signaler le blocage et la date de réouverture connue sans achat.

Après cette confirmation seulement :

1. Relire les limites et les resets disponibles. L'outil exige au moins une
   fenêtre avec 10 % ou moins restants. Notre déclencheur demandé est la limite
   hebdomadaire ; ne pas dépenser un reset pour une seule limite de 5 h.
2. Enregistrer une tentative avec un UUID `idempotencyKey` et la référence à la
   confirmation humaine de cette utilisation, puis appeler `consume_usage_reset`.
3. `reset` ou `alreadyRedeemed` terminent cette tentative, même si la lecture
   suivante échoue. En cas de réponse incertaine, réutiliser exactement la même
   clé ; ne pas en générer une nouvelle pour réessayer. Une consommation réussie
   dans l'interface satisfait aussi cette demande : ne pas consommer à nouveau.
4. `noCredit` et `nothingToReset` ne consomment rien. Réconcilier les limites ;
   ne pas enchaîner les essais. Tout autre reset exige une nouvelle confirmation.
5. Relire `get_usage_limits`, puis recalculer l'échéance de reprise. Ne pas
   déduire les nouveaux pourcentages ou horaires du seul résultat du reset.

Si le quota empêche déjà l'agent d'exécuter cette séquence, la confirmation et
l'utilisation devront passer par l'interface disponible. Le dispositif ne
promet pas de pouvoir envoyer une question après le blocage complet du modèle.

## État durable et responsabilités

Dans `artifacts/autonomy/state.json`, le propriétaire conserve un objet `quota` :
date d'observation, bucket et fenêtres reçues, propriétaire/génération de la
reprise, statut, automationId, échéance, clé logique, clés traitées/annulées,
tentative de reset, référence de confirmation et résultat. Ces données restent
locales et ne contiennent aucun secret.
Les écritures suivent les règles atomiques du protocole. Une mutation échouée
ou incertaine n'est jamais enregistrée comme réussie.

Le worker propriétaire peut consulter les quotas, conserver un reçu `blocked`
de cause `quota` et gérer sa seule reprise autorisée. Il ne consomme un reset
qu'après la confirmation explicite de cette utilisation. Un successeur en
attente et un ancien propriétaire ne modifient ni quota ni état du run.
La reprise conserve le même chat et l'opération réellement interrompue, après
réconciliation du relais. Le statut Notion ne prouve pas cette propriété.
