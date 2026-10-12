**Audit de consolidation PAM — 11 octobre 2026**

Analyse du commit `2aff3f94cf8c3cc0e6266f59f2739b0a977ae122`, branche `codex/deezer-routing`. Le dépôt était propre au début de l’audit. Ce rapport est le seul ajout destiné au code suivi; les bancs d’essai et preuves sont dans le dossier d’artefacts ignoré par Git.

PAM possède une base de prototype cohérente : Vue 3/TypeScript strict, Tauri 2, adaptateurs Windows, sidecar Node isolant le moteur natif. La consolidation doit viser en premier le cycle de vie des processus, la confidentialité après panne, les frontières de données et l’accessibilité. Une réécriture totale en Rust, un changement de framework ou l’ajout systématique de Pinia ne sont pas justifiés par les constats.

**Portée et niveau de preuve**

Lecture des sources de production Rust, Vue/TypeScript, audio, sidecar, scripts de préparation/distribution, workflow et documentation; exécution de tests existants et de reproductions isolées. Les recommandations sont comparées aux sources primaires Rust, Vue, Tauri, Microsoft, W3C, GitHub et Cactus, liées au fil des constats.

« Reproduit » signifie observé pendant cet audit, parfois avec un moteur simulé explicitement indiqué. « Établi par le code » décrit un chemin précis dont le scénario complet n’a pas été exécuté. Les conseils de conception ne sont pas présentés comme des incidents déjà observés. L’inventaire est large sur ce périmètre, sans prétendre prouver l’absence de tout autre défaut.

L’UX a été inspectée dans une compilation fraîche du front, en navigateur et sans bridge Tauri. Les erreurs « ouvrir PAM Windows » y sont attendues, pas des défauts de production. Vérifications visuelles et clavier : accueil, sélecteur, formulaire manuel, préférences, taille minimale 780 × 620 et largeur CSS réduite pour examiner le reflow. Aucun débordement horizontal de page n’a été mesuré sur la page Préférences aux dimensions examinées. Les parcours natifs microphone/tray, un lecteur d’écran réel, les autres vues remplies au zoom et l’installation NSIS restent à vérifier.

**Contrôles exécutés**

| Contrôle | Résultat et portée |
|---|---|
| `npm test` | **124 tests passent**, aucun ignoré, y compris tests Windows présents. Le premier essai sandbox a échoué sur `spawn EPERM`; la relance autorisée hors sandbox passe. |
| TypeScript | `node node_modules/vue-tsc/bin/vue-tsc.js --noEmit` passe. |
| Build front | Le build ordinaire est bloqué par des dépendances Linux dans l’environnement partagé. **Compilation isolée sous Windows réussie** avec le même lockfile et les sources courantes; Vite 8.3.2, JS 125,76 Ko / 44,64 Ko gzip, CSS 19,46 Ko / 4,99 Ko gzip. |
| Intégration réelle | `smoke-runtime.mjs` passe : chargement des modèles, routage, confirmation, lancement d’un exécutable de test, silence Whistle, alias. Pas de nouvelle capture de parole humaine. |
| Confiance | **32 cas + 4 contrôles de formulations** passent, inférence réelle et effets simulés. |
| Deezer | **48 contrôles** de routage passent avec le vrai modèle; aucun lecteur personnel commandé. |
| Multimédia | **65 contrôles** de compréhension passent avec le vrai modèle et des sessions simulées. |
| Dépendances npm | `npm audit --json` consulté : **0 avis de vulnérabilité** pour le graphe racine. Cela ne couvre ni Rust ni tous les binaires embarqués. |
| Rust | Lecture du code effectuée. **Pas de nouvelle compilation, cargo test, Clippy ou rustfmt** : Cargo absent de cette machine et Docker non démarré. |
| Reproductions ciblées | Job Object, audio après arrêt dur, configuration invalide, désactivation après disparition d’un .exe, expiration, double lancement, focus et contrastes. |

**Points solides à conserver**

- Lancement sans shell, exécutables choisis dans la configuration, validation des noms d’outils et arguments; pas de serveur HTTP local en production.
- CSP active, restriction des commandes à la fenêtre principale, routes Deezer bornées et icônes PNG validées.
- Proposition consommée avant exécution, invalidation par empreinte de configuration, confirmation obligatoire des corrections et clics multimédias.
- Capture bornée à 30 s, validation WAV, nettoyage normal dans un `finally`, modèles persistants et reprise du worker.
- Ressources externes épinglées avec SHA-256, tests réels d’inférence, documentation des limites de Deezer et du score.

**Priorisation**

P1 : à corriger avant de qualifier le produit de fiable et accessible au quotidien. P2 : consolidation à planifier ensuite, avec tests de non-régression. P3 : conditionné à la distribution, à une extension du périmètre ou à des mesures. Aucun P0 n’a été établi.

**01 — P1 — Isoler les applications utilisateur du Job Object de PAM**

Reproduit sur Windows avec deux processus de test : un enfant Node lancé avec les mêmes options `detached: true` hérite du Job Object et se termine à sa fermeture. [src-tauri/src/lib.rs](C:/projets/pam/src-tauri/src/lib.rs:53) active `KILL_ON_JOB_CLOSE`; [sidecar/assistant.cjs](C:/projets/pam/sidecar/assistant.cjs:257) lance les exécutables depuis ce processus supervisé. Cela concerne notamment les exécutables manuels qui restent dans cette arborescence; les applications relayées par Explorer ne sont pas toutes équivalentes.

