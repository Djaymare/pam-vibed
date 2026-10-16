# PAM-27 — Donner des entrées simples aux paramètres avancés

Ticket : https://app.notion.com/p/3f7b3e0422a4818580f5c75d85b53e80

Run `c6124deb-00ca-405c-94f8-dd71183eebb3`, worker
`01a14426-eb29-7b23-9e12-be06c6fe86d6`, génération 27.
Base `587d4f285766a7b3a86107ba8c59747f88dc4991` sur
`codex/deezer-routing`. Vérification par le worker auteur.

L’autorisation humaine d’origine a été relue dans le chat
`01a1302e-073c-7c53-9a09-84a51b1ab6af`, tour
`01a1302e-bbe7-7a12-b52c-e190cbd18e4d`, message
`01a1302e-be0e-7f21-b801-56d9d7a578e7`. Transmission nominative
`10a30a97-3ec4-4181-b947-a0094d7cf46d`, identité réelle, génération,
empreintes de contrôle, branche, HEAD et index propres vérifiés avant écriture.
Contrat complet et prérequis Notion relus : PAM-18, PAM-19 et PAM-23 sont
Terminé ; leurs commits de livraison sont intégrés et ancêtres de la base.

## Comportement livré

L’éditeur manuel présente un champ par argument. Il conserve espaces,
guillemets, ordre et arguments vides ; retirer un champ retire un argument.
La suppression garde le focus sur le champ voisin, ou sur Ajouter.
Le JSON demeure le format du brouillon et du transport. Passer d’un mode à
l’autre ne réécrit pas le texte JSON ; une conversion invalide est refusée
avec conservation du texte. Une édition simple sérialise le nouveau tableau,
sans découper les espaces ni interpréter les guillemets.

L’aperçu affiche séparément l’exécutable et chaque valeur argv après remplacement
de toutes les occurrences de `{input}` avec la valeur de test. Les guillemets
de l’affichage JSON sont expliqués. Le transport de production garde le tableau,
et le lancement natif existant utilise `Command::args`, sans shell.
Les limites et validations Node et natives restent indépendantes et inchangées.
Les erreurs de sauvegarde/test gardent le brouillon et le dialogue.

Deezer accepte les liens HTTPS directs de `deezer.com` et `www.deezer.com`,
avec préfixe de langue facultatif, vers les sept types du registre. L’identifiant
positif de 1 à 19 chiffres reste une chaîne. Seuls les paramètres de partage
`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` et
`deferredFl` sont ignorés ; les fragments, autres paramètres, ports, identifiants
utilisateur, domaines trompeurs, chemins encodés/traversées et autres protocoles
sont refusés. Les liens courts ne sont pas suivis. Aucune requête réseau,
résolution de titre, nouvelle route ou nouvelle capacité de lecture n’est ajoutée.

Le formulaire convertit le lien en `{kind, id}` pour l’action existante
`deezer_content`. Le backend reçoit ces paramètres et les revalide avec le
registre ; un appel direct contenant une URL brute, un champ inconnu ou une route
injectée est refusé avant l’adaptateur natif. Il construit lui-même l’URI autorisée.
Le validateur Rust indépendant reste inchangé. Le brouillon du lien est gardé en
mémoire dans le propriétaire des propositions, y compris après navigation ou erreur.
Les identifiants de contenu et de smarttracklist restent disponibles avec une aide
qui distingue leur sens et les limites de lecture.

## Critères et preuves

