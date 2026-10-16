# PAM-24 — Parcours et cycle de vie du microphone

Ticket : https://app.notion.com/p/3f7b3e0422a481488e31ed30f9b15d66

Run `c6124deb-00ca-405c-94f8-dd71183eebb3`, worker
`01a1440a-556d-7ce0-b99b-ee93872d458b`, génération 28.
Base : `511b33c973ac4f123c5c43559ccac218208d4375`, branche
`codex/deezer-routing`. Vérification effectuée par le worker implémenteur.

L’autorisation humaine de lancement et le retour demandé depuis le chat PAM-27
ont été relus. La disponibilité humaine et les réponses aux permissions sont
conservées dans `artifacts/autonomy/pam24-human-evidence.json`. PAM-17 est
Terminé ; son commit `13d319207d5002053a7f85693d41b75859d65337` et sa preuve
sont intégrés. Contrat, relations, branche et empreintes du dispositif inchangés.
Le précontrôle de génération 25 était bloqué, avec un seul rapport documentaire
et aucune livraison fonctionnelle ; ce constat reste dans l’historique Git et le
reçu `PAM-24-g25.json`. L’opérateur disponible et le retour nominatif ont permis
cette implémentation complète.

## Comportement livré

Le panneau **Votre microphone** propose un test local de cinq secondes,
accessible avant de configurer une application ou les modèles. Il affiche le
niveau puis un résultat signal/silence et arrête le micro. Il ne conserve aucun
échantillon et ne sollicite pas le moteur. Plusieurs entrées physiques rendent
leur sélection disponible ; le choix reste dans la session, hors profil.
Une entrée choisie puis retirée reste indisponible : aucun repli silencieux.

Chaque VoiceRecorder possède son acquisition, ses pistes, ses événements et son
AudioContext. dispose est idempotent ; les pistes s’arrêtent immédiatement avant
l’attente de fermeture. Les acquisitions et préparations tardives sont invalidées.
finish est partagé entre appels concurrents, borne l’attente du Worklet et libère
le matériel avant rééchantillonnage/envoi. La limite de trente secondes et les
validations WAV restent actives.

devicechange, piste terminée/muette, permission révoquée, contexte suspendu,
page cachée/gelée et interruption de l’horloge annulent la capture. L’interface
explique comment rebrancher, vérifier les permissions ou relancer le test.
Reprise et rebranchement actualisent les entrées sans redémarrer l’écoute.
Navigation et démontage nettoient les listeners/minuteries ; une réponse périmée
ne remplace pas l’état d’une nouvelle capture. Masquer/quitter depuis App attend
l’annulation avant l’appel natif.

Le masquage natif existant a été essayé sur la base avant modification :
événement de cancellation reçu, piste terminée, état idle et fenêtre masquée.
Aucun défaut de ce protocole n’a été reproduit. Aucun acquittement, permission
Tauri ou changement Rust n’a donc été ajouté.

Documentation utilisateur et procédure : `docs/microphone.md`.

## Critères et preuves

| Critère du contrat | Preuves |
| --- | --- |
| Arrêt dans les chemins de fermeture/annulation et récupération expliquée, vraie WebView2 | 25 régressions ajoutées : 13 recorder, 11 composable/composant et 1 App. Tests réels ci-dessous, dont suspension et fermeture de la fenêtre native. |
| Aucune piste après masquer, annuler, fermer ou refuser | Refus réel sans piste/contexte ; annulation pendant permission ; masquage natif et Alt+F4 pendant capture avec toutes les pistes ended, contextes closed, état idle et fenêtre masquée. |
| Accord tardif après annulation sans reprise | Annulation réelle à 14:32:13 UTC ; accord humain ensuite, acquisition à 14:32:35 ; lecture à 14:33:26 : piste immédiatement ended, aucun contexte ni WAV. |
| Débranchement/reprise récupérables sans recharger le profil | Retrait USB pendant capture, arrêt et aide ; rebranchement sans nouvelle acquisition, test explicite réussi dans la même page. Veille pendant capture sur page compilée, même bootId après réveil, aucune reprise ; test explicite de cinq secondes réussi. |

## Essais réels Windows/WebView2

Windows x64, Node 24.21.0, npm 11.19.0, WebView2 Edge 155.0.4283.45,
microphone USB fifine. L’hôte est le véritable binaire debug PAM fraîchement
compilé, avec profils applicatif/WebView2 jetables. Les vrais modules recorder,
useAudio et événements natifs sont chargés. Seuls profil/requêtes métier sont
simulés ; la capture matérielle et l’audio du navigateur sont réels. Les WAV
restent en mémoire et seules leurs métadonnées sont consignées.

