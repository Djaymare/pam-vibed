# Modules de l’interface et du sidecar

`App.vue` compose les écrans et conserve la navigation, le focus de retour et
les deux abonnements aux raccourcis globaux. Le client `ipc.ts` et les contrats
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
| Listeners `pam-toggle-voice` et `pam-cancel-voice` | `App.vue` ; désabonnement au démontage, ou immédiatement si l’inscription se termine après celui-ci. |
| Focus modal, inert et clavier | `ModalDialog.vue` existant ; sa fermeture/démontage, avec le déclencheur mémorisé dans le shell. |

La portée Vue du composable possède ses watchers. Les politiques d’état partagé,
la conservation des brouillons entre fermetures et les évolutions du parcours
microphone restent des chantiers distincts.

## Node

| Module sous `sidecar/assistant/` | Contrat |
| --- | --- |
| `config-repository.cjs` | Dépôt de profil, empreinte attendue, modifications d’applications/formulations et disponibilité. S’appuie sur le magasin atomique existant. |
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
