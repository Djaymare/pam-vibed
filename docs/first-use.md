# Votre première action avec PAM

1. Dans Assistant, utilisez **Choisir ma première application**. Choisissez une
   application Windows, ou un exécutable avec **Choisir un .exe**. Une description
   est proposée pour les applications détectées. Vous pouvez la modifier.
2. Utilisez **Tester le lancement** pour demander son ouverture, puis vérifiez
   sa fenêtre et enregistrez. Le formulaire reste disponible après un échec.
   De retour dans le guide, **Tester l’ouverture** utilise la cible enregistrée.
   Un texte, fichier ou lien est demandé si les arguments configurés en ont besoin.
3. Utilisez **Préparer ma phrase écrite**, puis envoyez la demande ; vous pouvez
   aussi dire l’exemple au microphone. Si une phrase est déjà saisie, **Reprendre
   ma phrase écrite** la conserve. Vérifiez la cible et l’effet avant de confirmer
   les propositions qui demandent une validation.

Le guide disparaît après une action effectuée dans cette session. Un test
d’ouverture réussi signifie qu’une ouverture a été demandée ; vérifiez
l’application. La disponibilité est relue et une modification de la cible
impose un nouveau test.

Le **test du microphone** dure cinq secondes, sans transcription, action ou
conservation d’audio. Un refus explique comment autoriser le micro dans les
paramètres Windows ; vous pouvez continuer à écrire. Le branchement, la
sélection de l’entrée et les autres récupérations sont décrits dans
[Microphone](microphone.md).

Si une application est indisponible, le guide propose de la réparer, de la
modifier ou de la désactiver. Sa fiche et ses formulations restent présentes.
Après réparation, réactivez-la et testez son ouverture.

## Des capacités explicites

Une application ordinaire peut être ouverte. PAM ne commande pas ses boutons
ou ses fonctions internes. Les arguments permettent seulement de transmettre
ce que l’application accepte au lancement. Les autres noms, arguments et
commandes du lecteur sont regroupés dans les options de la fiche.

Les commandes du lecteur Windows dépendent de ses capacités et de sa présence,
revérifiées avant chaque action. Les liens Deezer permettent de demander une
recherche, un contenu ou Flow ; ils ne garantissent pas le démarrage de la
lecture. Les descriptions suggérées reflètent cette configuration, sans
écraser une description personnalisée lors d’un changement d’option.

La voix et les demandes sont traitées localement. Les noms des moteurs et le
détail du lecteur sont dans **Préférences → Diagnostics des moteurs et du
lecteur**. Si l’exécution automatique est activée, une demande jugée assez
fiable peut s’exécuter sans confirmation. Un score élevé ne garantit pas le
choix correct. Le réglage et son seuil restent dans Préférences.

## Remplacer un raccourci occupé

Le démarrage continue si Windows refuse le raccourci. Le panneau de récupération
propose **Ctrl + Maj + Espace**, **Ctrl + Alt + Espace** ou **Ctrl + Maj + F9**.
Choisissez une combinaison et utilisez **Enregistrer le raccourci**. Ce même
panneau est disponible dans **Préférences → Accès rapide**.

Windows doit accepter la combinaison et PAM doit enregistrer le choix avant
de libérer l’ancienne. Un conflit ou un échec d’écriture conserve le choix
précédent et affiche une aide. La combinaison active apparaît dans la barre
supérieure et est relue au redémarrage. Le bouton du microphone et le menu de
PAM restent utilisables. Le choix est local à cette installation ; les
opérations d’import/export du profil de l’assistant ne le remplacent pas.