| Scénario | Observation et trace locale sous artifacts/autonomy |
| --- | --- |
| Masquage avant correctif | `pam24-baseline-native.json` : cancellation native et piste ended. Une tentative de montrer la fenêtre via API était refusée par les capacités existantes ; aucune permission modifiée. |
| Refus humain | `pam24-native-refusal.json` : idle, zéro piste/contexte, aide explicite de refus. Panneau nommé et bouton de test accessible/focusable avant configuration. |
| Accord tardif, test local et WAV | `pam24-native-late.json` : accord après annulation sans reprise ; test cinq secondes, signal détecté, pistes ended/contextes closed, aucun WAV du test. Arrêt vocal explicite : RIFF, mono, 16 kHz/16 bits, 221142 octets, matériel déjà fermé. |
| Suspension réelle AudioContext | Même trace : suspend() sur le vrai contexte, arrêt et message de récupération, aucune nouvelle demande. |
| Retrait/rebranchement physique | Même trace : recording à 14:35:20 ; retrait vers 14:35:25 ; idle et aucune entrée à 14:35:35. Rebranché, deux entrées logiques, aucune nouvelle acquisition avant le test explicite à 14:36:08. Test réussi et toutes les ressources fermées. |
| Masquage final | Même trace : capture live puis événement native-cancel à 14:37:04, toutes les pistes ended/contextes closed et nativeVisible=false. |
| Veille/reprise | `pam24-native-static-sleep-close.json` avant veille et `pam24-native-static-reconnected.json` après : recording à 14:45:59, veille Windows à 14:46:07, réveil à 14:46:27. Même bootId `407c7551-d1c4-4cb2-b22b-6c39f97735a7`, piste ended, contexte closed, zéro WAV et aide à la reprise. `pam24-sleep-events.json` conserve seulement fournisseur/id/horodatage système. |
| Récupération et fermeture native | Même page compilée : test explicite à 14:47:37, signal détecté et arrêt à cinq secondes. Nouvelle capture live à 14:48:01 ; Alt+F4 réel à 14:48:10 déclenche native-cancel, idle, toutes les pistes ended/contextes closed, zéro WAV et fenêtre masquée. |

Le premier passage en veille s’était fait sans capture : il n’est pas compté.
Un autre essai sur serveur de développement a rechargé la page au réveil et perdu
ses mesures ; il n’est pas compté non plus. Le lanceur versionné sert désormais
une page compilée, sans client de développement. Lors de l’essai compilé,
l’ancienne socket du débogueur a expiré après veille (code de sortie 1 conservé).
Une nouvelle connexion au même target a permis les mesures ci-dessus sans
navigation ni rechargement. Le lanceur final recrée la connexion à chaque commande ;
son contrôle réel check-ui/state/quit a ensuite réussi avec un bootId stable,
zéro panne et profil supprimé (`pam24-native-harness-final.json`).

Les profils temporaires de ces essais sont supprimés, les hôtes et serveurs
arrêtés. Aucune permission de confidentialité n’a été actionnée par l’agent :
refus, accords, retrait et veille ont été effectués par l’utilisateur.

## Autres validations exécutées

| Commande / contrôle | Résultat et trace locale |
| --- | --- |
| npm test | 343/343, zéro échec/ignoré ; `pam24-g28-npm-test-final.log`. 318 tests antérieurs et 25 nouvelles régressions. |
| npm --prefix artifacts/pam34/windows run build | vue-tsc et Vite réussis ; `pam24-g28-build-final.log`. 67 entrées identiques contrôlées par SHA-256 dans `pam24-g28-build-inputs.json`. |
| npm run lint et npm run format:check depuis la copie Windows | Réussis ; `pam24-lint-final.log`, `pam24-format-final.log`. |
| ESLint et Prettier explicites recorder/errors/MicrophonePanel | Réussis, hors périmètre historique des scripts ; `pam24-lint-extra-final.log`, `pam24-format-extra-final.log`. |
| node scripts/test-modals.mjs --navigation-only | 25 contrôles clavier/focus/formulaires réussis dans WebView2 réel ; `pam24-navigation-native.log`. |
| cargo build --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc --bin pam | Réussi ; `pam24-native-build.log`, deux avertissements dead_code préexistants. |
| node --check scripts/test-microphone.mjs, git diff --check, empreintes et ancêtres Git | Réussis avant livraison ; contrôles détaillés dans le reçu local. |

Le node_modules Linux de la racine reste intact. Les commandes de build/lint
utilisent la copie de dépendances Windows avec le même verrou. Le premier passage
de npm test avait échoué sur une fixture DOM devenue incomplète et un budget
temporel sous charge ; la fixture possède désormais les vrais contrats de
listeners et la suite finale entière réussit. Les premiers contrôles lint
avaient signalé une dépendance absente à la racine puis deux problèmes corrigés
dans les fichiers touchés. Ces échecs ne sont pas présentés comme des succès.

## Fichiers et limites

Code : App.vue, audio/recorder.ts, useAudio.ts, useAssistantStatus.ts, errors.ts,
style.css, AssistantView.vue et nouveau MicrophonePanel.vue ; configuration ESLint.
Régressions : recorder-lifecycle.test.mjs, microphone-state.test.mjs,
profile-recovery.test.mjs et fixtures recorder/vue. Essais natifs reproductibles :
scripts/test-microphone.mjs et fixtures microphone-page.html/js. Documentation :
docs/microphone.md et cette preuve.

Les courses contrôlées, la révocation Permissions API, les entrées multiples et
le démontage restent simulés dans les tests déterministes ; les autres scénarios
matériels décrits sont réels. Aucun moteur de transcription, commande de lecteur
personnel ou paquet portable/NSIS n’a été utilisé pour cette validation.
L’annulation n’efface pas un effet déjà envoyé. Aucun changement de protocole,
dépendance, fichier du dispositif autonome, profil ou audio personnel versionné.
Aucun push ni publication.
