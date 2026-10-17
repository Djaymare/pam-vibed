# Politique de confirmation et évaluation PAM-29

Le score Needle mesure le choix d’un appel après interprétation, parfois après
canonicalisation. **Il ne donne aucune probabilité que Whistle ait correctement
transcrit la voix.** Le seuil ne remplace ni la validation des paramètres, ni la
confirmation. La [documentation du fournisseur](https://www.cactuscompute.com/blog/needle-confidence)
préconise une mesure sur un jeu tenu à part et une décision adaptée au coût de
l’effet. Les résultats locaux ci-dessous déterminent notre règle, sans reprendre
une promesse de calibration acoustique.

## Décision appliquée

Un nouveau profil démarre avec `autoExecute: false`. L’activation explicite est
disponible au premier usage et dans Préférences, avec la portée et les limites
visibles avant le contrôle. Les profils existants conservent leur choix enregistré.

| Demande / application / effet | Décision même avec un score de 1 |
| --- | --- |
| Voix, quelle que soit l’application | Toujours confirmer transcription, cible, action et paramètres. |
| Correction manuelle ou inférée | Toujours confirmer. |
| Plusieurs effets ou répétition | Confirmer le plan entier, sans supprimer les répétitions valides. |
| Ouverture avec arguments enregistrés, même fixes, ou `{input}` | Toujours confirmer ; les arguments peuvent envoyer un message ou un lien. |
| Recherche, identifiant de contenu, sélection, rechargement Deezer | Toujours confirmer les paramètres et l’effet. |
| Piste suivante/précédente, arrêt, bascule lecture/pause, effet inconnu futur | Toujours confirmer. |
| Une ouverture sans aucun argument, ou lecture/pause, par commande écrite | Automatique possible seulement après activation, score au moins égal au seuil, et correspondance complète avec un déclencheur existant de la seule application configurée. |
| Faible score, score absent, appel supprimé ou champ non ancré | Toujours confirmer. |
| Plan invalide, négation/ambiguïté refusée, capacité indisponible, langue de transcription seule | Aucun effet ; les garde-fous existants s’appliquent avant la politique. |

Une formulation mémorisée n’accorde pas de dérogation à ces règles. Une paraphrase
libre non couverte par un déclencheur complet reste à confirmer. Le clic utilise
les propositions existantes, limitées dans le temps, invalidables et à usage unique.
Les contrôles natifs, la cardinalité et le lancement sans shell restent appliqués.
L’utilisateur qui active l’automatique choisit toujours les exécutables : aucun
classement ne certifie qu’un exécutable arbitraire soit inoffensif.

## Corpus et séparation

`tests/fixtures/execution-corpus.json` contient 60 phrases originales synthétiques,
étiquetées par l’implémenteur avant les mesures : 30 de calibration, 30 tenues à
part. Empreinte SHA-256 après normalisation CRLF vers LF :
`f09549a56e240e312a819f868880717d1a2978401fdc885cc71b10eedb6b15ad`.
Les huit noms personnalisés sont disjoints entre les jeux ; Deezer conserve son
nom produit commun. C’est à ces noms personnalisés que se rapporte la séparation
des noms indiquée dans les métadonnées de la fixture. Les phrases n’ont pas servi
à écrire ou modifier les regex. Aucune regex, aucun alias de production, aucun
prompt d’inférence n’a été ajusté sur leurs résultats.

Chaque phrase est traitée à l’écrit, en audio clair et en audio avec bruit blanc
déterministe à 8 dB de rapport signal/bruit : **90 évaluations par jeu**, dont
39 requêtes positives et 51 négatives. Les catégories incluent ouverture, média,
effets sensibles, paramètres libres, négation, ambiguïté, citation, conversation,
nom inconnu et les cinq langues réservées à la transcription. Les attentes sont
des plans explicites (application, action, paramètres et ordre), sans inférence
du résultat attendu depuis le score ou la transcription produite.

Les enregistrements sont générés localement avec Windows SAPI/System.Speech,
sans microphone ni voix personnelle : Hortense Desktop pour le français de
calibration ; Julie et Paul pour le français tenu à part ; Zira Desktop pour
l’anglais des deux jeux. Le débit passe de 0 à 1. Les cinq autres langues sont
prononcées par les voix françaises : c’est un test de refus et de résistance,
**pas une évaluation acoustique représentative de locuteurs natifs**. La voix
anglaise est partagée entre les jeux ; les voix synthétiques et les répétitions
de la même phrase ne sont pas des observations humaines indépendantes.

Les voix écrivent du PCM mono 16 kHz/16 bits. Le script ajoute 250 ms de silence
de chaque côté et un bruit à graine 290018. Les SHA des WAV, noms des voix,
transcriptions, scores, appels, erreurs et réponses natives sont dans les rapports.
Les WAV et profils jetables ne sont pas versionnés et sont supprimés après usage.
Tous les effets d’application et média sont simulés. Whistle et Needle Windows
sont réellement exécutés ; les révisions et empreintes de leur manifeste sont
conservées avec les résultats. Aucun jeu de données externe ni enregistrement
dont les droits seraient inconnus n’est utilisé.

## Mesures et choix du seuil

Les [résultats détaillés](execution-policy-results.md) sont générés depuis les
[réponses de calibration initiales](evaluation/execution-calibration-baseline.json),
leur [rejeu avec la politique](evaluation/execution-calibration-policy.json) et
le [jeu tenu à part](evaluation/execution-heldout-policy.json).

Un faux déclenchement est une exécution automatique pour une attente sans effet.
Une action automatique erronée est un plan exécuté différent de l’attente positive,
y compris ses paramètres. Une proposition erronée est comptée même si elle reste
à confirmer. Un refus inclut une absence de plan et les erreurs de validation,
qui sont aussi comptées séparément. La fidélité de transcription est mesurée par
distance de Levenshtein sur mots en minuscules, ponctuation retirée, normalisation
NFKC ; le WER peut dépasser 100 %. Elle n’est jamais calculée depuis Needle.

La politique initiale à 0,1 aurait déclenché **11 requêtes négatives et cinq
actions positives erronées** sur la calibration. À 0,3/0,5 : six exécutions,
aucune erreur automatique observée ; à 0,7 : cinq ; à 0,8 : trois ; à 0,9/1 :
zéro. Cela justifie de ne pas abaisser le seuil existant de **0,7**, retenu comme
compromis conservateur parmi les seuils sans faux déclenchement observé. Ces
petits effectifs ne démontrent aucun optimum, ni un taux d’erreur en population.
Les 20 propositions incorrectes et les transcriptions dégradées motivent surtout
les confirmations par effet, plutôt qu’un nouveau seuil global.

La politique finale produit **30 confirmations et 60 refus** en calibration,
puis **25 confirmations et 65 refus** sur le jeu tenu à part. Aucune exécution
automatique n’a lieu dans ces deux jeux difficiles : zéro faux déclenchement
observé est donc une conséquence de la politique conservatrice, **pas une preuve
de qualité du modèle**. Les commandes simples éligibles et leurs effets sont
vérifiés séparément par les régressions et la suite réelle de confiance.

Le jeu tenu à part conserve **19 propositions incorrectes**, et refuse 27 des
39 requêtes positives. Les plans exacts sont 44/90, négatifs correctement refusés
compris. La couverture et l’utilité des paraphrases restent limitées ; aucune
amélioration de rappel n’est revendiquée. Une confirmation peut présenter un
mauvais choix : l’utilisateur doit pouvoir le corriger ou le refuser.
La transcription tenue à part a 41/181 erreurs de mots en audio clair (22,65 %)
et 77/181 avec bruit (42,54 %), indépendamment des scores d’action. Le balayage
des seuils sur ce jeu est descriptif après validation et n’a changé aucune règle.

## Reproduction et limites

Depuis un environnement Windows préparé selon `docs/development.md`, avec les
voix nommées installées et PowerShell 7 autorisant les scripts locaux :

```powershell
npm run test:execution:calibration
npm run test:execution
node scripts/report-execution.mjs
```

`PAM_EVALUATION_POWERSHELL` peut sélectionner le chemin de PowerShell. Aucune
politique d’exécution système n’est modifiée. Un outil ou une voix absente fait
échouer l’évaluation. Les commandes réelles utilisent la politique actuelle ;
la référence initiale versionnée conserve celle de la base du ticket.
Pour vérifier la décision actuelle avec les réponses natives figées :

```powershell
node scripts/evaluate-execution.mjs calibration --replay=docs/evaluation/execution-calibration-baseline.json
node scripts/evaluate-execution.mjs heldout --replay=docs/evaluation/execution-heldout-policy.json
```

Le rejeu contrôle le nombre d’inférences et les réponses consommées, puis traverse
le planificateur, la validation et le journal de propositions réels. Il ne rejoue
ni l’acoustique ni le moteur ; seuls les premiers passages natifs mesurent ceux-ci.
Après formatage sans modification de règle, le rejeu du jeu tenu à part a confirmé
les mêmes décisions. Les reconnaisseurs et le corpus sont restés figés.

Les fixtures sont élaborées par l’implémenteur, sans annotateur externe ; aucune
revue indépendante, représentativité des accents humains, robustesse microphone,
session média personnelle, test WebView2, installeur ou signature n’est revendiqué.
Un corpus autorisé de personnes, accents et bruits réels restera nécessaire avant
d’élargir l’automatique vocal ou de prétendre à des garanties statistiques.
