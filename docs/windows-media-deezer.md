# Multimédia Windows et Deezer Music

Inventaire et essais du **11 octobre 2026**, Windows 10 Professionnel x64 **19045**. Les résultats concernent les versions ci-dessous. Un changement de lecteur, de page web, de compte ou de version peut modifier les sessions et les routes.

PAM pilote une session Windows explicitement associée à une application. Deezer dispose aussi de liens de navigation et de lecture de sélections. Selon le choix de l’utilisateur, aucune fonction de lecture d’une chanson précise ou d’insertion en prochaine position n’est exposée : ces deux opérations n’ont pas de protocole externe vérifié.

## Configuration et commandes

Dans **Applications**, ajouter ou modifier un lecteur, ouvrir un média dans ce lecteur, puis **Actualiser les sessions** et choisir son identifiant Windows. Pour Deezer, sélectionner **Deezer Music** dans le catalogue Windows et activer son plugin ; la session observée est `Deezer.exe`. L’identifiant de lancement Store est différent : `Deezer.62021768415AF_q7m17pa7q8kj0!Deezer.Music`.

Dans **Assistant → Lecteurs multimédias**, les boutons correspondent aux capacités de la session sélectionnée. Les boutons préparent toujours une action à valider dans l’activité récente. Les demandes écrites et vocales suivent les préférences de confiance habituelles ; leur score Needle reste le score réel du moteur.

Exemples avec l’alias « Diseur » :

- `Joue Diseur` : reprendre la session Deezer actuelle.
- `Pause Diseur` : mettre cette session en pause.
- `Piste suivante Diseur` : passer au prochain élément déjà dans la file.
- `Afficher la chanson 3135556 dans Deezer` : afficher sa page.
- `Rechercher Daft Punk dans Deezer` : afficher une recherche.
- `Démarrer Flow dans Deezer` : demander la lecture de Flow.

Une demande composée ou formulée différemment reste soumise au routage du modèle. Vérifier l’action proposée avant confirmation. Les exemples d’intégration ont des scores inférieurs à 70 % et sont donc restés en attente ; aucun score n’a été relevé artificiellement. Une première intégration a révélé un mauvais choix entre navigation et Flow : les formulations explicites sont désormais restreintes à l’outil de l’action demandée, avec conservation des arguments de la demande.

Les identifiants de contenus et de sélections doivent venir de l’utilisateur. PAM ne transforme pas un titre en identifiant inventé. Les liens de contenu et de recherche ne garantissent ni une page valide pour le compte courant, ni la disponibilité du média dans son pays.

## Adaptateur Windows partagé

L’API native est [GlobalSystemMediaTransportControlsSessionManager](https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssessionmanager?view=winrt-26100), disponible à partir de Windows 10 1809. PAM énumère `GetSessions`, lit `SourceAppUserModelId`, les métadonnées et [les capacités actuelles de lecture](https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssessionplaybackcontrols?view=winrt-26100).

Les commandes `TryPlayAsync`, `TryPauseAsync`, `TrySkipNextAsync`, `TrySkipPreviousAsync`, `TryStopAsync` et `TryTogglePlayPauseAsync` sont proposées selon leurs indicateurs. Avant exécution, PAM relit les sessions et les capacités. Le bridge Rust vérifie encore que l’objet choisi appartient aux sessions présentes, puis consulte le booléen renvoyé par Windows. Un refus ou un résultat absent produit un échec. Un résultat `true` signifie **commande acceptée** ; les métadonnées peuvent se mettre à jour plus tard. L’interface ne présente pas ce résultat comme une transition déjà observée.

Le ciblage compare l’identifiant complet, sans distinction de casse. L’absence de session, sa fermeture et plusieurs sessions du même identifiant sont des erreurs explicites. PAM ne choisit pas arbitrairement l’une d’elles. Aucun recours à la session « courante », à des touches multimédias globales ou à un autre lecteur n’est effectué. Un lecteur sans GSMTC peut être ouvert comme auparavant, mais ses commandes multimédias restent indisponibles.

Le sidecar appelle le même exécutable PAM avec `--pam-native`, avant le démarrage de Tauri. Le transport est JSON par pipes, sans shell, avec un délai de 12 secondes et sans rejeu automatique. Aucun module PowerShell, serveur ou runtime supplémentaire n’est requis chez l’utilisateur. La configuration multimédia fait partie de l’empreinte d’une confirmation : changer la cible invalide la proposition, et une confirmation consommée ne peut pas être rejouée.

