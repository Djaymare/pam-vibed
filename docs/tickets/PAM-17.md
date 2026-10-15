# PAM-17 — États asynchrones de l’interface

Ticket : https://app.notion.com/p/3f7b3e0422a4816aa514e748e5719e49

Run `c6124deb-00ca-405c-94f8-dd71183eebb3`, worker
`01a1416d-0950-70b3-8b99-ecb3717dad65`, génération 18.
Base : `e3dd6ef73fc47378dbc765c4cfbfe7cd93ca1603`, branche
`codex/deezer-routing`. Autorisation humaine d’origine relue ; relais nominatif,
index et checkout propres à l’entrée ; fichiers de contrôle inchangés.
PAM-13 et PAM-16 sont terminés dans Notion, avec preuves et commits intégrés.
Vérification effectuée par le worker implémenteur.

## Changement

`useAsyncScope` fournit états idle/pending/success/error/cancelled, identifiant
d’opération et génération de navigation/démontage. Chaque réponse doit encore
posséder son jeton avant de modifier l’écran ou le profil. Une réservation
exclusive conserve son verrou jusqu’à la fin réelle de l’appel, même si sa
livraison a été annulée. Il n’y a aucun rejeu d’effet natif.

Les effets du profil, demandes, confirmations, corrections et tests de lancement
partagent une réservation explicite identifiée par son type. Les lectures de santé,
découverte, sessions média, sélecteur natif, transfert et diagnostic possèdent
leurs états locaux. Un rechargement explicite remplace une lecture antérieure ;
les sondages de santé simultanés sont regroupés et invalidés avant mutation.
L’éditeur invalide aussi les résultats quand le dialogue ou la cible change.
La découverte emprunte désormais le client injecté commun au profil, sans second
chemin IPC. Le client versionné et validé `ipc.ts` reste la frontière unique.

L’audio suit idle/permission/recording/finishing/cancelling. Démarrage et arrêt
acquièrent leur état avant toute attente. Annulation et démontage libèrent les
ressources et écartent permissions, diagnostics et captures périmés. Seul
process_audio affiche le traitement vocal ; demande écrite et diagnostic ont
leurs indications locales.

`useVoiceShortcuts` possède l’installation exclusive des deux événements.
Une panne partielle désabonne le groupe et affiche une erreur avec reprise ;
une inscription après démontage est libérée immédiatement sans poursuivre la
boucle. Les événements toggle espacés de moins de 300 ms sont regroupés.
Les timers audio de 1 s/29,5 s, santé 15 s et propositions 1 s gardent leur propriétaire.

Politique et API détaillées : `docs/application-modules.md`.

## Critères et preuves

| Critère du contrat | Preuve |
| --- | --- |
| Tester montage/démontage pendant appel, permission tardive, double clic, santé concurrente et panne d’inscription | 22 régressions déterministes dans tests/async-state.test.mjs, avec vrais composables Vue, promesses contrôlées et IPC simulé ; renderer réutilisable dans tests/fixtures/vue-harness.mjs. Tests antérieurs conservés. |
| Double clic et double événement n’autorisent qu’une opération | Soumission directe et formulaire, confirmation/discard, sauvegarde, lancement de test, découverte, export et aperçu du profil ; double start/finish audio ; doublon du raccourci ; assertions sur le nombre exact d’appels. |
| Réponse ancienne sans réécriture d’écran/profil après navigation | Santé ancienne face au nouveau rechargement, erreur ancienne après succès, réponse de texte après navigation, paramètres tardifs, correction tardive, sélecteur natif tardif, découverte fermée/réouverte, résultat de test après modification de saisie et aperçu d’import périmé. |
| Permission tardive, montage interrompu et listener en panne laissent un état récupérable | Permission après annulation/démontage, rejet tardif sans journal ni erreur, aucune minuterie recréée ; essai suivant réussi ; inscription partielle nettoyée puis reprise réussie ; première inscription tardive libérée sans inscrire la seconde. |

Les fixtures chargent les modules de production ; elles ne reproduisent pas leurs
algorithmes. Le chargeur de la suite de récupération existante résout maintenant
les nouveaux imports relatifs entre composables. Aucune assertion métier existante
n’est supprimée ou affaiblie.

## Validations réellement exécutées

Windows x64, Node 24.21.0, npm 11.19.0, WebView2 Edge 155.
Traces locales sous `artifacts/autonomy/`, non requises pour exécuter les tests.

| Commande / contrôle | Résultat |
| --- | --- |
| npm test | 265/265, zéro échec/ignoré ; pam17-npm-test-final.log. Les 243 tests initiaux sont conservés et 22 sont ajoutés. |
| Tests ciblés | Promesses contrôlées et renderer Vue inclus dans npm test ; le dernier scénario de reprise de santé est également dans la suite finale. |
| npm run build | Réussi sur copie Windows de 51 entrées strictement identiques ; vue-tsc et Vite, pam17-build-final.log et pam17-build-inputs.json. |
| npm run lint | Réussi sans avertissement sur les mêmes entrées Windows ; pam17-lint-final.log. |
| npm run format:check | Réussi ; pam17-format-final.log. |
| ESLint/Prettier des trois composants touchés hors périmètre historique des scripts | Réussis ; pam17-components-lint-final.log et pam17-components-format-final.log. Noms des handlers de formulations distingués des props save/remove. |
| npm run test:modals, hôte natif jetable existant | 48 contrôles réussis dans WebView2 : clavier, focus, fermeture, erreur/reprise, ajout/édition/correction et réparation/remplacement de cible ; pam17-modals.log. |
| git diff --check et contrôle des empreintes | Réussis ; aucun fichier du dispositif autonome modifié. |

Le build racine échoue avec le message de développement prévu : son node_modules
Linux ne contient pas le lanceur Windows. Cet échec est conservé dans
pam17-build-root.log. Aucun node_modules étranger n’est supprimé ou remplacé.
La copie Windows utilise le même verrou et vérifie les octets de chaque entrée.
Les premières invocations de lint/format au mauvais emplacement sont des échecs,
suivies des contrôles finaux réussis ci-dessus. Le reçu local conserve les codes
de sortie et chemins des traces.

## Périmètre et limites

Les courses, erreurs IPC, permissions micro, dialogues système et effets externes
sont simulés ; les contrôles clavier/focus utilisent réellement WebView2.
Aucune capture matérielle de microphone, commande de lecteur personnel, exécution
d’application personnelle, ni validation de paquet portable/NSIS n’est revendiquée.
Aucun changement Rust/Node, protocole IPC ou dépendance ; leurs suites unitaires
existantes passent dans npm test. Le détail matériel du micro reste PAM-24.
L’annulation ne stoppe pas rétroactivement un effet natif déjà émis.

Fichiers : App, sept composables (dont deux nouveaux), AssistantView/SettingsView,
MediaControls/ProfileTransfer/CommandAliases, régressions asynchrones et leur
renderer, résolution du chargeur de récupération, architecture et cette preuve.
Les composants touchés sont formatés avec Prettier. Aucun push ni publication.