À faire : Faire lancer les applications utilisateur hors du job qui supervise les moteurs, avec une séparation explicite et testée. Conserver la fermeture garantie de Node et des auxiliaires internes. Cette conclusion concorde avec la [documentation Microsoft des Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects).

Validation attendue : L’application de test reste ouverte après quitter PAM, redémarrer le sidecar et tuer PAM; Node et ses auxiliaires sont bien arrêtés.

**02 — P1 — Nettoyer l’audio après crash ou timeout dur**

Reproduit : un `process.exit(70)` pendant l’inférence laisse `turn-*/clip.wav` et `keywords.txt`; un appel `status` suivant les conserve. Le `finally` de [sidecar/assistant.cjs](C:/projets/pam/sidecar/assistant.cjs:581) ne peut pas s’exécuter lorsque [sidecar/engine.cjs](C:/projets/pam/sidecar/engine.cjs:35) ou [sidecar/main.cjs](C:/projets/pam/sidecar/main.cjs:12) arrête le processus.

À faire : Ajouter au démarrage une collecte sûre des répertoires de demandes abandonnées, identifiés par propriétaire/session et bornés au profil. Définir une durée de rétention; nettoyer aussi les fichiers `.tmp` échoués. Envisager le transport audio en mémoire après mesure. Corriger la promesse de suppression inconditionnelle du README jusqu’à résolution.

Validation attendue : Après arrêt brutal, timeout natif et reprise, aucun audio orphelin ne reste au-delà de la rétention prévue; les fichiers du profil et d’une demande active sont préservés.

**03 — P1 — Appliquer un budget global et rendre les exécutions partielles visibles**

Écart établi par le code : les 40 s commencent après la découverte des sessions ([sidecar/assistant.cjs](C:/projets/pam/sidecar/assistant.cjs:415)), tandis que le sidecar est arrêté après 45 s. Chaque commande média peut ensuite appeler deux auxiliaires de 12 s ([sidecar/media.cjs](C:/projets/pam/sidecar/media.cjs:19), [sidecar/native.cjs](C:/projets/pam/sidecar/native.cjs:7)), jusqu’à huit actions. Des effets peuvent donc avoir eu lieu avant une interruption sans compte rendu. Ce scénario long n’a pas été exécuté pendant l’audit.

À faire : Faire circuler une échéance commune depuis l’entrée de la demande, vérifier le budget avant chaque effet et distinguer `non démarré`, `effectué`, `échoué`, `résultat inconnu`. Conserver un résultat par action et ne jamais rejouer automatiquement un effet dont l’issue est inconnue.

Validation attendue : Avec sessions lentes, inférence proche de la limite et plusieurs actions, PAM respecte le délai annoncé et indique précisément ce qui a pu être exécuté.

**04 — P1 — Borner aussi l’écriture dans le pipe du sidecar**

Écart établi par lecture : dans [src-tauri/src/lib.rs](C:/projets/pam/src-tauri/src/lib.rs:188), `write_all` bloque avant `recv_timeout(50 s)`, sous le verrou global. Le délai ne couvre ni l’attente du verrou ni un enfant vivant qui ne lit plus son entrée. Le watchdog évite justement un worker déjà verrouillé ([src-tauri/src/lib.rs](C:/projets/pam/src-tauri/src/lib.rs:410)). Le blocage du bridge lui-même reste à reproduire avec un test Rust.

À faire : Confier le bridge à un worker dédié avec file bornée, échéance sur l’opération complète et possibilité de tuer le sidecar sans attendre son verrou. Préserver la sérialisation des effets. Distinguer saturation, écriture bloquée et absence de réponse.

Validation attendue : Un sidecar de test qui ne lit jamais stdin, recevant un gros message audio, ne rend pas PAM indisponible indéfiniment.

**05 — P1 — Valider entièrement la configuration lue et proposer une réparation**

Reproduit : `status` accepte une fiche `{id:'broken', enabled:true}`; l’inférence échoue ensuite sur `.normalize`. [sidecar/assistant.cjs](C:/projets/pam/sidecar/assistant.cjs:34) valide les préférences et formulations, mais pas la structure de chaque application, ses identifiants, limites ou doublons. Une corruption peut aussi casser le rendu Vue.

À faire : Utiliser un schéma de configuration versionné commun à la lecture et aux écritures. Distinguer fiche structurellement invalide et exécutable simplement indisponible. Présenter une récupération contrôlée : sauvegarde du fichier, restauration ou exclusion explicite de la fiche défectueuse.

Validation attendue : Les profils incomplets, types incorrects, doublons et versions incompatibles produisent une erreur exploitable; aucun profil corrompu n’est écrasé silencieusement.

**06 — P1 — Rendre les trois fenêtres modales réellement utilisables au clavier**

Reproduit dans le front compilé : Tab après le dernier bouton du sélecteur sort du dialogue et atteint « Assistant » derrière lui. L’éditeur manuel s’ouvre avec le focus sur `body`. [src/components/ApplicationPicker.vue](C:/projets/pam/src/components/ApplicationPicker.vue:18) et [src/App.vue](C:/projets/pam/src/App.vue:331) ajoutent `aria-modal`, sans confinement du focus ni arrière-plan inerte; la correction n’a pas de gestion Échap.

À faire : Créer un composant de dialogue partagé : focus initial pertinent, boucle Tab/Maj+Tab, fermeture Échap cohérente, arrière-plan inerte, restitution du focus au déclencheur. Suivre le [pattern de dialogue WAI-ARIA](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/).