| Critère de la fiche | Preuves |
| --- | --- |
| Fichiers avec espaces, placeholder, liens valides/refusés, messages proches du champ | Six régressions `tests/guided-inputs.test.mjs` et dix contrôles clavier WebView2 `tests/guided-input-checks.mjs` : champs exacts, aperçu, erreurs reliées par `aria-describedby`/`aria-invalid`, correction des erreurs et brouillon conservé. |
| Espaces, guillemets et `{input}` transmis sans shell | Parsing et aperçu comparés au transport réel `hostLauncher` ; tableau, chemin avec espaces, argument vide, espaces périphériques, guillemets, caractères de shell littéraux, substitution répétée et texte contenant lui-même `{input}`. Lancement Node/Rust existant non modifié. |
| Basculement simple/JSON sans perte ni réinterprétation silencieuse | Texte JSON indenté conservé exactement au basculement ; ajout, suppression et édition d’un seul élément ; JSON invalide conservé et conversion empêchée ; refus des types non chaînes avant IPC ; échecs de test/sauvegarde sans perte. |
| Liens valides, domaine trompeur, protocole et identifiant invalides testés | Tous les types et préfixes admis, identifiant long exact, paramètres de partage ; corpus hostile ; vrai module backend `createMedia`/validateur de production exécuté, zéro appel adaptateur après refus, URI canonique exacte après validation. Formulaire WebView2 prépare uniquement type/id. |

## Validations

Windows x64, Node 24.21.0, npm 11.19.0, WebView2 Edge 155.
Les logs locaux sont conservés dans `artifacts/autonomy/` ; les fixtures et
régressions requises sont versionnées et ne dépendent pas de ces logs.

| Commande | Résultat |
| --- | --- |
| `npm test` | 318/318, zéro échec/ignoré ; `pam27-npm-test-delivery.log`. |
| `node --test tests/guided-inputs.test.mjs` | 6/6 ; `pam27-targeted-final.log`. |
| `npm run build` avec entrées Windows identiques | TypeScript et Vite réussis ; `pam27-build.log` et `pam27-build-inputs.json`, 67 fichiers comparés octet par octet et par SHA-256. |
| `npm run test:deezer:routing` | 48 contrôles corrects avec Needle réel ; `pam27-deezer-routing.log`. Aucun effet lecteur réel. |
| `node scripts/test-modals.mjs --guided-only` | 10/10 dans WebView2, clavier réel et services natifs simulés ; `pam27-webview-guided-final.log`. |
| `node scripts/test-modals.mjs --navigation-only` | 25 contrôles clavier/DOM accessible ; `pam27-webview-navigation-final.log`. |
| ESLint, Prettier, `git diff --check` | Réussis ; fichiers ciblés et suites de composables/vues existantes, `pam27-checks.json`. |

Les premiers contrôles ont détecté des API JavaScript hors de la cible TS,
un import manquant dans l’ancien chargeur de fixture et la remise à zéro réelle
du brouillon Deezer pendant la navigation. Ces points ont été corrigés ; aucun
test de validation n’a été supprimé. Les sélecteurs du parcours existant ouvrent
maintenant le mode JSON et le panneau d’identifiant avant de tester leurs champs.
Deux passages concurrents ont fait échouer un budget temporel existant ; le
passage final isolé a réussi sans modifier ce test ni son seuil.

Le build racine a refusé les dépendances Linux préexistantes. Elles sont préservées.
Le build et le lint utilisent la copie Windows avec les mêmes sources, configuration
et lockfile. Les processus WebView2 de test sont arrêtés et leurs profils jetables
supprimés par le `finally` des parcours réussis.

## Fichiers et limites

Composant `LaunchArguments.vue`, parseurs `launchArguments.ts`/`deezerLink.ts`,
éditeur d’application, contrôles média et propriétaire du brouillon ; raccordement
AssistantView. Tests de parsing/formulaire/transport/backend et parcours WebView2,
adaptation du chargeur de fixture, lint des nouveaux helpers et documentation.

Les services Tauri et la sauvegarde des parcours WebView2 sont simulés ; le DOM,
les événements clavier, la validation des champs et le focus sont réels. Le
transport argv de production est testé avec un hôte intercepté ; aucun lancement
d’application personnelle, écoute humaine NVDA, microphone, effet lecteur réel,
paquet portable/NSIS ou signature n’est revendiqué. Pas de changement Rust,
IPC, dépendance de production, permissions ou fichiers du protocole autonome.
Aucun push ni publication.
