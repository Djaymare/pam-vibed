# PAM-29 — Corpus indépendant et politique d’exécution

Ticket : https://app.notion.com/p/3f7b3e0422a481159e40fcad70a86d92

Run `c6124deb-00ca-405c-94f8-dd71183eebb3`, worker
`01a14c2c-d806-7a72-8d29-df5126f9be37`, génération 31.
Base `e5beb5587b8d64ef672cc91d3fc8ca1c2b3da32e`, branche
`codex/deezer-routing`. Autorisation humaine relue dans le chat de lancement ;
transfert nominatif `83b88add-dc21-43a5-b33c-2c00b2333e71` confirmé avant écriture.
PAM-08, PAM-18 et PAM-28 sont confirmés Terminé avec leurs commits intégrés.
Le contrat et les dépendances sont inchangés.

## Résultat et preuves de chaque critère

1. **Seuil justifié par les faux déclenchements.** Le corpus figé comprend
   30 phrases de calibration et 30 tenues à part, chacune à l’écrit, en voix
   synthétique claire et avec bruit : 180 évaluations natives. Le balayage de la
   politique initiale sur la calibration montre, à 0,1, onze faux déclenchements
   et cinq actions erronées ; à 0,3/0,5, six exécutions sans erreur automatique
   observée ; à 0,7, cinq ; à 0,8, trois ; à 0,9/1, zéro. Le seuil existant 0,7
   est conservé sans prétendre à un optimum. Les erreurs de transcription et les
   20 propositions incorrectes motivent des confirmations obligatoires par effet.
   `docs/execution-policy.md` donne la règle et sa justification ; les trois JSON
   sous `docs/evaluation/` conservent les réponses, erreurs et mesures.
2. **Taille, provenance, séparation et catégories.** La fixture originale et
   son SHA figé, le générateur SAPI, les voix/débits, le bruit 8 dB à graine fixe,
   les attentes annotées avant mesure et les noms personnalisés disjoints sont
   versionnés. Deezer garde son nom produit commun. Le rapport indique ce partage
   et celui de Zira pour l’anglais. Aucun enregistrement humain ni externe n’est
   utilisé. Whistle et Needle Windows réels ; effets exclusivement simulés.
   `docs/execution-policy-results.md`, généré depuis les réponses versionnées,
   ventile les métriques par modalité, catégorie et langue pour les trois rapports.
3. **Négatifs, négations, ambiguïtés et erreurs conservés.** Chaque jeu comporte
   39 cas positifs et 51 négatifs après déclinaison des modalités. Les cas incluent
   citations, conversation, noms inconnus et cinq langues de transcription seule.
   Sur le jeu tenu à part : 25 confirmations, 65 refus, 19 propositions erronées,
   27 requêtes positives refusées sur 39 ; aucun effet automatique. Les erreurs
   ne sont pas corrigées en changeant le corpus ou les reconnaisseurs. Les trois
   erreurs de validation de calibration restent visibles, séparées des refus.
4. **Aucune confusion entre score et fidélité de transcription.** Le WER est
   calculé indépendamment par distance de mots depuis la référence TTS. Le jeu
   tenu à part produit 41/181 erreurs en clair et 77/181 avec bruit. Ni ces taux
   ni une probabilité de transcription ne sont dérivés de Needle. Préférences,
   premier usage, message de confirmation vocale et carte de demande emploient
   explicitement le score du choix ; la documentation explique la distinction.

La politique est dans `sidecar/assistant/confirmation.cjs`. Nouveau profil :
automatique désactivé. Après activation, seules une ouverture sans arguments ou
lecture/pause, par commande écrite unique reconnue par un déclencheur complet,
peuvent s’exécuter au-dessus du seuil. Voix, corrections, arguments fixes/libres,
demandes composées, recherche et routes Deezer, autres commandes média et effets
inconnus restent à confirmer. Les profils existants gardent leur préférence.
Le premier usage permet l’activation expliquée et affiche les erreurs de sauvegarde.
Les propositions à usage unique, validations natives, langues autorisées,
cardinalité, bornes audio et lancement sans shell sont conservés.

Les tests nouveaux couvrent la limite du score, les effets enregistrés/inconnus,
les arguments, la voix à score 1, activation/désactivation, l’exécution après
confirmation et son non-rejeu. Les régressions précédentes de doublons, budgets,
langues et routage gardent leurs assertions d’effets ; les plans désormais soumis
à consentement sont confirmés explicitement dans les tests. Les tests à horloge
simulée partagent aussi le même budget jusqu’à confirmation, avec minuteur simulé
cohérent ; le test distinct de délai réel et d’absence d’effet tardif est conservé.
La vérification de bundle exige le nouveau module, inclus par le répertoire
assistant déjà déclaré dans les ressources Tauri.

## Contrôles réellement exécutés

