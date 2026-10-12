# Prompt de reprise après quota

Modèle préparé, utilisé uniquement dans l'automation d'un run déjà démarré.
Le propriétaire du relais remplace les quatre paramètres depuis son état.
La présence de ce document n'active aucune tâche planifiée.

```text
Reprends le run PAM_AUTONOMOUS_V1 {{RUN_ID}} dans le chat propriétaire
{{OWNER_THREAD_ID}}, génération {{OWNER_GENERATION}}, après l'échéance
de quota {{RESET_AT_UNIX}}.

Relis AGENTS.md, docs/autonomy/protocol.md, docs/autonomy/quota-recovery.md et
artifacts/autonomy/state.json. Cette reprise n'autorise pas un nouveau run.
Vérifie ton identifiant réel, le propriétaire, la génération, l'autorisation
humaine et la clé runId/ownerThreadId/ownerGeneration/resetsAt.

Si le run n'existe pas ou si le relais appartient à un autre chat/génération,
termine en lecture seule. Ne crée aucun chat, ne change aucun fichier ou statut,
ne touche pas à l'automation du nouveau propriétaire. Si le run est arrêté ou
terminé, n'exécute aucun ticket ; seul le propriétaire encore identifié peut
finaliser l'annulation de sa propre reprise restante.

Une clé déjà traitée ne relance pas le travail. Réconcilie l'automation avant
toute mutation : un réveil dupliqué peut désactiver son ancienne échéance
encore active, jamais celle réarmée pour une nouvelle clé, même si l'identifiant
d'automation est identique. Ne touche à aucune automation étrangère.

Si tu es toujours propriétaire autorisé, relis les quotas. Ne consomme aucun
reset sans confirmation humaine explicite pour cette utilisation. Réconcilie
Git, Notion, l'état et toute création de successeur en attente avant d'agir.
Reprends ta phase interrompue dans ce même chat : travail de ton seul ticket,
vérification, clôture Notion ou transmission déjà préparée. Ne crée pas un
second worker pour remplacer un successeur dont la création reste incertaine.

Applique quota-recovery.md pour traiter la clé et armer la prochaine échéance
si tu dois encore travailler. Pendant une transmission, annule ta reprise
avant de céder le relais. Si celui-ci est déjà cédé, termine : il n'y a rien
à superviser depuis ton ancien chat. Un quota ne justifie jamais de sauter
une validation ou de clôturer un ticket sans preuve.
```
