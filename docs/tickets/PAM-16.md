# PAM-16 — Modules Vue et cœur Node

Ticket : https://app.notion.com/p/3f7b3e0422a481f9a5a5cd6d94d9965f

Run `c6124deb-00ca-405c-94f8-dd71183eebb3`, worker
`01a13eb1-3ec1-7673-988e-a325ee2e5f9d`, génération 17.
Base : `2eb6ddf38ff508191b1389d9b1520d43fa61740c`, branche
`codex/deezer-routing`. Autorisation humaine d’origine relue, relais nominatif
confirmé, index et checkout propres à l’entrée, empreintes de contrôle identiques.
PAM-13 est terminé dans Notion et son commit est intégré. Cette vérification est
effectuée par le worker implémenteur.

## Livraison

Le shell Vue passe de 49 757 à 8 952 octets. Trois vues, deux dialogues de
formulaire et la récupération du profil sont extraits ; cinq composables
possèdent le profil, l’éditeur d’application, les demandes, les propositions et
l’audio. Les abonnements globaux restent dans le shell. Types et client IPC de
PAM-13 sont réutilisés. Aucun changement de politique d’état de PAM-17.

Le dispatcher Node passe de 48 339 à 9 810 octets. Les modules sous
`sidecar/assistant/` isolent dépôt/édition du profil, reconnaissance pure,
préparation, exécution, validation WAV et préconditions. Le préparateur ne peut
pas lancer une application ; il rend un plan ou une décision d’exécution au
dispatcher. L’exécuteur conserve validation complète, journal avant émission,
progression, résultats partiels et interdiction de rejeu. Le bail de fichiers
d’inférence est libéré à la sortie du préparateur, avant exécution du plan.

ESLint pour Vue/TypeScript/CommonJS et Prettier sont ajoutés avec leurs commandes
de vérification. Leurs dépendances sont verrouillées ; aucune version déjà
présente du verrou ne change. Le formatage mécanique est vérifié séparément
des comportements : comparaison syntaxique des vingt fonctions Node déplacées
(`ensure` jusqu’à `executeCalls` et `infer`), toutes identiques hors présentation.
Les raccordements et fins de vie sont vérifiés par les tests.

La fermeture transitive des ressources sidecar est déclarée dans Tauri, y
compris les dépendances de profil/journal jusque-là absentes de sa liste.
Le vérificateur de paquet exige les nouveaux fichiers. Une copie jetable de
l’arbre déployé démarre réellement, sans import depuis le checkout.

Architecture et API : `docs/application-modules.md`.

## Critères et preuves

| Critère | Preuve |
| --- | --- |
| Une modification de formulaire/routage s’évalue dans un module limité ; les tests métier restent verts | Formulaires dans `views/*Dialog.vue` et `useApplicationEditor`/`useProposals`, reconnaissance dans `assistant/intent.cjs`, préparation dans `planner.cjs`. Les 235 tests initiaux sont conservés ; suite finale 243/243. |
| Un module identifiable concentre chaque formulaire ou règle de routage | Frontières et API documentées ; tests directs de reconnaissance pure, préparateur sans effet et validation du plan entier avant tout effet. Les vingt fonctions Node déplacées ont un arbre syntaxique inchangé. |
| Suites existantes sans modification opportuniste des attentes | 243 tests, intégration Whistle/Needle réelle, 32 cas de confiance et 4 contrôles de formulations, 48 contrôles Deezer, 65 média. Assertions de parcours conservées. Les mêmes 48 contrôles WebView2 passent sur l’ancien App.vue et sur les écrans extraits. |
| Propriétaire clair des abonnements, ressources audio et timers | `useAudio` possède l’enregistreur et ses deux timers ; `useProfile` la vérification 15 s ; `useProposals` le timer 1 s ; App les deux listeners. Régressions de démontage, permission tardive et abonnement tardif, avec identifiants de timers distincts. |

Le renderer mémoire charge maintenant les vrais composables et vues extraits.
Il remplace seulement les services natifs et composants sans rapport. Le
repérage d’un bouton normalise les espaces rendus par le formatage, sans changer
les assertions métier. La fixture WebView2 a été remise au contrat IPC courant
(enveloppe/version/corrélation, champs requis et erreurs structurées), puis un
test de contrat de cette fixture a été ajouté. Les attentes clavier/focus n’ont
pas été réduites.

## Validations exécutées

Windows x64, Node 24.21.0, npm 11.19.0, hôte MSVC natif construit avec manifeste
Common Controls, WebView2 Edge 155. Les profils, catalogues et effets sont jetables
ou simulés. Traces locales sous `artifacts/autonomy/`.

| Contrôle | Résultat et trace |
| --- | --- |
| `npm test` avant extraction | 235/235, `pam16-baseline.log` |
| `npm test` final | 243/243, aucun échec/ignoré, `pam16-npm-test-delivery.log` |
| `npm run build` Windows isolé | vue-tsc et Vite réussis ; 49 entrées copiées à l’identique, `pam16-build-delivery.log`, `pam16-build-inputs.json` |
| `npm run lint` | Réussi sans avertissement, `pam16-lint-delivery.log` |
| `npm run format:check` | Réussi, `pam16-format-delivery.log` |
| `npm run test:confidence` | 32 cas et 4 formulations corrects, `pam16-confidence.log` |
| `npm run test:deezer:routing` | 48 contrôles corrects, `pam16-deezer.log` |
| `npm run test:media:commands` | 65 contrôles corrects, `pam16-media.log` |
| `npm run test:integration` | Whistle/Needle réels et exécutable Node jetable, `pam16-integration.log` |
| Hôte WebView2 puis `npm run test:modals` | 48 contrôles actuels, `pam16-modal-host-build.log`, `pam16-modals-current.log` |
| Même suite sur copie de l’App.vue de départ | 48 résultats identiques, `pam16-modals-baseline.log`, `pam16-before-after.json` |
| Modules et ressources déployées | 5 tests, inclus dans npm test ; `pam16-modules-deployed.log` |
| Revue syntaxique mécanique et diff | 20 fonctions identiques, `pam16-mechanical-review.json` ; `git diff --check` réussi |

Le build racine refuse le node_modules Linux préexistant ; sa trace
`pam16-build-root.log` est un échec, pas un succès. Le build équivalent Windows
utilise le même verrou et les mêmes entrées ; aucun node_modules étranger
n’est remplacé. Les premières tentatives WebView2 ont détecté un ancien hôte
sans manifeste puis une fixture IPC périmée. L’hôte reconstruit et la fixture
validée donnent les 48 succès avant/après.

## Limites et fichiers

Le microphone et les services natifs des parcours UI sont simulés ; les
contrôles clavier/focus utilisent réellement WebView2. Les suites de routage
utilisent Needle réel avec effets simulés ; l’intégration lance uniquement un
Node jetable. Le smoke de ressources déployées valide imports et démarrage,
avec runtime volontairement absent. Aucun paquet portable/NSIS complet,
signature ou nouvelle validation Rust globale n’est revendiqué : aucun code
Rust n’est modifié. Le protocole autonome est inchangé.

Fichiers : App, cinq composables et six vues/dialogues, dispatcher et six modules
Node, régressions de modules/ressources/renderer/fixture, fixture et outil de
comparaison WebView2, configuration ESLint/Prettier, manifestes npm, ressources
Tauri et vérification du paquet, documentation d’architecture et cette preuve.
Aucun programme personnel commandé, push ou publication.
