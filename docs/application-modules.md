# Modules de l’interface et du sidecar

`App.vue` compose les écrans et conserve la navigation et le focus de retour.
`useVoiceShortcuts` possède les deux abonnements globaux. Le client `ipc.ts` et les contrats
de PAM-13 restent l’unique frontière Vue/Rust/Node. Aucun gestionnaire d’état
ou routeur supplémentaire n’est nécessaire.

## Interface

| Module | Responsabilité et API |
| --- | --- |
| `views/AssistantView.vue` | Voix, demande écrite et activité. Émet seulement la navigation vers les applications. |
| `views/ApplicationsView.vue` | Liste et actions d’une application ; délègue le formulaire à son contrôleur. |
| `views/SettingsView.vue` | Préférences, transfert du profil, moteurs et export de diagnostics. |
| `views/ApplicationEditorDialog.vue` | Champs, validation HTML et dialogue d’édition. |
| `views/CorrectionDialog.vue` | Champs et dialogue de correction ; aucune communication native directe. |
| `views/ProfileRecovery.vue` | Aperçu et confirmation de récupération du profil. |
| `composables/useProfile.ts` | Profil, état du runtime, récupération et paramètres ; prend un client typé et publie les snapshots de propositions reçus. |
| `composables/useApplicationEditor.ts` | Brouillon, découverte, remplacement de cible et tests de lancement explicites. |
| `composables/useRequests.ts` | Texte et soumission commune des trois types de demande. |
| `composables/useProposals.ts` | Historique, réconciliation, expiration, correction et confirmation unique. |
| `composables/useAudio.ts` | Enregistreur, niveau, durée, arrêt et annulation. |
| `composables/useAsyncScope.ts` | Génération de navigation/démontage, jetons de livraison et réservations d’opérations. |
| `composables/useVoiceShortcuts.ts` | Installation, reprise après erreur et libération des abonnements globaux ; doublons rapprochés filtrés. |

Les composables retournent des refs et des méthodes de leur fonctionnalité.
Le shell les relie une seule fois ; ses modèles réactifs sont présentés aux
vues avec des types déduits des contrôleurs. Les vues utilisent `toRefs` pour
conserver les mises à jour sans copier l’état. Les API internes de traitement
utilisent le `RequestFunction` généré et des payloads discriminés.

## Propriétaires des ressources

| Ressource | Propriétaire et fin de vie |
| --- | --- |
| Microphone, intervalle de durée, limite de 29,5 s | `useAudio` ; arrêt/annulation et démontage. Une permission tardive ne recrée pas les ressources après démontage. |
| Vérification du runtime toutes les 15 s | `useProfile` ; démontage, y compris si la première réponse arrive tard. |
| Réconciliation locale des propositions toutes les secondes | `useProposals` ; démontage. |
| Listeners `pam-toggle-voice` et `pam-cancel-voice` | `useVoiceShortcuts` ; désabonnement au démontage, immédiatement après inscription tardive, ou de tout le groupe en cas d’échec partiel. Une erreur visible permet de réessayer. |
| Focus modal, inert et clavier | `ModalDialog.vue` existant ; sa fermeture/démontage, avec le déclencheur mémorisé dans le shell. |

La portée Vue du composable possède ses watchers. La génération de navigation
est fournie au profil par le shell ; chaque opération vérifie son jeton après
ses attentes, avant toute mise à jour. Les dialogues disposent aussi d’une portée
locale qui invalide leurs lectures lors d’une fermeture ou d’un changement de cible.

## Opérations et annulation (PAM-17)

Une opération suit `idle → pending → success/error`. Navigation, fermeture ou
démontage la rendent `cancelled` et interdisent la livraison de sa réponse. Une
nouvelle demande autorisée reprend depuis `pending` avec un autre identifiant.
Chaque jeton combine génération de portée et numéro d’opération. Il n’y a aucun
rejeu automatique ni prétention d’annuler un effet natif déjà commencé.

| Opération | Politique et état local |
| --- | --- |
| Mutations du profil, soumission, correction, confirmation, test de lancement | Une réservation exclusive commune aux effets, acquise dans le handler avant le premier `await`. Son type identifie l’opération ; `busy` est une vue calculée de cette réservation, jamais assignée par plusieurs handlers. Elle reste occupée jusqu’à la fin réelle d’un effet invalidé. |
| Santé et rechargement | Les sondages simultanés sont regroupés ; un rechargement explicite remplace une ancienne lecture. Un début de mutation invalide les lectures précédentes. `loading` concerne uniquement le rechargement. |
| Découverte, sessions média, sélecteur natif, transfert et diagnostic | Réservations et erreurs locales, protégées contre les doublons ; résultats ignorés après fermeture/navigation/démontage. Un sélecteur système ouvert peut finir, sans modifier le nouveau formulaire. |
| Voix | `idle → permission → recording → finishing → idle`, ou `cancelling → idle`. Permission tardive, double arrêt et annulation pendant la capture ne recréent ni minuterie ni traitement. Les messages de traitement vocal dépendent seulement de `process_audio`. |
| Raccourcis | Inscription exclusive du groupe ; une inscription tardive est immédiatement libérée et n’en lance pas une seconde. Les événements toggle espacés de moins de 300 ms sont regroupés. |

