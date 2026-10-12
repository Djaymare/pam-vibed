# Prompt de démarrage de la chaîne

Modèle préparé, pas exécuté. Seul son envoi futur par l'utilisateur (ou une
demande humaine équivalente) démarre la chaîne. Le chat qui reçoit cette demande
effectue seulement l'amorçage et crée le premier worker ; il ne supervise pas
les tickets. Les workers suivants sont créés par leurs prédécesseurs.

```text
Démarre la chaîne de workers PAM_AUTONOMOUS_V1 dans C:\projets\pam.

Lis AGENTS.md, docs/autonomy/protocol.md, docs/autonomy/pam-queue.json et
docs/autonomy/quota-recovery.md. Vérifie d'abord qu'aucun run n'est déjà actif.
Conserve une référence vérifiable à cette demande humaine dans l'état du run.

Prépare le run selon le protocole, sélectionne le premier ticket éligible,
puis crée uniquement son nouveau chat dans le projet local PAM avec
model="gpt-6.1-sol", thinking="xhigh" et environment.type="local".
Utilise exactement le modèle docs/autonomy/worker-prompt.md en renseignant
ses paramètres. Transfère le relais à ce worker selon le protocole puis
termine ce chat. Tu n'es pas chargé de surveiller les workers suivants.

J'autorise chaque worker de cette chaîne à intégrer et valider son seul
ticket, à committer localement, à vérifier sa livraison puis à mettre sa fiche
Notion à « Terminé ». Après confirmation de cette clôture, il doit sélectionner
le premier ticket éligible restant, créer son successeur dans un nouveau chat
avec les mêmes paramètres exacts, transférer le relais et terminer son travail.
Un blocage documenté permet de passer à un ticket indépendant uniquement dans
les conditions prévues par le protocole. Aucun sous-agent ni ticket parallèle.
Cette autorisation de succession vaut pour les 40 tickets du manifeste ; une
transmission par un worker ne constitue pas une nouvelle autorisation humaine.

Réconcilie les interruptions depuis Git, Notion, les chats et l'état durable.
Une réponse ambiguë de création ne doit jamais provoquer un deuxième worker.
Le successeur attend le relais en lecture seule ; son prédécesseur ne modifie
plus le projet après transfert. Chaque chat implémente au plus un ticket.
Continue sans me demander d'approuver les décisions techniques courantes.

Si aucun ticket n'est éligible, conserve les tickets ouverts, leurs causes
de blocage et leurs conditions de reprise, puis arrête proprement la chaîne.
« Tout terminé » exige 40 livraisons validées et clôtures confirmées.

J'autorise le propriétaire courant du relais à armer une reprise dans son
propre chat au prochain reset de quota de 5 h, selon quota-recovery.md et
quota-resume-prompt.md. Cela vaut aussi pendant l'amorçage initial. Conserve
au plus une reprise en attente pour le run ; désactive celle du prédécesseur
avant chaque transfert. Une limite hebdomadaire exige ma confirmation explicite
pour chaque consommation de reset ; ce prompt ne constitue pas cette confirmation.
Si la planification est indisponible, conserve l'état et signale cette limite.

N'envoie aucun message à d'autres chats ou personnes. N'effectue aucun push,
publication, déploiement, achat ou modification de permissions implicite.
Respecte les permissions de l'environnement et les instructions humaines
ultérieures. Ne change pas de modèle ni de branche pour contourner un blocage.
```
