# PAM-32 — Composants Vue, IPC simulé et parcours WebView2

Ticket : https://app.notion.com/p/3f7b3e0422a481d485cef879ec617f94

Run `c6124deb-00ca-405c-94f8-dd71183eebb3`, worker
`01a14d46-9a9c-7593-8f6e-64c9b3b621d7`, génération 34.
Base : `8138715a14f37a30763c3bb06d2d58e41e109eb6`, branche
`codex/deezer-routing`. Vérification par le worker implémenteur.

Autorisation humaine d’origine relue dans son chat, transfert nominatif et
génération vérifiés avant écriture. Checkout/index initialement propres,
empreintes du dispositif inchangées. PAM-07, PAM-17, PAM-23 et PAM-24 sont
Terminé dans leurs fiches intégrales ; leurs reçus, preuves et commits sont
présents et intégrés. PAM-31 reste indépendant, en pause sur sa preuve CI.

## Livraison

Trois commandes stables complètent npm test : `npm run test:components`,
`npm run test:webview` et `npm run test:webview:cleanup`. Instructions,
environnement, couverture et limites : `docs/frontend-tests.md`.

Les nouveaux parcours utilisent les vrais composables et TurnCard Vue, le vrai
client ipc.ts, sa validation des contrats et invoke avec mockIPC officiel Tauri.
Ils contrôlent le nombre exact d’émissions et les effets observables : succès,
timeout structuré, saisie conservée après erreur, navigation/démontage avant
succès ou erreur, confirmation incertaine sans rejeu, expiration, invalidation,
indisponibilité du runtime, correction, sauvegarde et suppression explicite.
Le renderer possède désormais tous ses montages ; une régression vérifie son
démontage idempotent et l’absence de minuteries résiduelles. Les fixtures de
statut et de demande possèdent les champs requis par le contrat de production.

La sélection de composants comprend aussi les suites de régressions existantes
de brouillons, suppression, propositions, champs, microphone, recorder, statuts,
premier usage et paramètres guidés. Les scénarios de permission tardive,
annulation, pistes et contextes restent déterministes, avec ressources simulées.

Le vrai hôte Tauri/WebView2 exécute 28 nouveaux contrôles PAM-32 : attente et
double soumission, navigation avec focus h1, réponse ancienne sans proposition,
timeout dans une région alert, reprise explicite, focus initial de correction,
Tab/Maj+Tab, dialogue nommé dans AX et Échap restituant le focus. Les 134
contrôles existants restent exécutés dans la commande complète.

Le runner conserve stderr, exceptions, contrôles et bilan de nettoyage dans un
rapport. En cas d’échec après connexion il écrit aussi DOM et capture d’écran.
Il arrête les ressources audio suivies par chaque page, ferme socket/serveur et
l’arbre du seul hôte qu’il a lancé, puis supprime son profil temporaire borné.
Une erreur de nettoyage échoue la commande. La création du répertoire de rapport
précède les ressources temporaires. Le test d’échec volontaire crée un vrai
AudioContext puis vérifie les diagnostics, la sortie 1 du runner et la fermeture
du contexte, du processus et du profil ; son wrapper réussit seulement si ces
assertions passent.

Les parcours premier usage utilisent désormais un périphérique synthétique,
avec permission automatique limitée à cette fixture. Ils n’activent plus le
microphone physique. Le contrôle de langage simple porte sur les trois étapes,
car la note de sécurité PAM-29 nomme explicitement le score Needle. La structure
et les assertions du parcours restent conservées.

## Critères et preuves