La navigation ferme les dialogues appartenant à l’ancien écran. Les appels IPC
en cours peuvent terminer côté natif ; leurs réponses ne réécrivent pas le nouvel
écran ni le profil. Les contrôles de contrat, confirmations, limites audio et
la sérialisation Node/Rust restent inchangés. Le détail matériel du microphone
reste le périmètre de PAM-24.

## Brouillons (PAM-19)

Applications et corrections comparent le formulaire à sa valeur initiale.
`useDraftGuard` conserve la continuation de fermeture jusqu’au choix explicite
d’abandon ; Échap ou « Continuer la saisie » garde le formulaire. Le dialogue
partagé prend en charge la confirmation au-dessus d’un formulaire modal, avec
confinement du focus dans le dernier dialogue et retour au formulaire.

Préférences possède un brouillon distinct du profil enregistré. Les réponses de
santé et les sauvegardes échouées ne l’écrasent pas. SettingsView reste montée,
masquée hors de son écran : formulations, erreurs et valeurs saisies survivent
à la navigation. Une notice permet de les reprendre. Quitter PAM demande un
choix explicite si une saisie reste à enregistrer ; réduire PAM conserve la mémoire.

La correction distingue préparation/mémorisation et nouvelle inférence. Elle
relit le profil avant une tentative et après une erreur pour constater les alias
déjà enregistrés ; seules les mémorisations encore absentes sont demandées à
`correct_request`. Toutes ses validations côté sidecar sont conservées. Une
réussite partielle reste visible, sans fermer le formulaire ni rejouer une
mémorisation constatée. Si la lecture échoue, l’état reste non confirmé et la
reprise exige une nouvelle lecture. Aucun brouillon n’est journalisé ni écrit
sur disque ; la conservation dure jusqu’à l’abandon explicite ou la fin du processus.

## Node

| Module sous `sidecar/assistant/` | Contrat |
| --- | --- |
| `config-repository.cjs` | Dépôt de profil, empreinte attendue, modifications d’applications/formulations et disponibilité. S’appuie sur le magasin atomique existant. |
| `deletion-scope.cjs` | Empreinte SHA-256 canonique du périmètre confirmé, comparée avant une suppression ; aucun effet. |
| `intent.cjs` | Fonctions pures de catalogue, reconnaissance et validation des appels/cardinalités. Aucune écriture ni exécution. |
| `planner.cjs` | Préparation par Whistle/Needle et validation d’ancrage. Rend un Turn ou une décision `{ turn, execute: true }` ; ne lance aucune application. La correction explicite conserve son retrait de proposition avant préparation. |
| `executor.cjs` | Valide le plan entier, journalise avant émission, publie la progression et sérialise les effets. Conserve les issues performed/unknown/not_started et l’interdiction de rejeu. |
| `audio.cjs` | Validation WAV et borne de 30 secondes. |
| `validation.cjs` | Petites préconditions partagées. |

`assistant.cjs` reste le dispatcher public et conserve ses exports existants.
Il possède le budget global et les magasins de propositions ; il applique la
décision du préparateur, puis appelle l’exécuteur. Le préparateur possède et
libère le bail des fichiers d’inférence avant de rendre le plan. Les confirmations,
versions IPC, contrôles de cible et lancements sans shell sont conservés.

Les ressources Tauri incluent le répertoire extrait et la fermeture transitive
des dépendances de production. Les tests démarrent aussi un arbre de ressources
copié dans un répertoire jetable, sans importer le checkout.

## Vérification et formatage

`npm test`, `npm run build`, `npm run lint` et `npm run format:check` vérifient
respectivement les comportements, types/build, règles ESLint et mise en forme.
`npm run format` applique Prettier. Le lint et le format couvrent le shell,
les modules extraits et leurs écrans ; le code généré et les fichiers antérieurs
sans rapport ne sont pas reformattés. Les dépendances sont verrouillées ; aucune
version préexistante du verrou n’a changé lors de leur ajout.

La mise en forme est mécanique et contrôlée séparément. La revue de PAM-16
compare l’arbre syntaxique de vingt fonctions Node avant/après extraction ;
leurs instructions sont identiques. Les adaptations fonctionnelles concernent
le raccordement des modules, la fin de vie des ressources et le contrat courant
des fixtures WebView2. Les assertions de parcours existantes sont conservées.

Pour les parcours Windows : construire l’hôte jetable avec
`node scripts/build-modal-test-host.mjs`, puis utiliser `PAM_MODAL_TEST_HOST`
et `npm run test:modals`. `PAM_TEST_DEPENDENCY_ROOT` permet des dépendances Windows
isolées ; `PAM_TEST_SOURCE_ROOT` permet de rejouer exactement la même suite sur
une copie de référence. Ces tests simulent les services natifs et n’utilisent
aucune application personnelle.
