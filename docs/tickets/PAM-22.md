# PAM-22 — Propositions visibles et résultats explicites

Ticket : https://app.notion.com/p/3f7b3e0422a48153a471fb7c2673ea67

Run `c6124deb-00ca-405c-94f8-dd71183eebb3`, worker
`01a142b2-e507-7af3-b1da-f71ee510c4d2`, génération 23.
Base `07c913c3e5a0e1f7cdfb427d964f4c00f0980e13`, branche
`codex/deezer-routing`. Autorisation humaine d’origine relue dans le chat source,
relais nominatif et empreintes du dispositif vérifiés. Index et checkout propres
à l’entrée. PAM-17 et PAM-18 terminés dans Notion, reçus, preuves et commits
présents dans la branche. Vérification par le worker implémenteur.

## Comportement livré

Le clic média prépare toujours une confirmation à usage unique. Sa carte apparaît
dans le panneau du lecteur, juste après les boutons (dont Flow), reçoit le focus
et défile dans la zone visible. Tab atteint Exécuter. La carte possède un nom
accessible ; elle utilise le même composant que l’activité, sans duplication.
Les demandes écrites/vocales conservent leur parcours et les annonces persistantes.
Le polling, les résultats et les demandes écrites ne déplacent pas le focus.

La confirmation explique pourquoi elle est requise : action explicite du lecteur,
correction, préférence d’exécution manuelle ou confiance insuffisante. Chaque
étape donne cible, paramètres libellés et effet attendu issus du registre partagé.
Les trois libellés manquants (sélection, page, texte transmis) sont ajoutés au
registre et régénérés. Aucune route, capacité ou confirmation n’est élargie.

Les résultats distinguent commande envoyée, acceptée, non démarrée, échouée et
issue inconnue. Un succès de spawn ou d’activation ne signifie plus « lancé »
ou « effectuée » à l’écran ou dans l’annonce. Les nuances Deezer restent intactes.
Un snapshot Windows après commande n’est présenté comme état observé que s’il
est disponible et correspond à la source ciblée ; il ne prouve ni causalité ni
son audible. Sans cette donnée, PAM indique explicitement l’effet non observé.

Un plan partiel affiche le résultat numéroté de chaque étape et demande de vérifier
les étapes effectuées/inconnues avant une nouvelle demande limitée aux restantes.
Aucun bouton ne rejoue le plan. Expiration, invalidation et consommation retirent
Exécuter ; la garde du handler et la validation native restent actives. Une erreur
de retour de confirmation retire aussi la permission UI de réessayer : résultat
inconnu, vérification exigée, sans relance automatique ni nouvelle émission.

## Critères et preuves

| Critère du ticket | Preuves |
| --- | --- |
| Après Flow, validation immédiatement trouvable et acceptation distincte de lecture constatée | `tests/proposal-presentation.test.mjs` et suite WebView2 : carte dans le panneau, visible, focalisée, nom AX ; résultat « Commande acceptée », effet non observé et absence d’annonce « Effectuée ». |
| Action trouvable au clavier et visuellement | WebView2 Edge 155 réel : quatre scénarios complet/partiel/inconnu/expiré ; focus sur la carte, position dans le viewport, premier Tab sur Exécuter. |
| Confirmations expirées/invalides sans Exécuter | SFC réel : états expired/invalidated/consumed/unknown, statut terminal et échéance dépassée ; expiration en WebView2 ; régressions PAM-10 et handler de confirmation incertaine. |
| Commande acceptée jamais annoncée comme lecture observée | Projection commune de résultats pour carte et live region ; absence d’observation sans snapshot ciblé, état français natif « Lecture », source étrangère, session fermée ou donnée malformée ; tests du lancement Node jetable et de l’hôte simulé. |

## Validations

Windows x64, Node 24.21.0, npm 11.19.0 et WebView2 Edge 155.
Résultats et journaux locaux dans `artifacts/autonomy/`.

| Commande | Résultat |
| --- | --- |
| `npm test` | 302 tests réussis, zéro échec/ignoré ; six nouveaux tests et assertions existantes conservées. `pam22-npm-test-final.log`. |
| `npm run build` | vue-tsc/Vite réussis dans la copie Windows ; même lockfile, 107 entrées identiques vérifiées. `pam22-build-final.log`, `pam22-build-inputs.json`. |
| `npm run lint`, `npm run format:check` | Réussis dans la copie identique ; `pam22-lint-final.log`, `pam22-format-final.log`. |
| ESLint des trois composants, Prettier composants/projection | Réussis ; `pam22-components-lint-final.log`, `pam22-components-format-final.log`. La projection TypeScript est contrôlée par vue-tsc. |
| `npm run test:deezer:routing` | 48 contrôles corrects avec Needle réel, effets simulés ; `pam22-deezer.log`. |
| `npm run test:media:commands` | 65 contrôles corrects avec Needle réel, effets simulés ; `pam22-media.log`. |
| `node scripts/test-modals.mjs` | 109 contrôles WebView2 réussis, dont 22 nouveaux et 87 antérieurs ; `pam22-webview-full-final.log`. |
| `git diff --check`, empreintes, génération, intégration | Contrôlés avant livraison ; reçu `artifacts/autonomy/receipts/PAM-22.json`. |

Le node_modules Linux préexistant de la racine est préservé : le build racine
refuse cet environnement (`pam22-build-root.log`), puis le build Windows isolé
réussit. Les essais initiaux ont détecté un chargeur de tests ignorant le nouveau
module, une comparaison de texte sensible aux espaces et un sélecteur WebView2
pointant sur une recherche désactivée ; ces fixtures ont été corrigées sans retirer
leurs assertions. Un lint TypeScript hors configuration a signalé un fichier
ignoré ; vue-tsc vérifie cette projection et ESLint contrôle les composants.

## Fichiers et limites

Composant `TurnCard`, projection `presentation.ts`, vue Assistant, contrôles média,
annonces, composables requêtes/propositions/état, styles ; registre et sortie
générée ; messages des deux chemins de lancement Node ; tests UI/lancement/hôte,
chargeur de récupération, fixtures et suite WebView2.

La WebView2 exécute le vrai Vue et son arbre d’accessibilité ; services natifs et
résultats média simulés. Needle est réellement exécuté séparément. Le test de
spawn utilise uniquement Node avec sortie immédiate. Aucun lecteur personnel,
microphone matériel, écoute humaine, nouveau contrôle NVDA, paquet, signature,
push ou publication revendiqué. Aucun changement Rust, contrat IPC, dépendance
ou dispositif autonome. Les processus connus et profils WebView2 jetables sont
arrêtés/nettoyés avant clôture. La reprise de quota est annulée avant transfert.