Validation attendue : Ajout, édition et correction se réalisent entièrement au clavier, sans atteindre les contrôles sous la modale et sans perdre le focus après fermeture.

**07 — P1 — Corriger les contrastes des aides, états et actions**

Mesuré à partir des styles rendus et des couleurs de [src/style.css](C:/projets/pam/src/style.css:6) : aide `#a1a9b8` sur blanc = 2,36:1; texte secondaire `#939bac` = 2,79:1; lien `#8c78c8` = 3,73:1; badge en attente = 2,72:1. Ce sont des textes actifs souvent à 9–11 px, sous la référence 4,5:1 du [WCAG contraste minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

À faire : Définir des couleurs sémantiques accessibles et une échelle typographique lisible, puis les appliquer aux écrans et composants. Agrandir les zones cliquables trop fines; évaluer leur espacement réel avant de conclure sur le [critère de taille des cibles](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).

Validation attendue : Contraste validé sur tous les états actifs, focus visible, utilisation au zoom et en contraste élevé; pas seulement sur la page d’accueil.

**08 — P2 — Refuser les lancements dupliqués pour une commande simple**

Reproduit avec un moteur simulé : « Ouvre Test » et deux appels identiques à 99 % produisent deux lancements. La restriction des doublons dans [sidecar/assistant.cjs](C:/projets/pam/sidecar/assistant.cjs:538) exempte l’action `open`.

À faire : Pour une invocation simple résolue vers une seule action, exiger exactement un appel. Pour les plans composés, définir les répétitions admissibles sans supprimer une répétition explicitement demandée.

Validation attendue : Un appel supplémentaire inventé ne lance pas une deuxième instance; les demandes réellement composées restent supportées.

**09 — P2 — Permettre de désactiver une application désinstallée**

Reproduit : supprimer l’exécutable de test puis sauvegarder `enabled:false` échoue sur `fs.stat`. [src/App.vue](C:/projets/pam/src/App.vue:244) réutilise la sauvegarde complète et [sidecar/assistant.cjs](C:/projets/pam/sidecar/assistant.cjs:56) exige toujours que l’exécutable existe; le catalogue natif impose également sa présence pour les fiches Windows.

À faire : Séparer le changement d’état de la validation nécessaire à un nouveau lancement. Afficher « indisponible » et permettre désactivation, réparation du chemin ou suppression.

Validation attendue : Une application disparue peut être désactivée sans devoir la supprimer et perdre ses formulations.

**10 — P2 — Gérer explicitement l’expiration et l’invalidation des propositions**

Reproduit : confirmer une proposition vieillie renvoie `ENOENT` avec un chemin interne, car le nettoyage de [sidecar/assistant.cjs](C:/projets/pam/sidecar/assistant.cjs:281) précède la vérification d’expiration. Le front ne connaît que `pending` ([src/types.ts](C:/projets/pam/src/types.ts:62)) et ne met pas à jour les anciennes propositions après modification des applications. La limite de vingt entrées peut aussi écarter une proposition encore valide ([src/App.vue](C:/projets/pam/src/App.vue:104)).

À faire : Renvoyer des états métier `expired`/`invalidated`, une échéance et une cause. Mettre à jour ou retirer les boutons d’exécution, préserver les propositions non résolues et proposer de reformuler. Décider explicitement si les propositions doivent être restaurées après redémarrage ou purgées.

Validation attendue : Après dix minutes, changement de configuration, correction échouée ou plus de vingt demandes, aucun bouton ne prétend qu’une proposition inexécutable reste valide.

**11 — P2 — Ajouter sauvegarde et migrations du profil**

[sidecar/assistant.cjs](C:/projets/pam/sidecar/assistant.cjs:28) utilise déjà une écriture temporaire suivie d’un renommage, ce qui est une bonne base. Il manque une sauvegarde restaurable, des migrations de schéma et une procédure de récupération utilisateur. Le profil contient les applications et l’apprentissage des formulations.

À faire : Conserver une dernière version valide, tester les remplacements Windows et les erreurs disque, introduire des migrations explicites avant une version 2. Prévoir export/import validé du profil et nettoyage des temporaires d’écriture.

Validation attendue : Une mise à jour, un disque plein ou un profil partiellement corrompu ne fait pas perdre sans recours les applications et formulations.

**12 — P2 — Introduire des erreurs structurées et des diagnostics locaux**

[src-tauri/src/lib.rs](C:/projets/pam/src-tauri/src/lib.rs:115) jette stderr; de nombreuses branches renvoient seulement une chaîne ou ignorent l’erreur. Les détails de transport sont remplacés par un message générique ([src-tauri/src/lib.rs](C:/projets/pam/src-tauri/src/lib.rs:202)). L’erreur d’expiration reproduite expose à l’inverse un chemin brut.

À faire : Définir un code, une étape, un caractère réessayable et un identifiant de demande, avec message utilisateur séparé des détails techniques. Ajouter des logs locaux bornés et un export volontaire de diagnostic, en excluant par défaut audio, transcription et arguments sensibles.

Validation attendue : Distinguer panne du modèle, microphone refusé, cible absente, timeout et profil corrompu; retrouver l’étape fautive sans enregistrer le contenu personnel.

**13 — P2 — Typer et versionner les contrats entre Vue, Rust et Node**

[src/App.vue](C:/projets/pam/src/App.vue:62) accepte `method:string` et `payload:unknown`; [src-tauri/src/lib.rs](C:/projets/pam/src-tauri/src/lib.rs:231) utilise `String`/`Value`; les formes de réponses sont recopiées dans [src/types.ts](C:/projets/pam/src/types.ts:1). `invoke<T>` ne valide pas les données reçues à l’exécution.

À faire : Définir des requêtes et réponses discriminées, enums Rust/TypeScript et schémas validés côté Node. Générer les types ou vérifier leur concordance par tests. Ajouter version de protocole et identifiants corrélables; `id:1` est cohérent avec la sérialisation actuelle, mais limite l’évolution.

Validation attendue : Un nom de méthode ou payload invalide échoue proprement à la frontière; les évolutions de `Turn`, des actions et erreurs ne divergent pas entre couches.

**14 — P2 — Séparer les responsabilités Rust et documenter les invariants unsafe**

[src-tauri/src/lib.rs](C:/projets/pam/src-tauri/src/lib.rs:30) rassemble job Windows, pipes, commandes, tray, raccourci et supervision. [src-tauri/src/applications.rs](C:/projets/pam/src-tauri/src/applications.rs:128) et [src-tauri/src/applications.rs](C:/projets/pam/src-tauri/src/applications.rs:271) contiennent de larges zones unsafe; l’implémentation `Send` du handle n’a pas de justification de sûreté. Aucun défaut mémoire précis n’a été démontré.

À faire : Extraire bridge, supervision et intégration desktop; employer des types propriétaires pour les handles quand possible. Réduire les blocs unsafe et documenter allocation/libération COM, durée de vie des buffers, thread d’appartement et transfert de handles. Les invariants doivent rester explicites selon le [Rustonomicon](https://doc.rust-lang.org/nomicon/safe-unsafe-meaning.html).

Validation attendue : Chaque opération unsafe a une justification vérifiable et les ressources sont libérées sur les retours anticipés; les tests peuvent isoler chaque module.

**15 — P2 — Durcir le cycle de vie du superviseur**

[src-tauri/src/lib.rs](C:/projets/pam/src-tauri/src/lib.rs:404) lance un thread de surveillance sans handle de fin et réchauffe le moteur périodiquement; ses erreurs sont ignorées. Le destructeur du worker tue puis attend le processus. La reprise est utile, mais ne distingue pas panne passagère et panne persistante.

À faire : Formaliser les états démarrage/prêt/reprise/arrêt, centraliser la surveillance, ajouter un délai croissant après pannes répétées et empêcher tout redémarrage après demande d’arrêt. Prévoir une fermeture avec délai borné et observabilité; garder les inférences réessayables distinctes des effets externes.

Validation attendue : Des démarrages toujours défaillants ne créent pas une boucle coûteuse; quitter reste rapide pendant une demande et aucun effet externe n’est rejoué.

**16 — P2 — Découper App.vue et le cœur métier Node**

[src/App.vue](C:/projets/pam/src/App.vue:1) fait 39,8 Ko pour 378 lignes, avec plusieurs écrans, dialogues, configuration, historique, audio et IPC. [sidecar/assistant.cjs](C:/projets/pam/sidecar/assistant.cjs:264) concentre persistance, routage, corrections, validation et exécution. Les très longues lignes rendent les revues difficiles.

À faire : Extraire vues et dialogues, puis des composables pour l’audio, les demandes, le profil et les propositions. Côté Node, séparer dépôt de configuration, reconnaissance d’intention, préparation de plan et exécution. Ajouter formatage automatique et lint adaptés; conserver les comportements testés. Les [composables Vue](https://vuejs.org/guide/reusability/composables.html) offrent le mécanisme approprié.

Validation attendue : Une modification de formulaire ou de routage s’évalue dans un module limité; les tests métier existants restent verts. Pinia et Vue Router restent des choix, pas des prérequis.

**17 — P2 — Rendre explicites les états asynchrones du front**

[src/App.vue](C:/projets/pam/src/App.vue:19) cumule `busy`, `loading`, `recording`, `requestingMic`, `testing` et des appels de santé non attendus. [src/components/MediaControls.vue](C:/projets/pam/src/components/MediaControls.vue:24) gère ses propres requêtes; ses réponses peuvent revenir après une navigation. L’installation asynchrone des listeners n’a pas de chemin d’erreur utilisateur dédié.

À faire : Centraliser le client IPC; représenter les opérations et transitions autorisées, protéger les doubles soumissions dans les handlers, ignorer les réponses périmées et nettoyer listeners/minuteries même après un montage interrompu. Conserver des états de chargement locaux pour ne pas afficher « traitement vocal » pendant toute autre tâche.

Validation attendue : Tester montage/démontage pendant un appel, permission micro tardive, double clic, requêtes de santé concurrentes et panne lors de l’enregistrement des événements.

**18 — P2 — Centraliser les définitions d’actions et capacités**

Pages, contenus, actions et libellés existent séparément dans [src/actions.ts](C:/projets/pam/src/actions.ts:1), [src/components/MediaControls.vue](C:/projets/pam/src/components/MediaControls.vue:17), [sidecar/deezer.cjs](C:/projets/pam/sidecar/deezer.cjs:5) et [src-tauri/src/media.rs](C:/projets/pam/src-tauri/src/media.rs:6).

À faire : Créer un registre déclaratif partagé ou généré : identifiant stable, paramètres, libellé, prérequis, effet attendu et possibilités de correction. Garder la validation native indépendante comme défense supplémentaire, mais vérifier automatiquement sa cohérence.

Validation attendue : Ajouter une page ou action ne demande plus plusieurs listes manuelles susceptibles de diverger; un test vérifie front, routage et routes autorisées.

**19 — P2 — Préserver les brouillons et signaler les changements non enregistrés**

Le clic sur l’arrière-plan ferme l’éditeur et la correction sans vérifier les changements ([src/App.vue](C:/projets/pam/src/App.vue:331), [src/App.vue](C:/projets/pam/src/App.vue:355)). Quitter Préférences détruit aussi l’éditeur de formulations du composant.

À faire : Suivre l’état modifié, conserver le brouillon ou demander une confirmation ciblée quand sa perte est réelle. Restituer les valeurs après échec et séparer préparation d’une correction et mémorisation déjà effectuée si une étape ultérieure échoue.

Validation attendue : Une erreur moteur, un clic extérieur ou un changement d’écran ne fait pas perdre une saisie longue sans information.

**20 — P2 — Rendre la suppression récupérable**

Le bouton poubelle appelle immédiatement [src/App.vue](C:/projets/pam/src/App.vue:250); le backend supprime également toutes les formulations liées ([sidecar/assistant.cjs](C:/projets/pam/sidecar/assistant.cjs:340)). Les formulations se suppriment elles aussi directement.

À faire : Ajouter une possibilité d’annuler/restaurer ou une confirmation indiquant les formulations associées qui seront supprimées. Préférer l’annulation pour une action fréquente et réversible.

Validation attendue : Un clic accidentel ne détruit pas irrévocablement la configuration apprise; le périmètre de la suppression est visible.

**21 — P2 — Afficher et annoncer l’état réellement disponible**

La carte dit « PRÊT À VOUS ÉCOUTER » dès que PAM n’enregistre ni ne traite, même si aucun moteur n’est prêt ([src/App.vue](C:/projets/pam/src/App.vue:298)). Les préférences peuvent dire « Moteurs disponibles » sans statut. Les transitions du micro et les nouvelles propositions ne sont pas des régions live.

À faire : Dériver ces messages des mêmes états que l’activation des boutons. Montrer démarrage, transcription, préparation, exécution et reprise; proposer une annulation avant les effets irréversibles. Annoncer sobrement les changements aux lecteurs d’écran, conformément aux [messages d’état WCAG](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).

Validation attendue : Aucun message de disponibilité ne contredit le bouton; une demande en cours et son résultat sont compréhensibles sans voir l’écran.

**22 — P2 — Rendre les propositions et résultats immédiatement compréhensibles**

Les clics média ajoutent une carte à l’activité, située après des panneaux potentiellement longs ([src/components/MediaControls.vue](C:/projets/pam/src/components/MediaControls.vue:60), [src/App.vue](C:/projets/pam/src/App.vue:310)). Le motif de confirmation reste générique. Un spawn réussi est libellé « lancé » ([sidecar/assistant.cjs](C:/projets/pam/sidecar/assistant.cjs:261)), alors que seule l’émission de la commande est connue.

À faire : Amener visuellement la proposition dans le parcours, avec annonce accessible. Expliquer la raison de validation, le lecteur, les paramètres et l’effet attendu. Distinguer commande envoyée, acceptée, résultat observé et résultat inconnu; conserver les nuances déjà présentes pour Deezer.

Validation attendue : Après un clic Flow, l’utilisateur trouve immédiatement l’action à valider; une commande simplement acceptée n’est pas présentée comme une lecture effectivement constatée.

**23 — P2 — Compléter la navigation accessible et les formulaires**

La navigation sélectionnée n’est indiquée que par classe CSS ([src/App.vue](C:/projets/pam/src/App.vue:281)). Changer de page ne déplace pas le focus sur son contenu. Les aides et erreurs des formulaires ne sont généralement pas liées aux champs; le label du chemin englobe aussi « Parcourir ».

À faire : Ajouter l’état de navigation courant, un accès direct au contenu, la gestion du focus lors des changements de vue, des identifiants de champs, `aria-describedby` et `aria-invalid`. Respecter l’ordre des titres. Référence : [accessibilité Vue](https://vuejs.org/guide/best-practices/accessibility.html).

Validation attendue : Avec NVDA et clavier seul, la page courante, les aides, l’erreur du bon champ et l’action suivante sont identifiables.

**24 — P2 — Renforcer le parcours et le cycle de vie du microphone**

[src/audio/recorder.ts](C:/projets/pam/src/audio/recorder.ts:15) utilise uniquement le périphérique par défaut. Aucun traitement explicite des pistes terminées, changement de périphérique ou suspension n’apparaît. Masquer PAM envoie un événement de cancellation sans acquittement natif ([src-tauri/src/lib.rs](C:/projets/pam/src-tauri/src/lib.rs:277)); le comportement WebView2 réel doit être testé.

À faire : Proposer un test de micro et, si plusieurs entrées existent, leur sélection. Traiter débranchement, permission révoquée, veille/reprise, AudioContext suspendu et annulations concurrentes. Rendre `dispose` idempotent et garantir l’arrêt effectif lors du masquage, y compris pendant une demande de permission.

Validation attendue : La capture cesse dans tous les chemins de fermeture/annulation; les pannes micro expliquent comment récupérer. Les tests doivent couvrir la vraie WebView2, pas seulement le WAV.

**25 — P2 — Actualiser les sessions après une action ou un changement de lecteur**

[src/components/MediaControls.vue](C:/projets/pam/src/components/MediaControls.vue:33) actualise au montage puis seulement sur clic. Le polling de santé de l’application n’actualise pas les médias. Les capacités présentées comme actuelles peuvent donc être périmées après pause/lecture.

À faire : Rafraîchir après résultat, retour au premier plan et changement de lecteur; utiliser les événements Windows ou un polling mesuré avec déduplication. Expliquer la cause d’un bouton indisponible.

Validation attendue : Lecture, pause et titre se mettent à jour sans passage systématique par « Actualiser »; la validation backend reste obligatoire.

**26 — P2 — Simplifier le premier usage et les descriptions d’applications**

L’ajout présente rapidement description pour Needle, session multimédia, plugin, alias et test. L’assistant expose en permanence Whistle/Needle et le pipeline ([src/App.vue](C:/projets/pam/src/App.vue:305)). Les informations techniques prennent de la place avant la première réussite.

À faire : Guider vers choisir une application → tester → essayer une phrase. Proposer des descriptions correspondant aux capacités réelles et montrer les limites au bon endroit. Déplacer les détails de moteur vers une vue de diagnostic et proposer un autre raccourci lorsqu’il est occupé.

Validation attendue : Une personne découvrant PAM peut obtenir sa première action sans comprendre les moteurs, JSON ou GSMTC; le conflit de raccourci dispose d’une solution exploitable.

**27 — P2 — Donner des entrées simples aux paramètres avancés**

Les arguments manuels exigent un tableau JSON ([src/App.vue](C:/projets/pam/src/App.vue:368)). Les contrôles Deezer demandent des identifiants de contenu et de smarttracklist ([src/components/MediaControls.vue](C:/projets/pam/src/components/MediaControls.vue:50)). C’est exact techniquement, mais difficile à utiliser.

À faire : Proposer un éditeur d’arguments par ligne avec aperçu du lancement et garder le JSON comme mode expert. Pour Deezer, permettre de coller un lien dont le domaine, le type et l’identifiant sont validés; expliquer les champs avancés sans inventer de capacités de lecture.

Validation attendue : Fichiers avec espaces, `{input}`, lien Deezer valide et lien refusé ont des résultats prévisibles, avec messages près du champ.

**28 — P2 — Aligner les langues proposées et les langues exécutables**

Sept langues de transcription sont sélectionnables ([src/App.vue](C:/projets/pam/src/App.vue:324)), mais les recognizers et le garde-fou `launch` sont essentiellement français/anglais ([sidecar/needle-tools.cjs](C:/projets/pam/sidecar/needle-tools.cjs:93), [sidecar/media-commands.cjs](C:/projets/pam/sidecar/media-commands.cjs:7)). Une proposition correcte pour « Abre Test » peut être refusée par ce garde-fou.

À faire : Définir explicitement les langues supportées de bout en bout. Localiser et tester les intentions/garde-fous, ou annoncer clairement que les autres choix ne concernent que la transcription. Centraliser les chaînes visibles pour éviter les libellés techniques anglais.

Validation attendue : Pour chaque langue annoncée, un corpus couvre ouverture, négation, correction et ambiguïté; l’utilisateur connaît les limites avant de sélectionner la langue.

**29 — P2 — Évaluer l’exécution automatique sur un corpus indépendant**

Le seuil global de 70 % et `autoExecute:true` sont les défauts ([sidecar/assistant.cjs](C:/projets/pam/sidecar/assistant.cjs:16)). Les tests existants sont précieux mais centrés sur des formulations fixes; le score d’action après canonicalisation ne mesure pas la fidélité de la transcription.

À faire : Mesurer erreurs d’exécution et demandes de confirmation sur un corpus de voix, bruit, langues et noms non utilisés pour écrire les regex. Définir une politique par type d’effet/application, avec validation renforcée pour les arguments libres ou actions sensibles. Présenter clairement l’activation automatique au premier usage. Le fournisseur recommande de [choisir et mesurer le seuil selon le produit](https://www.cactuscompute.com/blog/needle-confidence).

Validation attendue : Le seuil est justifié par des mesures de faux déclenchements et non uniquement par des cas réussis; aucune probabilité de transcription correcte n’est déduite du score Needle.

**30 — P2 — Vérifier la capacité réelle et les budgets de performance**

Le plafond de 32 applications n’est pas une garantie de tenir dans le contexte : chaque lecteur crée plusieurs outils ([sidecar/assistant.cjs](C:/projets/pam/sidecar/assistant.cjs:125)). Le worker impose 8 192 tokens après construction du préfixe ([sidecar/engine-worker.cjs](C:/projets/pam/sidecar/engine-worker.cjs:44)) et suggère seulement de raccourcir la demande.

À faire : Mesurer démarrage froid/chaud, latence par étape, mémoire et capacité à 1/8/32 applications. Estimer le budget outils + demande, réduire les outils proposés lorsque c’est sûr et signaler précisément un catalogue trop volumineux. Le niveau actuel de performance n’a pas été mesuré exhaustivement.

Validation attendue : La limite affichée est compatible avec le modèle ou expliquée; latences p50/p95 et consommation au repos sont connues, y compris après plusieurs reprises.

**31 — P2 — Ajouter des tests Rust du bridge et des adaptateurs**

Le seul `#[test]` repéré est celui des routes Deezer ([src-tauri/src/media.rs](C:/projets/pam/src-tauri/src/media.rs:243)). La couverture Node ne passe pas par `AssistantBridge`, ses pipes, le Job Object ou l’énumération COM.

À faire : Introduire des points d’injection pour processus, horloge et transport; tester stdin bloqué, EOF, sortie invalide/surdimensionnée, enfant mort, arrêt pendant requête, permissions de fenêtre et héritage des jobs. Tester le catalogue vide, inaccessible, ambigu et actualisé.

Validation attendue : Les défauts 01, 03 et 04 ont des régressions qui échouent avant leur correction et réussissent après; les tests Windows sont exécutés en CI.

**32 — P2 — Ajouter des tests de composants et de parcours Vue/WebView2**

Le dossier [tests/audio.test.mjs](C:/projets/pam/tests/audio.test.mjs:1) couvre l’encodage et le worklet; aucun test de composant Vue ou parcours Tauri n’est présent. Le focus des dialogues et les états asynchrones échappent donc à la suite verte.

À faire : Ajouter des tests de composants pour demandes, édition, corrections et expiration, puis des parcours clavier et des tests Windows réels avec profil isolé. Utiliser les [mocks IPC Tauri](https://v2.tauri.app/develop/tests/mocking/) pour les cas simulés et suivre les [niveaux de tests recommandés par Vue](https://vuejs.org/guide/scaling-up/testing.html).

Validation attendue : Couvrir succès, erreur, désactivation, timeout, double clic, permission tardive, navigation, annulation et accessibilité; distinguer explicitement mocks et fonctionnement natif.

**33 — P2 — Faire de la CI une barrière de qualité complète**

[.github/workflows/windows.yml](C:/projets/pam/.github/workflows/windows.yml:22) lance npm test, intégration et confiance, mais ni tests Rust, ni Clippy/rustfmt, ni lint front, ni `verify:bundle`, ni les suites dédiées de routage Deezer/média. La compilation effectue déjà le contrôle TypeScript via `build`.

À faire : Ajouter `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test --locked`, lint et tests UI, puis les contrôles réels pertinents et la vérification du paquet. Séparer contrôles rapides et construction lourde, conserver les diagnostics en cas d’échec. [Usage Clippy](https://doc.rust-lang.org/clippy/usage.html).

Validation attendue : Une PR ne peut pas publier un artefact avec échec de ces contrôles; les écarts de format et les défauts Rust deviennent visibles avant packaging.

**34 — P2 — Rendre l’environnement de développement reproductible entre Windows et Linux**

Reproduit dans cet espace : `npm run build` ne trouve pas le lanceur Windows de vue-tsc; l’appel direct de Vite échoue car seul `@rolldown/binding-linux-x64-gnu` est installé. Une installation isolée du même lockfile sous Windows compile correctement. [README.md](C:/projets/pam/README.md:1) décrit le partage du dépôt avec Docker.

À faire : Séparer les `node_modules` par OS/checkout ou volume, documenter ce contrat, déclarer `engines`/gestionnaire de paquets et fixer la toolchain Rust/MSRV. Conserver les lockfiles et utiliser les modes verrouillés en CI. Éviter les noms de conteneur propres à une machine dans le parcours standard.

Validation attendue : Un clone neuf et chaque workflow Windows/Linux fonctionnent avec les versions documentées sans réutiliser des bindings natifs de l’autre OS.

**35 — P2 — Couvrir toutes les dépendances dans le suivi de sécurité**

L’audit npm actuel ne trouve aucun avis, mais ne couvre pas Cargo, le Node embarqué, le moteur Cactus ni Koffi extrait manuellement dans [scripts/prepare-runtime.mjs](C:/projets/pam/scripts/prepare-runtime.mjs:122). Les versions et empreintes fixées sont déjà un point fort.

À faire : Inventorier runtime, modèles, bibliothèques natives et licences dans un SBOM; automatiser l’audit npm et Rust et le suivi des composants téléchargés. Définir une cadence de mise à jour avec réexécution des suites d’inférence. Vérifier l’intégrité du cache extrait complet, pas seulement `node.exe`.

Validation attendue : Une mise à jour ou un avis concernant un composant embarqué est repérable même s’il n’apparaît pas dans le package-lock racine; aucune vulnérabilité native n’est affirmée sans preuve.

**36 — P2 — Assembler un paquet frais et vérifier son contenu exact**

[scripts/package-portable.mjs](C:/projets/pam/scripts/package-portable.mjs:16) recopie dans un dossier existant et peut y conserver des fichiers obsolètes; il choisit le premier exécutable présent sans preuve de fraîcheur. Le manifeste de [scripts/prepare-runtime.mjs](C:/projets/pam/scripts/prepare-runtime.mjs:145) n’identifie pas tout le code applicatif. [scripts/verify-bundle.mjs](C:/projets/pam/scripts/verify-bundle.mjs:15) vérifie utilement les assets, mais n’est pas appelé par la CI.

À faire : Assembler dans un répertoire de staging neuf, vérifier puis publier atomiquement le dossier complet. Inscrire version/commit et empreintes des fichiers distribués; relier sans ambiguïté binaire, sidecar et front. Exécuter les smoke tests depuis le paquet livré.

Validation attendue : Le paquet ne contient aucun ancien fichier, correspond au commit annoncé et fonctionne avec PATH vide; l’étape échoue si du code ou une ressource manque.

**37 — P2 — Durcir le workflow GitHub et son coût d’exécution**

Le workflow utilise des tags d’actions mutables et `rust-toolchain@stable`, sans permissions explicites, concurrence ni timeout ([.github/workflows/windows.yml](C:/projets/pam/.github/workflows/windows.yml:7)). Cela ne prouve pas une compromission, mais réduit la reproductibilité et le contrôle du pipeline.

À faire : Épingler les actions tierces à des commits, déclarer les permissions minimales, fixer les limites de durée et annuler les builds rendus obsolètes. Séparer build de PR et publication/signature. Appliquer les [recommandations de sécurité GitHub Actions](https://docs.github.com/en/actions/reference/security/secure-use).

Validation attendue : Une PR non fiable n’accède pas aux secrets de publication; les versions exécutées et la consommation maximale d’un job sont maîtrisées.

**38 — P3 · avant distribution — Préparer signature, installation et mises à jour Windows**

Le prototype est volontairement non signé et le paquet NSIS est configuré dans [src-tauri/tauri.conf.json](C:/projets/pam/src-tauri/tauri.conf.json:30). L’audit n’a pas installé, mis à jour ni désinstallé le produit sur une VM neuve.

À faire : Avant diffusion à des tiers, signer les binaires/installeurs, vérifier leur authenticité et tester installation hors ligne, mise à niveau, conservation du profil, rollback et désinstallation. Définir un canal de livraison documenté; un auto-updater n’est pas obligatoire. Voir la [signature Windows Tauri](https://v2.tauri.app/distribute/sign/windows/).

Validation attendue : Un utilisateur sur machine propre installe et met à jour une version identifiable sans perdre sa configuration; les tests distinguent portable et NSIS.

**39 — P3 · après mesure — Optimiser les transferts audio et la découverte si les mesures le justifient**

[src/App.vue](C:/projets/pam/src/App.vue:135) convertit le WAV en tableau de nombres JSON, ensuite recopié en Rust et Node. [src-tauri/src/applications.rs](C:/projets/pam/src-tauri/src/applications.rs:270) récupère les icônes de toutes les applications avant de renvoyer le catalogue; [src/components/ApplicationPicker.vue](C:/projets/pam/src/components/ApplicationPicker.vue:9) filtre et recompare les fiches à chaque saisie.

À faire : Mesurer les pics mémoire et la latence réelle. Selon les résultats : IPC binaire, cache d’icônes, index de recherche normalisé, récupération progressive, limites de temps/volume et virtualisation du catalogue. Le bundle front mesuré à environ 44,64 Ko gzip ne justifie pas à lui seul une stratégie complexe de découpage.

Validation attendue : Une amélioration mesurable au scénario chargé, sans perdre les bornes audio, la validation des icônes ni l’annulation. Référence méthodologique : [performance Vue](https://vuejs.org/guide/best-practices/performance.html).

**40 — P3 · avant extension des accès — Déclarer des permissions Tauri plus fines**

Les méthodes sont filtrées et la fenêtre `main` est vérifiée, avec une CSP active : ce sont de bonnes protections. Cependant les commandes applicatives restent regroupées sous `assistant_request`, et [src-tauri/build.rs](C:/projets/pam/src-tauri/build.rs:1) n’établit pas de manifeste de permissions spécifique; [src-tauri/capabilities/default.json](C:/projets/pam/src-tauri/capabilities/default.json:6) accorde `core:default`.

À faire : Avant de multiplier les fenêtres, plugins ou contenus, définir les commandes et permissions par usage et réduire les droits au nécessaire. Auditer les paramètres de lancement libres et les protocoles autorisés. Tauri explique que les [commandes applicatives enregistrées sont accessibles par défaut](https://v2.tauri.app/security/capabilities/); le contrôle `main` existant reste donc important.

Validation attendue : Les tests démontrent quels accès sont refusés selon la fenêtre et l’origine. Aucun scénario d’accès distant non autorisé n’a été établi pendant cet audit.

**Ordre d’exécution conseillé**

1. Corriger les processus et données : 01–05, 08–12. Installer immédiatement les tests de régression Rust/Node nécessaires; les permissions, timeouts et effets externes doivent rester testables en isolation.
2. Corriger l’accessibilité et les parcours bloquants : 06–07, 19–25; ajouter les tests de composants et de parcours correspondants (32).
3. Stabiliser les frontières et la maintenance : 13–18, puis 26–30. Refactorer par petites étapes en conservant les tests d’inférence verts.
4. Verrouiller la livraison : 31, 33–37, puis 38 si distribution. N’entreprendre 39 et 40 que si leurs conditions sont réunies.

Ces travaux sont ordonnés par risque et dépendance, sans estimation de jours non étayée. Les tests transverses et le pipeline doivent accompagner les corrections, pas être reportés à la fin.

**Preuves locales et reproduction**

- [Résultats des cinq reproductions Node](C:/projets/pam/artifacts/audit-2026-10-11/probe-results.json) et [banc d’essai Node](C:/projets/pam/artifacts/audit-2026-10-11/probes.cjs). Commande : `node artifacts/audit-2026-10-11/probes.cjs`. Les lancements métier sont simulés; les fichiers appartiennent à des profils jetables de l’audit.
- [Résultat du Job Object](C:/projets/pam/artifacts/audit-2026-10-11/job-results.json) et [banc d’essai Windows](C:/projets/pam/artifacts/audit-2026-10-11/job-probe.ps1). Le test crée uniquement ses deux processus Node. Résultat : héritage du job = vrai, terminaison à sa fermeture = vrai.
- [Compilation/aperçu isolé du front](C:/projets/pam/artifacts/audit-2026-10-11/build-preview.mjs) et dépendances dans `artifacts/audit-2026-10-11/build-env`. Aucun remplacement du `node_modules` initial.
- Les scripts de smoke existants ont écrit leurs rapports dans `artifacts`. Les preuves ignorées par Git sont locales à cet espace et ne seront pas incluses automatiquement dans un commit du rapport.

Les profils de reproduction ont été nettoyés. Le code de l’application n’a pas été corrigé dans cet audit; chaque point constitue une proposition de travail vérifiable.
