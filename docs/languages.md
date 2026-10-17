# Langues de transcription et de commande

L’interface et ses messages restent en français. Les noms des langues et leurs
limites proviennent de `sidecar/languages.json`, partagé avec le sidecar. Les
préférences affichent ces limites avant le sélecteur et dans chaque option.
Une langue de transcription ne garantit pas la compréhension des commandes.

| Choix                 | Transcription Whistle       | Reconnaissance / ouverture                  | Négation / ambiguïté                                         | Correction                                               | Exécution                                                   |
| --------------------- | --------------------------- | ------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------- | ----------------------------------------------------------- |
| Français              | Oui                         | Commandes FR du registre                    | Garde-fous FR, citations et choix entre applications refusés | Texte FR ou action manuelle                              | Actions validées du registre                                |
| Anglais               | Oui                         | Commandes EN du registre                    | Garde-fous EN, citations et choix entre applications refusés | Texte EN ou action manuelle                              | Actions validées du registre                                |
| Allemand              | Oui                         | Aucune proposition                          | Aucune action, même si le modèle pourrait comprendre         | Action manuelle uniquement                               | Confirmation du choix manuel uniquement                     |
| Espagnol              | Oui                         | Aucune proposition                          | Aucune action                                                | Action manuelle uniquement                               | Confirmation du choix manuel uniquement                     |
| Italien               | Oui                         | Aucune proposition                          | Aucune action                                                | Action manuelle uniquement                               | Confirmation du choix manuel uniquement                     |
| Néerlandais           | Oui                         | Aucune proposition, même pour « Open Test » | Aucune action                                                | Action manuelle uniquement                               | Confirmation du choix manuel uniquement                     |
| Polonais              | Oui                         | Aucune proposition                          | Aucune action                                                | Action manuelle uniquement                               | Confirmation du choix manuel uniquement                     |
| Détection automatique | Langue renvoyée par Whistle | Seulement si FR ou EN détecté dans l’audio  | Mêmes garde-fous ; langue absente/inconnue refusée           | Action manuelle ; pour corriger par texte, choisir FR/EN | Jamais si détection non prise en charge ; texte seul refusé |

Les sept langues concrètes sont les choix de transcription exposés par PAM au
moteur local. Leur présence n’est pas une mesure de précision acoustique pour
tout accent ou tout bruit. Le corpus de ce ticket valide la politique après
transcription et l’inférence Needle ; les transcriptions audio des tests sont
des fixtures, sans prétention de validation acoustique multilingue.

Le français et l’anglais permettent les formulations définies dans le registre,
les reconnaisseurs média et les formulations personnelles. Cela ne promet pas
la compréhension de toute phrase, la traduction de l’interface ou de nouveaux
protocoles : une commande non reconnue reste à reformuler. Les possibilités
Deezer, leurs noms de pages et leurs limites restent celles du registre. Une
proposition reste soumise aux validations de paramètres, capacités, ciblage,
confiance et confirmation existantes.

La langue choisie gouverne aussi les demandes écrites et les formulations
mémorisées : choisir « transcription uniquement » empêche leur inférence et
leur exécution automatique, avant tout alias. En mode automatique, seul le
résultat de transcription Whistle autorise FR/EN ; la locale renvoyée ensuite
par Needle ne peut changer cette décision. Les profils existants conservent
leurs codes de langue et restent importables sans migration.

« Corriger la demande » permet toujours de choisir explicitement une application,
une action et ses paramètres. Cette décision manuelle produit une proposition
à confirmer ; elle ne valide pas une interprétation linguistique et n’exécute
rien lors de la correction. Les cinq langues de transcription ne sont donc
jamais annoncées comme langues de commande.

Le corpus versionné `tests/fixtures/language-corpus.json` couvre ouverture,
négation, ambiguïté et correction pour chaque langue concrète.
`sidecar/languages.test.cjs` utilise un modèle volontairement favorable à
l’ouverture pour vérifier les refus et les effets ; il couvre aussi la
détection automatique, les alias et la correction manuelle confirmée.
`tests/languages.test.mjs` vérifie le sélecteur et l’aide accessible.
`npm run test:languages` exécute le même corpus avec Needle Windows réel pour
FR/EN et vérifie les refus des autres langues, avec profils jetables et effets
simulés. `npm run test:confidence`, `npm run test:deezer:routing` et
`npm run test:media:commands` contrôlent les protections et routages existants.