## Sources du protocole Deezer

Le manifeste installé de **Deezer Music 8.0.0.0 x86**, paquet `Deezer.62021768415AF_8.0.0.0_x86__q7m17pa7q8kj0`, déclare les schémas **`deezer` et `dzr`**. `app/resources/app.asar`, fichiers `build/main.js` et `build/preload.js`, contient le gestionnaire `DeepLinkService`. Celui-ci retire l’hôte `www.deezer.com`, normalise le chemin et envoie `app-go-to-raw` à l’application connectée. PAM produit la forme canonique `deezer://www.deezer.com/...`, ciblée par Windows vers la famille exacte du paquet Store avec `LauncherOptions`.

Le décodeur public Deezer, module `LOxp` de [route-deeplink.be0caa3b324f13abde1f.js](https://cdn-files.dzcdn.net/cache/js/route-deeplink.be0caa3b324f13abde1f.js), établit les opérations spéciales et leurs paramètres. Les routes ordinaires sont définies dans [app-web.6399ee357b7a19c0f09e.js](https://cdn-files.dzcdn.net/cache/js/app-web.6399ee357b7a19c0f09e.js), chargé depuis [la page publique de chanson](https://www.deezer.com/fr/track/3135556). Ce sont des fichiers publiés par Deezer et du code installé localement ; ils ne constituent pas une garantie contractuelle d’API stable.

Empreintes SHA-256 examinées :

| Source | SHA-256 |
| --- | --- |
| `build/main.js` installé | `4096542b98ef4d340af643dbd4f8f9818a492d92b6dd0fb1ddd652e6cbbcbc3b` |
| Décodeur public `route-deeplink` | `dae524afd09fb02a1503012f871deb2e57d7cd47ae7082bd2ebd9863bb444a79` |
| Routeur public `app-web` | `4886c3106b472dabb0e53963430c6890357d22896494f14ea2644b278230cdc6` |

`node scripts/inspect-deezer-protocols.mjs` répertorie le paquet, les schémas et les empreintes sans extraire de code. Ajouter `--web` pour vérifier les deux ressources publiques datées. Le script ne lit ni cookies, ni stockage du compte, ni jetons. Si les empreintes changent, réexaminer les routes avant d’élargir l’allowlist. Les extraits propriétaires inspectés ne sont pas distribués avec PAM.

## Routes intégrées

Tous les chemins du tableau utilisent le préfixe canonique ci-dessus. Les schémas, paramètres et valeurs permis sont validés dans le sidecar et dans Rust ; un URI libre n’est jamais un argument d’outil.

| Chemin | Paramètre accepté | Effet établi et validation |
| --- | --- | --- |
| `/track/{id}` | Identifiant numérique positif, au plus 19 chiffres | Afficher la chanson. Envoi réel accepté ; la chanson courante et l’état pause sont restés identiques. |
| `/album/{id}`, `/artist/{id}`, `/playlist/{id}` | Même format d’identifiant | Navigation établie par le décodeur et le routeur ; pas de lecture précise annoncée. |
| `/show/{id}`, `/episode/{id}`, `/profile/{id}` | Même format d’identifiant | Navigation établie par le routeur public ; pas de validation visuelle individuelle sur cette machine. |
| `/search/{query}` | Texte de 1 à 200 caractères, encodé comme un segment d’URL | Afficher des résultats ; caractères Unicode et réservés couverts par les tests. Ne sélectionne pas automatiquement une chanson. |
| `/`, `/podcasts` | Aucun | Accueil et podcasts, routes du routeur public. |
| `/channels/explore`, `/channels/charts`, `/channels/moods`, `/channels/radios` | Page fixe de l’énumération | Navigation vers explorer, classements, ambiances et radios ; route `/channels/*` et redirections publiques établies. |
| `/settings/audio` | Aucun | Le décodeur ouvre les réglages audio. |
| `/settings/app_theme` | Aucun | Le décodeur ouvre le choix d’apparence. |
| `/reload` | Aucun | Le gestionnaire de bureau recharge Deezer. L’envoi du lien ne confirme pas la fin du rechargement. |
| `/user/me/flow` | Aucun | Le décodeur appelle la lecture de la radio de l’utilisateur connecté. Lecture réelle, session, pause, reprise et piste suivante vérifiées. |
| `/user/me/tracks` | Aucun | Le décodeur appelle la playlist des coups de cœur de l’utilisateur connecté. Chemin établi dans le code ; lecture réelle de cette playlist non mesurée. |
| `/smarttracklist/{id}` | Identifiant explicite de 1 à 80 caractères ASCII alphanumériques, `_` ou `-` | Afficher une sélection. Aucun identifiant réel de sélection n’a été disponible pour un essai de contenu. |
| `/smarttracklist/{id}?autoplay=true` | Même identifiant, mode « demander sa lecture » | **Ce chemin précis** appelle la lecture dans le décodeur. Il reste conditionné à une sélection valide et au compte. Code vérifié ; lecture de bout en bout non mesurée. |

Le paramètre `autoplay` lu pour les chemins chanson/album/artiste/playlist/profil est une expression sans appel de lecture dans le décodeur examiné. PAM ne le propose pas sur ces contenus. La politique Chromium `autoplay-policy` du bureau ne définit pas un paramètre de protocole. Le schéma `dzr` est accepté par le bureau et par la validation native ; PAM émet uniquement la forme canonique `deezer`.

Les pages, contenus et sélections ci-dessus sont accessibles par les outils Needle et par les boutons, avec **Autres liens Deezer** pour les pages et smarttracklists. Un protocole accepté par Windows signifie que le lien a été transmis au paquet, pas que son contenu s’est ouvert ni qu’une lecture a démarré. Les messages utilisateur font cette distinction.

## Autres routes repérées et limites

L’inventaire du décodeur et du gestionnaire de bureau comprend aussi les chemins suivants. Ils ne sont pas inscrits comme actions PAM lorsqu’ils dépendent d’un service non vérifié, modifient le compte, ou sortent du pilotage multimédia demandé.

| Routes ou variantes | Comportement repéré | Décision |
| --- | --- | --- |
| `/home`, `/explore`, `/charts`, `/tops`, `/tour`, `/moods`, `/radio`, `/shows` | Redirections vers les pages canoniques | PAM utilise les destinations canoniques du tableau précédent. |
| Sous-pages artiste, profil et recherche ; autres `/channels/*` | Onglets et pages du routeur | PAM expose les pages principales et les destinations fixes établies, sans argument de chemin libre. |
| `/queue` | Ouvre l’interface de file si `feature_2026_queue_revamp` est active | Fonction conditionnelle non vérifiée ; **aucune insertion** n’est décrite par ce chemin. |
| `/flow_tuner/{id}` | Ouvre la personnalisation Flow si `feature_2025_flow_custo` est active | Non exposé, disponibilité non vérifiée. |
| `/simplestory/{id}`, `/story`, `/game...`, `/genplaylist...` | Stories, jeux ou webview ; `genplaylist` dépend d’un indicateur de fonction | Non exposés, fonctions extérieures aux lecteurs et non vérifiées en session. |
| `/profile/me/playlists/create` | Ouvre un assistant de création de playlist | Non exposé : aucune création ou modification de bibliothèque demandée. |
| `/settings`, `/settings/app`, `/settings/display_settings`, `/premiumtab` | Compte, paramètres ou offres ; certaines branches ouvrent une fenêtre web | Non exposés : gestion du compte et offres hors périmètre. |
| `/redirect?url=...` | Ouvre un URL arbitraire | Non exposé. |
| `/autolog/...` | Authentification avec un jeton | Non utilisé ; aucune lecture ou extraction de jetons. |
| `/flushCache` | Efface paramètres/cache/stockage et redémarre | Refusé ; opération destructive hors périmètre. |

**Jouer une chanson précise** : aucune route externe établissant cette opération n’a été trouvée. Le lien `/track/3135556` a été reçu par Deezer, mais n’a pas remplacé le morceau en cours ni lancé sa lecture. PAM peut afficher la page ou rechercher le titre ; l’utilisateur choisit ensuite la lecture dans Deezer.

**Insérer une chanson en prochaine position** : aucune route ni paramètre externe vérifié. Le lecteur web dispose de fonctions internes de file, mais elles ne constituent pas une interface de protocole accessible à PAM. Aucun accès privé à ces fonctions, aucune automatisation de menus et aucun outil factice ne sont ajoutés. Une demande d’insertion n’est pas transformée en saut de piste.

## Essais réels et compatibilité

Les tests ont utilisé un profil PAM isolé, deux WAV de silence et un profil Opera temporaire. Ils ont fermé leurs propres instances de test. Deezer a conservé l’état pause initial après ses essais ; son Flow et sa file ont été parcourus par les commandes explicitement autorisées. Les rapports JSON locaux omettent les titres et artistes personnels.

| Lecteur testé | Résultat mesuré | Conséquence dans PAM |
| --- | --- | --- |
| Deezer Music Store 8.0.0.0 | Session `Deezer.exe`. Flow démarre ; pause et reprise changent l’état ; suivante change le titre. `track/3135556` transmet la navigation sans démarrer cette chanson. | Lecture/pause/suivante disponibles selon capacités ; liens de navigation distincts. Précédente, arrêt et bascule sont exposés si annoncés, sans transition réelle mesurée ici. |
| VLC 3.0.24 | Deux WAV chargés ; lecture confirmée par l’interface HTTP de cette instance de test. **Aucune session GSMTC** après démarrage. | Aucune commande multimédia proposée. Le lancement ordinaire reste utilisable. Ce constat ne décrit pas toutes les versions/extensions de VLC. |
| Opera GX 136.0.6008.76 | Page Media Session de test en lecture ; `opera.exe` annonce pause, lecture conditionnelle, suivante, arrêt et bascule. Deux sessions `opera.exe` étaient simultanément présentes. | La commande pause est refusée explicitement pour ambiguïté. Aucune commande n’a été envoyée à la session personnelle ; transitions pause/reprise/suivante de cette page non mesurées. |

L’intégration réelle vérifie aussi le refus d’un lecteur inexistant et de `/flushCache`. Le moteur Needle a choisi les outils attendus pour navigation, recherche, Flow, reprise et suivante avec alias. Chaque proposition de cette intégration a été annulée sans commande de lecture ; les essais de lecture Deezer sont un mode séparé explicite.

Le composant Vue réel a été inspecté dans un navigateur avec des sessions de test : capacités et boutons désactivés, recherche Unicode, paramètres des pages et avertissement d’ambiguïté. La fenêtre Tauri complète n’a pas pu être inspectée visuellement, la capture native Windows étant indisponible dans cette session. Son frontend est compilé et typé ; son adaptateur natif et son sidecar sont exécutés dans les vérifications du paquet.

## Reproduire les vérifications

```powershell
npm test
npm run test:integration
npm run test:media
# Ces deux modes lancent des lecteurs ou modifient la lecture :
npm run test:media:players
npm run test:media:deezer
node scripts/inspect-deezer-protocols.mjs --web
```

`test:media` nécessite Windows et le moteur préparé. Il utilise le portable `artifacts/PAM-windows-media-deezer/PAM.exe`, ou l’exemple natif compilé, ou le chemin absolu fourni dans `PAM_NATIVE_EXE`. Les profils sont créés dans `.runtime-cache/smoke-media-*`, supprimés après vérification, et passés comme `PAM_PROFILE_DIR` aux processus de test. Aucun catalogue personnel PAM n’est modifié. Les rapports restent dans `artifacts/media-{routing,players,deezer}-results.json` (ignorés par Git).

`--players` utilise VLC et Opera GX installés, ou les exécutables fournis dans `PAM_VLC_EXE` et `PAM_BROWSER_EXE`. Le serveur HTTP temporaire dessert seulement les fichiers de test ; il n’est pas intégré à PAM. Le profil du navigateur est isolé. Si le navigateur ne publie pas la page ou possède des sessions ambiguës, aucune autre session n’est ciblée.

`--deezer` exige Deezer Music installé, connecté et capable de lire Flow. Il vérifie les changements d’état et de titre avec attente des mises à jour asynchrones, puis remet la lecture dans son état initial. Il ne restaure pas le morceau ou la file antérieurs.

Pour compiler l’exemple natif et son test Rust depuis un environnement `cargo-xwin` :

```sh
cargo xwin build --release --target x86_64-pc-windows-msvc --example media
cargo xwin test --release --target x86_64-pc-windows-msvc --example media --no-run
```

Exécuter sur Windows le binaire de test `media-<empreinte>.exe` produit dans `src-tauri/target/x86_64-pc-windows-msvc/release/examples/`. Le test Rust vérifie l’allowlist native. `npm test` couvre notamment les lecteurs absents/ambigus, les capacités, les refus, les arguments stricts, la consommation des confirmations, les alias, les corrections et les limites Deezer. `npm run verify:bundle` exécute aussi l’adaptateur natif du paquet final, avant toute ouverture de Tauri.
