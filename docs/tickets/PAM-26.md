# PAM-26 — Premier usage et descriptions d’applications

Ticket : https://app.notion.com/p/3f7b3e0422a481368519ec7e2045354a

Run `c6124deb-00ca-405c-94f8-dd71183eebb3`, worker
`01a14536-c87b-7cd1-90f7-9096c50274a8`, génération 29. Base intégrée :
`4680f08fb4101c32ae990ef557bd4a82147a18da`, branche `codex/deezer-routing`.
Les contrats et livraisons PAM-09, 19, 21, 23 et 24 ont été relus dans Notion,
et leurs commits vérifiés dans la branche. Vérification par le worker auteur.

## Livraison

Un guide dans Assistant permet de choisir une application, tester son ouverture
et préparer une phrase. L’ajout reste dans Assistant ; le guide disparaît après
une action effectuée dans la session. Le test utilise la cible enregistrée,
avec une entrée si ses arguments le demandent. Une modification de la cible
invalide le résultat du test. Préparer une phrase n’envoie rien et conserve une
saisie existante. Le test et l’ouverture demandée ne prétendent pas observer
l’effet dans l’application.

Descriptions suggérées et exemples distinguent ouverture simple, lecteur
Windows et liens Deezer. Les limites restent près de la cible ; une description
personnalisée n’est pas remplacée. Les autres noms, commandes du lecteur et
arguments sont repliés. Whistle/Needle/GSMTC sont expliqués dans les diagnostics,
tandis que le traitement local et la politique réelle d’exécution automatique
restent visibles. Aucun changement de cette politique.

Le nouveau réglage natif propose trois combinaisons validées par contrat et par
Windows. Une indisponibilité initiale ne bloque pas PAM. Le remplacement réserve
la nouvelle combinaison, écrit atomiquement `voice-shortcut.json`, puis libère
l’ancienne. Conflit ou échec d’écriture gardent le choix précédent. Les erreurs
de libération sont signalées avec redémarrage demandé. Un réglage corrompu
permet le démarrage avec le défaut et une réparation explicite. Cette préférence
est distincte du profil de l’assistant. La barre annonce la combinaison ; la
fin de sauvegarde restitue un focus connecté, y compris si le panneau disparaît.

Documentation : `docs/first-use.md`, avec renvoi vers `docs/microphone.md`.

## Critères et preuves

| Critère du contrat | Preuve |
| --- | --- |
| Première action sans moteurs/JSON/GSMTC et solution exploitable au conflit | Deux parcours profil vide, clavier seul, choix détecté, description, test, sauvegarde, exemple, proposition et confirmation simulée dans une vraie WebView2. Raccourci remplacé sans profil perdu, focus rendu au titre. |
| Première action sans connaissance technique | Aucun des noms techniques dans les étapes visibles ou la fiche simple ; options repliées. Résultat d’action lisible, guide retiré après succès. Phrase non envoyée par le bouton d’exemple et brouillon long préservé en régression. |
| Application indisponible et micro refusé récupérables | Guide proposant réparation/désactivation et conservation de la fiche. Refus réel de getUserMedia dans un profil de test avec permission CDP refusée ; aide Windows et première action écrite ensuite. Autre profil avec vrai microphone, signal détecté, toutes les pistes terminées après cinq secondes. |
| Raccourci occupé remplaçable, démarrage et profil préservés | Conflit réel Windows par détenteur jetable ; alternative enregistrée ; tentative occupée conservant l’alternative ; rechargement persistant. Vrai binaire PAM/IPC, deux processus successifs, choix retrouvé et octets du profil inchangés. |

## Contrôles exécutés

Windows x64, Node 24.21.0, npm 11.19.0, WebView2 Edge 155. Profils jetables,
services métier et effets simulés dans les parcours Vue. Aucun lancement
d’application personnelle. Les fichiers de résultat ci-dessous sont locaux
sous `artifacts/autonomy/`.

