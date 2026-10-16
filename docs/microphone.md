# Microphone : choix, test et récupération

Dans **Assistant → Votre microphone**, le test dure cinq secondes. Parlez et
regardez le niveau : à la fin, PAM indique si un signal a été détecté puis coupe
le microphone. Ce test n’effectue aucune transcription, aucune demande au moteur
et aucune action. Il ne conserve pas les échantillons audio. Il est disponible
avant l’ajout d’une application et sans attendre le chargement des modèles.

Si plusieurs entrées sont disponibles, choisissez **Entrée audio**. Le choix
reste uniquement dans cette session de PAM ; aucun identifiant matériel n’est
ajouté au profil. **Microphone par défaut de Windows** utilise l’entrée par
défaut au démarrage de la prochaine capture. **Actualiser les entrées** ne
déclenche pas de demande de permission ni de capture.

Une entrée choisie qui disparaît reste signalée comme indisponible. PAM ne
démarre pas silencieusement sur une autre entrée. Rebranchez-la, actualisez les
entrées ou choisissez-en une autre, puis testez-la avant une nouvelle demande.
Il n’est pas nécessaire de restaurer ou de recharger le profil d’applications.

Un refus d’accès, un microphone occupé, une piste interrompue, un débranchement
ou une suspension audio affichent une aide. Vérifiez le branchement, le bouton
muet, l’autre application utilisant le micro et les permissions de microphone
pour PAM. Après veille ou suspension, relancez vous-même le test : PAM ne reprend
jamais automatiquement une capture interrompue.

**Annuler**, **Masquer**, la fermeture de la fenêtre et le démontage de
l’interface invalident la capture en cours. Une demande de permission système
peut encore être en attente : répondez-y manuellement. Une acquisition accordée
après annulation est fermée dès sa réception, sans démarrer d’enregistrement ni
envoyer de demande. Un test peut être arrêté à tout moment.

Les demandes vocales restent bornées à trente secondes par le Worklet et le
WAV conserve ses validations existantes. Les pistes sont arrêtées avant le
rééchantillonnage et l’envoi. Une demande déjà envoyée au moteur peut avoir
produit des effets ; l’annulation audio ne les annule pas rétroactivement.

Les régressions déterministes sont incluses dans `npm test`. Le parcours réel
Windows utilise `scripts/test-microphone.mjs`, un `pam.exe` de développement
fraîchement compilé, les dépendances Windows et un profil jetable. Il observe
les pistes et les événements natifs ; seuls les services métier du panneau de
test sont simulés. Les refus et accords de permission, le retrait physique et
la veille nécessitent une personne. Les traces de test contiennent des états et
des métadonnées WAV, jamais l’audio.