| Critère du ticket | Preuve |
| --- | --- |
| Succès, erreur, désactivation, timeout, double clic, permission tardive, navigation, annulation et accessibilité ; mocks/natif distingués | 99 tests de la commande composants, dont 11 nouveaux tests/sous-tests ; 162 contrôles Windows WebView2 et 11 de premier usage. Tableau des niveaux dans frontend-tests.md. |
| Focus, propositions obsolètes et états asynchrones couverts de façon déterministe | Nouveaux tests IPC de navigation/démontage, expiration/configuration, timeout de confirmation sans rejeu, correction et double émission. Suites async-state, recorder, microphone et propositions conservées. Focus/Tab/Échap vérifiés dans la vraie WebView2. |
| Un aperçu navigateur sans bridge n’est pas une preuve native | Renderer Node déclaré simulé ; runner WebView2 exige Windows et un hôte construit. Services métier simulés explicitement dans le rapport. Aucun aperçu navigateur compté comme validation native. |
| Profils/processus/audio nettoyés et diagnostics exploitables | Rapports natifs : audio à zéro, hôte sorti, serveur fermé, profil supprimé, aucune erreur de nettoyage. Échec volontaire avec un vrai contexte : DOM, PNG et erreur conservés ; wrapper vérifie aussi ESRCH pour le PID et ENOENT pour le profil. Inventaire final sans hôte ni WebView2 de ces profils. |

## Validations exécutées

Windows x64, Node 24.21.0, npm 11.19.0, WebView2 Edge 155. Sources et
dépendances existantes Windows séparées du node_modules Linux préservé.

| Commande / contrôle | Résultat | Trace sous artifacts/autonomy |
| --- | --- | --- |
| npm run test:components | 99 réussis, zéro échec/ignoré | pam32-components-verified.log |
| npm test | 396 réussis, zéro échec/ignoré | pam32-test-verified.log |
| npm run build, copie Windows avec mêmes sources/verrou | TypeScript et Vite réussis ; 78 entrées identiques par SHA-256 | pam32-build-verified.log, pam32-build-inputs.json |
| npm run lint / npm run format:check, copie Windows | Réussis | pam32-lint.log, pam32-format.log |
| node scripts/build-modal-test-host.mjs | Cargo/MSVC --locked, manifeste explicite, réussi | pam32-host-build.log |
| npm run test:webview | 162 contrôles réussis ; zéro exception non gérée | pam32-webview-verified.log, pam32-webview-verified/report.json |
| node scripts/test-modals.mjs --first-use-only | 11 contrôles réussis, capture synthétique arrêtée | pam32-first-use-verified.log et répertoire associé |
| npm run test:webview:cleanup | Wrapper code 0 ; runner code 1 attendu, contexte réel fermé et diagnostics vérifiés | pam32-cleanup-final.log, pam32-cleanup-final/report.json |
| Syntaxe Node des scripts, git diff --check, empreintes et ancêtres Git | Réussis | Chat et reçu local |

Les deux anciens exécutables hôtes essayaient de démarrer sans le manifeste
requis : code 3221225785, aucun contrôle revendiqué. La reconstruction via le
script dédié a corrigé le lancement. Ces échecs ont néanmoins nettoyé leurs
profils et produit leurs rapports. L’avertissement d’icône de ressource de
l’hôte jetable persiste, sans exception de page ni échec de parcours.
Le premier essai du parcours premier usage a échoué sur l’assertion devenue
incompatible avec la note PAM-29 ; le journal et le DOM sont conservés.
Les premiers nouveaux tests IPC ont également échoué sur les fixtures incomplètes,
puis la suite finale entière a réussi avec les contrats complets.

## Fichiers et limites

package.json ; scripts/test-modals.mjs et test-webview-cleanup.mjs ; tests
component-journeys.test.mjs et component-journey-checks.mjs ; fixtures Vue,
modal-native et modal-page ; first-use-checks.mjs ; les deux documents livrés.
Aucune dépendance ou permission ajoutée, aucun changement de code métier,
Rust de production ou dispositif autonome. Aucun test existant supprimé.

Le DOM, le clavier, l’AX Windows et l’AudioContext du test d’échec sont réels.
Rust/sidecar métier, applications, profil, erreurs et courses IPC sont simulés.
Le microphone synthétique ne valide pas matériel, permission humaine, retrait
USB ou veille ; NVDA n’a pas été réexécuté ici. Les procédures dédiées sont
documentées, et les preuves réelles antérieures des prérequis ont été relues.
Paquet installé, moteur réel et lecteur personnel ne sont pas revendiqués.
Les profils jetables et processus connus sont nettoyés ; seuls les diagnostics
et caches ignorés attendus subsistent. Aucun push ni publication.