Environnement : Windows x64, Node 24.21.0 / npm 11.19.0. Needle révision
`c7c415a3d1b3d929014bc6e866d51ebb971f7089`, Whistle révision
`b358ddadd89b7a713b5aa131f23032d3cca1b251`. Les manifestes d’actifs sont dans les
résultats versionnés ; aucune fixture ne dépend des traces locales ignorées.

| Contrôle | Résultat / trace sous artifacts/autonomy |
| --- | --- |
| Corpus calibration natif | 90 cas complets avant changement de politique ; `pam29-calibration-baseline.json`, `.log`. |
| Rejeu calibration sur la politique finale | 90 cas, mêmes réponses natives et nombre d’inférences ; `pam29-calibration-policy.json`, `.log`. |
| Corpus tenu à part natif | 90 cas complets, Whistle + Needle réels, 0 effet réel ; `pam29-heldout-policy.json`, `.log`. |
| Rejeu tenu à part après formatage | 90 cas, mêmes décisions et réponses ; `pam29-heldout-final.json`, `pam29-heldout-replay.log`. |
| npm test | 380/380, aucun échec, ignoré ou annulé ; `pam29-npm-test.log`. |
| npm run test:confidence | 32 cas + quatre formulations, score étudié 0,2346 → 0,7202 ; `pam29-confidence.log`. Les effets sensibles restent à confirmer. |
| npm run test:deezer:routing | 48 contrôles Needle réel réussis ; `pam29-deezer-routing.log`. |
| npm run test:media:commands | 65 contrôles Needle réel réussis ; `pam29-media-commands.log`. |
| npm run test:integration | Moteurs Windows, silence Whistle, confirmation et lancement du seul exécutable de test, alias ; `pam29-integration.log`. |
| npm run build dans la copie Windows | Vue/TypeScript + Vite réussis ; 76 entrées identiques vérifiées octet par octet et SHA-256 ; `pam29-build.log`, `pam29-build-inputs.json`. |
| ESLint composables/vues, premier usage, carte et modules touchés | Aucun avertissement ; `pam29-lint.log`. |
| Prettier sources nouvelles/formatées | Réussi ; `pam29-format.log`. |
| Génération du rapport, intégrité des attentes/réponses/métriques, syntaxe des scripts | Réussis ; tests inclus dans npm test et `pam29-syntax.log`. |
| git diff --check | Réussi ; `pam29-diff-check.log`. |

Les premiers essais du harnais avaient un profil Deezer invalide et un payload
audio base64 au lieu du tableau IPC ; ils ont été corrigés avant les mesures
valides. Un essai interrompu lisait le manifeste UTF-8 en encodage Windows :
la lecture explicite UTF-8 a été ajoutée, et la calibration a été exécutée
intégralement ensuite. Aucun de ces essais n’est compté dans les résultats.
L’appel Windows PowerShell sans autorisation de scripts a échoué avant synthèse
du jeu tenu à part ; PowerShell 7 local, autorisant les scripts locaux, l’a exécuté
sans modifier les règles système. Les premiers tests/lints ont révélé les attentes
de l’ancienne politique et une mutation de prop Vue, corrigées avant les passages
réussis. Les contrôles de développement refusent le node_modules Linux racine ;
il est préservé et les sources identiques sont compilées dans la copie Windows.

## Fichiers et limites

Module et raccordement du planificateur ; défaut de configuration et profil Vue ;
premier usage, préférences et carte de résultat ; corpus figé, synthèse, évaluation,
métriques et génération de rapport ; tests nouveaux et régressions adaptées ;
commande npm et vérificateur de bundle ; trois rapports JSON, politique, résultats
et cette preuve. Aucun fichier de contrôle de l’autonomie n’est modifié.

Ce corpus est indépendant des formulations de régression mais construit et annoté
par l’implémenteur. Voix synthétiques, partage de Zira et prononciation française
des cinq langues supplémentaires limitent fortement la généralisation. Zéro erreur
automatique ici accompagne zéro exécution automatique : aucune amélioration de
reconnaissance, rappel ou garantie statistique n’est revendiquée. La faible utilité
sur les paraphrases reste visible. Les tests unitaires et la suite de confiance
vérifient séparément l’automatique écrit éligible. Aucun microphone humain,
lecteur personnel, WebView2, Rust modifié, paquet portable/NSIS ou signature n’est
validé par ce ticket. Vérification effectuée par le worker implémenteur.

Les processus de test connus sont arrêtés. Les exécutions complètes nettoient
leurs profils ; le profil synthétique de l’essai interrompu
`.runtime-cache/execution-evaluation-hdPDt4` reste local et ignoré. Sa suppression
récursive a été rejetée par la revue automatique, sans motif détaillé ; aucun
contournement n’a été tenté. Il n’a aucun processus actif ni effet personnel.
Les fichiers audio ne sont pas indexés. Aucun sous-agent, push ou publication.
