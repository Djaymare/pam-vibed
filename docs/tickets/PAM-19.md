# PAM-19 — Préserver les brouillons

Ticket : https://app.notion.com/p/3f7b3e0422a4811aab19c519bc7cf82a

Run `c6124deb-00ca-405c-94f8-dd71183eebb3`, worker
`01a1418e-41a4-72e3-bb9a-750e640dd836`, génération 20.
Base `73df40b1fe5857b8237f941d002e58bb33874ea5`, branche
`codex/deezer-routing`. Autorisation humaine et relais nominatif vérifiés ;
checkout et index propres à l’entrée, empreintes de contrôle inchangées.
Contrat complet relu, dépendances PAM-06 et PAM-17 terminées avec preuves et
commits intégrés. Vérification effectuée par le worker implémenteur.

## Comportement

Applications, formulations et corrections comparent leur brouillon à une version
initiale. Une fiche intacte ferme immédiatement. Une fermeture qui détruirait des
modifications (bouton, clic extérieur, Échap, changement d’édition/navigation ou
Quitter PAM) demande un choix explicite. Continuer ou Échap dans la confirmation
conserve le formulaire. Abandonner ferme sans annuler les alias déjà enregistrés.
Le dialogue accessible PAM-06 est réutilisé, avec confinement au dernier dialogue
ouvert et restitution du focus au formulaire ou déclencheur.

Les préférences ont leur propre brouillon et leur erreur locale ; un rechargement
du profil après échec ne remplace plus les valeurs tentées. Préférences reste
montée lors de la navigation et conserve aussi l’éditeur de formulations. Une
notice annonce les brouillons à reprendre. Les champs restent identiques après
erreur ; les messages sont reliés aux champs et formulaires par aria-describedby.

La correction réconcilie le profil avant chaque tentative et après une erreur.
Elle distingue mémorisation constatée et nouvelle préparation encore échouée,
conserve le texte et les choix, puis désactive uniquement les demandes de
mémorisation dont l’effet identique est déjà présent. Elle utilise toujours
correct_request et ses validations métier natives ; aucune écriture alternative
de profil ne les remplace. Une lecture impossible reste un état non confirmé ;
la reprise doit relire avant de poursuivre. Un Turn failed/partial ne ferme pas
le formulaire. Les validations d’action et confirmations restent inchangées.

## Critères et preuves

| Critère | Preuves exécutées |
| --- | --- |
| Erreur moteur, clic extérieur et changement d’écran sans perte silencieuse | tests/drafts.test.mjs et 15 nouveaux contrôles WebView2 dans scripts/test-modals.mjs : clic extérieur modifié, confirmation, Échap, navigation aller-retour avec formulation longue/préférences en erreur, annonce du brouillon et garde avant quitter. |
| Saisie longue conservée après erreur moteur/sauvegarde | Comparaison exacte de tous les champs d’application, préférences et correction ; formulation et correction longues vérifiées dans le vrai DOM WebView2 après échec puis reprise. |
| Fermeture immédiate intacte et choix explicite si modifiée | Test du composable de garde et parcours natif : fiche intacte sans confirmation, fiche modifiée avec confirmation accessible, Tab/Maj+Tab confinés, Échap conserve, abandon explicite ferme et restitue le focus. |
| Correction partielle sans alias en double à la reprise | Effet de mémorisation puis erreur d’inférence, réponse de mémorisation perdue et Turn failed testés ; vraie intégration composable + sidecar + profil jetable avec moteur simulé : flags saveAlias true puis false, un alias persistant, aucune exécution. WebView2 confirme un seul effet de mémorisation après reprise explicite. |

## Contrôles

Windows x64, Node 24.21.0, npm 11.19.0, WebView2 Edge 155.

| Commande | Résultat | Trace locale |
| --- | --- | --- |
| npm test | 280/280, aucun échec ni ignoré, dont 8 nouvelles régressions | artifacts/autonomy/pam19-npm-test-final.log |
| node --test tests/drafts.test.mjs | 8/8, incluant le vrai sidecar | artifacts/autonomy/pam19-drafts-final.log |
| npm run build | Réussi, vue-tsc et Vite, 54 entrées identiques sur copie Windows | artifacts/autonomy/pam19-build-final.log et pam19-build-inputs.json |
| npm run lint et npm run format:check | Réussis sans avertissement | pam19-lint-final.log et pam19-format-final.log |
| ESLint et Prettier des quatre composants touchés | Réussis | pam19-components-lint-final.log et pam19-components-format.log |
| npm run test:modals | 63 contrôles réussis, dont les 48 antérieurs conservés | artifacts/autonomy/pam19-modals-final.log |
| Hôte WebView2 reconstruit avec Common Controls v6 | Réussi ; deux avertissements de code mort préexistants | artifacts/autonomy/pam19-modal-host-build.log |
| git diff --check, empreintes, base et intégration | Vérifiés avant clôture | reçu local PAM-19 |

Le build racine refuse le node_modules Linux préexistant, préservé ; le build
réussi utilise les mêmes sources et verrou avec les dépendances Windows isolées.
Les premières validations ont révélé une adaptation nécessaire du renderer
au style de v-show, un manifeste absent de l’hôte et deux expressions de test
mal échappées ; ces erreurs ont été corrigées, sans supprimer les assertions.
Le manifeste Common Controls a été réappliqué par le script de build existant.
Un lancement ESLint depuis la racine avec les dépendances Windows a échoué ;
le contrôle final est exécuté depuis leur répertoire Windows.

## Fichiers et limites

App.vue ; useDraftGuard/useApplicationEditor/useProfile/useProposals ; dialogues
d’application/correction et SettingsView ; DiscardDraftDialog, ModalDialog,
CommandAliases, CommandArguments ; suite de brouillons, test natif et fixture,
adaptation du renderer de récupération ; documentation des modules et cette preuve.

Conservation en mémoire pendant la vie du processus, sans journal ni stockage
de brouillons sensibles. L’arrêt brutal du processus ne promet pas une récupération
sur disque. IPC, moteur et effets externes sont simulés dans WebView2 ; le test
sidecar utilise réellement son stockage et ses validations avec un moteur simulé.
Aucun microphone matériel, application personnelle, paquet portable/NSIS ou
lecteur d’écran externe revendiqué. Aucun changement Rust/Node, contrat IPC ou
dépendance. Hôtes, serveurs et profils jetables arrêtés/nettoyés. Aucun push.
