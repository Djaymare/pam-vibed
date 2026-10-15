# Registre des actions et capacités

`sidecar/action-registry.json` est la source déclarative des 13 actions. Son
numéro de version décrit le catalogue ; le protocole IPC reste versionné dans
`sidecar/contracts.json`. Les identifiants persistés, protocoles, pages et
capacités Deezer existants sont conservés.

Chaque action donne son identifiant, sa famille, ses libellés, son schéma de
paramètres, ses prérequis, son effet attendu et ses champs de correction.
Les descriptions et déclencheurs Needle sont aussi dans ce registre. Les tables
`options` portent les libellés, alias de reconnaissance, libellés du prompt et
chemins des pages, contenus, sélections et modes.

## Inventaire

| Identifiant | Paramètres | Prérequis supplémentaires | Effet demandé |
| --- | --- | --- | --- |
| open | input facultatif, 2048 caractères, uniquement si le modèle d’arguments de la cible contient `{input}` | Cible de lancement validée | Lancer la cible sans shell |
| media_play | Aucun | Source média configurée, session unique, capacité play | Reprendre la lecture |
| media_pause | Aucun | Idem, capacité pause | Mettre en pause |
| media_next | Aucun | Idem, capacité next | Passer au prochain élément déjà présent dans la file |
| media_previous | Aucun | Idem, capacité previous | Passer à l’élément précédent |
| media_stop | Aucun | Idem, capacité stop | Arrêter la lecture |
| media_toggle | Aucun | Idem, capacité toggle | Basculer lecture/pause |
| deezer_start | mix : flow, loved_tracks | Plugin Deezer et paquet Store exacts | Demander la lecture de la sélection |
| deezer_page | page : une des huit clés ci-dessous | Idem | Afficher la page |
| deezer_search | query : texte non vide, 200 caractères, sans caractères de contrôle | Idem | Afficher les résultats de recherche encodés |
| deezer_content | kind : track, album, artist, playlist, show, episode, profile ; id : entier positif sans zéro initial, 19 chiffres maximum | Idem | Afficher le contenu, sans lancer de chanson ou modifier la file |
| deezer_reload | Aucun | Idem | Demander le rechargement |
| deezer_smarttracklist | id : 1–80 lettres/chiffres ASCII, `_` ou `-` ; mode : display ou play | Idem | Afficher la sélection ou demander sa lecture |

Toutes les actions exigent une application active et les validations de la
proposition. La correction cible une autre application et les paramètres
déclarés ; les formulations personnelles conservent leur politique existante
(pas de mémorisation du texte input pour open). Les pages et mixes sont proposés
comme choix préparamétrés. Les autres champs Deezer sont rendus à partir du
schéma, avec leurs valeurs par défaut, options, bornes et aides.

| Page | Chemin après deezer://www.deezer.com/ |
| --- | --- |
| home | Vide |
| podcasts | podcasts |
| explore | channels/explore |
| charts | channels/charts |
| moods | channels/moods |
| radios | channels/radios |
| audio_settings | settings/audio |
| theme | settings/app_theme |

Les mixes utilisent `user/me/flow` et `user/me/tracks`. La route historique native
`explore` reste acceptée ; le routeur produit `channels/explore`. Le natif
accepte seulement les protocoles deezer et dzr pour l’hôte exact. Le routeur
produit deezer. Un lien accepté par Windows ne prouve pas que Deezer a commencé
la lecture ; la session Windows sert à vérifier le résultat.

## Consommateurs et frontière native

- `sidecar/action-registry.cjs` résout les enums de paramètres, valide les
  valeurs et construit les chemins ; deezer.cjs conserve ses API publiques.
- intent.cjs produit le catalogue d’outils, command-aliases.cjs les identifiants
  autorisés, et media.cjs les commandes disponibles dans le catalogue.
  deezer-commands.cjs utilise les alias et libellés des options.
- `scripts/generate-contracts.mjs` dérive l’enum CommandAction, les types IPC,
  `src/actions.generated.ts` et le corpus `tests/fixtures/action-routes.json`.
  La génération vérifie aussi les fichiers existants avec `--check`.
- `src/actions.ts`, CommandArguments et MediaControls utilisent les mêmes
  choix, paramètres et libellés. Les textes d’assemblage propres à un parcours
  restent dans ce parcours.
- `src-tauri/src/media.rs` garde une liste autorisée et une validation de
  structure indépendantes, jamais générées depuis le catalogue. Une action ou
  route inconnue est refusée avant COM, accès aux sessions ou lancement.

Une capacité **théorique** indique ce que PAM sait demander à ce type de lecteur.
Elle ne prouve aucune disponibilité. Le catalogue Node filtre les commandes
média selon une session vivante unique et ses capacités courantes ; le panneau
Vue désactive les boutons correspondants. L’exécution revérifie le lecteur et
la capacité. Une session absente, ambiguë, fermée ou modifiée ne déclenche aucun
repli vers le lecteur courant. Les liens Deezer dépendent du plugin et du paquet,
et ne nécessitent pas une session GSMTC active pour afficher une page.

## Ajouter ou modifier une action

1. Modifier le registre : identifiant stable, famille, paramètres, libellés,
   prérequis, effet, corrections et métadonnées du modèle. Pour une page ou un
   contenu, ajouter l’entrée d’options et ses alias. Ne pas recopier les enums
   dans Vue, Node ou contracts.json.
2. Si l’effet nécessite un nouvel adaptateur ou une nouvelle reconnaissance,
   l’implémenter et ajouter les scénarios métier. Une nouvelle entrée déclarative
   ne crée pas une capacité système et ne justifie pas une route non vérifiée.
3. Faire réviser explicitement la liste native indépendante si une route ou une
   commande change. La concordance échoue tant que cette frontière n’est pas
   mise en cohérence ; ne pas la générer ni élargir un joker pour faire passer
   le contrôle. Les limites natives des identifiants restent indépendantes.
4. Exécuter `node scripts/generate-contracts.mjs`, puis `npm test`,
   `npm run build`, les suites de routage/média pertinentes et les tests Rust
   Windows. Commiter les sorties générées et les fixtures avec le registre.

`tests/action-registry.test.mjs` compare le catalogue, les choix et formulaires
Vue réels, les schémas IPC et outils Node, le routeur et les listes Windows.
Des mutations de page, contenu, action, protocole et liste native sont détectées.
Les tests Rust exécutent le validateur indépendant avec le corpus généré et les
bornes/URI hostiles. Modifier une source sans régénérer fait échouer npm test.
Les ressources Tauri et la vérification du paquet incluent les deux nouveaux
fichiers sidecar ; les tests ne dépendent d’aucun fichier sous artifacts.