| Contrôle | Résultat / trace |
| --- | --- |
| `npm test` | 348 réussis, zéro échec/ignoré ; `pam26-test-final.log`. Cinq régressions de premier usage, plus assertions IPC et cinq cas partagés Node/Rust. |
| `npm run build` dans la copie Windows | vue-tsc/Vite réussis ; 73 entrées identiques par SHA-256, même lockfile ; `pam26-build-final.log`, `pam26-build-inputs.json`. |
| Lint et format | Scripts globaux et contrôles explicites des composants et du helper réussis ; `pam26-lint-final.log`, `pam26-format-final.log`, `pam26-lint-extra-final.log`, `pam26-format-extra.log`. |
| `node scripts/test-modals.mjs` | 134 contrôles WebView2 réussis ; dialogues, brouillons, suppressions, états, propositions et navigation accessible conservés ; `pam26-modals-final.log`. |
| `--guided-only` | 10 contrôles des arguments simples/JSON et liens Deezer réussis après déplacement dans les options ; `pam26-guided-final.log`. |
| `--first-use-only`, puis avec `--microphone-denied` | 11 + 11 contrôles WebView2 ; `pam26-first-use-native-final.log`, `pam26-first-use-denied.log`. Capture `pam26-first-use.png` relue. |
| Rust Windows `cargo test --locked --features process-tests --lib` | 50 réussis ; trois nouvelles régressions de conflit/persistance, erreur d’écriture et corruption ; `pam26-rust-test.log`. |
| Clippy tous targets avec process-tests, `-D warnings` ; rustfmt | Réussis ; `pam26-clippy.log`, `pam26-rustfmt.log`. |
| Binaire debug de production, compilation Windows | Réussi ; `pam26-native-build.log`. Deux avertissements dead_code préexistants hors feature de test. |
| `shortcut-test-host.exe` | Réservation Windows réelle, conflit, alternative, conservation et rechargement ; `pam26-shortcut-native-final.log`. Aucun événement clavier synthétisé. |
| `node scripts/test-shortcuts.mjs` | Trois contrôles du vrai IPC de PAM, persistance dans un nouveau processus et profil inchangé ; `pam26-shortcut-ipc.log`. |
| Contrats générés, syntaxe des scripts, Git diff et empreintes | Contrôlés avant livraison ; reçu et manifeste de validation locaux. |

Le node_modules Linux préexistant de la racine est préservé. Le build et ESLint
utilisent les dépendances Windows isolées ; les sources, configuration, contrat
JSON et verrou de dépendances de la copie sont comparés aux fichiers livrés.

## Incidents et limites

Les premiers essais ont exposé une fixture partageant ses objets par référence,
puis un clonage ne supportant pas les proxies Vue. Elle reproduit maintenant la
sérialisation JSON des deux sens de l’IPC. Le test de focus après sauvegarde a
ensuite révélé la perte de focus due au bouton désactivé : le déclencheur est
capturé avant désactivation et restauré à la fin. Ces défauts ont été corrigés
avant les contrôles finaux. Les contrôles supplémentaires ESLint ont relevé deux
accès directs aux props, remplacés par les refs comme dans les vues existantes.

Les essais de permission sont séparés : le drapeau du navigateur qui autorise
le microphone pour le test matériel prévaut sur un refus CDP dans le même hôte.
Le profil matériel n’utilise aucun faux périphérique ; le test local ne conserve
pas le PCM. Le refus est testé dans un autre profil, sans ce drapeau. Une première
tentative de descripteur CDP invalide et les essais intermédiaires en échec ne
sont pas comptés. Aucune permission personnelle ou système n’est modifiée.

La transcription et les effets métier restent simulés dans les parcours Vue ;
aucune nouvelle inférence réelle ni écoute humaine n’est revendiquée. Les
descriptions du lecteur suivent ses capacités déclarées et revérifiées ; elles
ne garantissent aucun effet Deezer. NVDA n’a pas été rejoué pour ce ticket ;
les assertions DOM/clavier et les régions live sont vérifiées dans WebView2.
Les régressions matérielles détaillées du recorder restent celles de PAM-24,
dont le code de capture est inchangé ici.

Les hôtes et profils des tests sont arrêtés/nettoyés. Les avertissements d’icône
de l’exemple et de désinscription de classe Chromium lors de la fermeture ne
constituent pas des contrôles réussis supplémentaires ; les processus terminent
avec code zéro. Aucun paquet portable/NSIS, push, publication, protocole autonome,
dépendance, profil ou audio personnel n’est inclus dans la livraison.
