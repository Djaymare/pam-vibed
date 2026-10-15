# PAM-10 — Expiration et invalidation des propositions

Ticket : https://app.notion.com/p/3f7b3e0422a481d5b838d439bc4fe72e

Run `c6124deb-00ca-405c-94f8-dd71183eebb3`, worker
`01a1328a-8f03-7321-97f7-04782a7ad59f`, génération 11. Base :
`3e3f558a1ef73e3834c492caf82b88b5b84ffc16`, branche `codex/deezer-routing`.
PAM-05 relu intégralement dans Notion : Terminé, preuve versionnée et commit
`1210cf04b0bdb89391a7082c3cd14c2e722d400b` présents dans cette branche.
Contrat courant et relation de dépendance conformes au snapshot transmis.
Vérification effectuée par le worker implémenteur.

## Comportement livré

Le registre local `proposals` conserve une proposition et son état métier :
`pending`, `expired`, `invalidated` ou `consumed`, avec `createdAt`, `expiresAt`
et `reason`. Un identifiant absent donne `proposal.state: unknown`, avec
`unknown_proposal`, un message exploitable et aucun chemin interne. Le statut
du tour est `invalidated` pour cet inconnu. Les tours exécutés gardent leur
résultat ; une confirmation répétée rend `consumed`, sans effet supplémentaire.
Le reçu d'une exécution partielle reste consultable sans rejeu.

L'échéance vaut exactement dix minutes. L'horloge injectable `proposalNow` est
distincte de l'horloge monotone du budget global. Le registre vérifie échéance
et empreinte avant consommation. La consommation est persistée avant les effets ;
les transitions concurrentes d'un registre sont sérialisées. Le sidecar garde
sa file de requêtes existante et le journal avant émission de PAM-03.

L'empreinte existante des applications et formulations est conservée. Toute
modification de cette empreinte invalide conservativement toutes les anciennes
propositions : notamment application, activation, alias et formulation. Une
restauration ultérieure de l'ancienne configuration ne réactive pas une
proposition déjà invalidée. Un profil devenu invalide retire les propositions
au contrôle de santé, sans modifier son fichier.

Une correction retire l'ancien plan après validation de ses paramètres et avant
la préparation/inférence de son remplacement. Une panne à cette étape conserve
`invalidated/corrected`. Un rejet de validation avant retrait laisse le plan
initial valide, comme auparavant. L'interface relit les états après une erreur.
Une correction qui enregistre un alias ajoute sa nouvelle proposition après
synchronisation de la configuration, afin de ne pas l'invalider par erreur.

L'interface affiche l'heure limite et les causes, retire Exécuter/Annuler dès
que le plan n'est plus valide et propose de reformuler. Un minuteur local d'une
seconde retire les propositions expirées, même si un traitement est en cours ;
le clic revérifie l'échéance. Les états du sidecar sont synchronisés au contrôle
de santé (15 secondes). Les modifications locales de configuration retirent
immédiatement les validations visibles. La limite de vingt entrées concerne
uniquement les résultats résolus ; toutes les propositions en attente restent.

## Règle de redémarrage

Le démarrage du sidecar purge la permission d'exécuter les anciennes
propositions : `invalidated/restarted`, ou `expired` si l'échéance est atteinte.
Les fichiers de l'ancien dossier `pending` sont migrés avant le collecteur.
Aucune proposition ni activité visuelle n'est restaurée automatiquement.
Les états terminaux restent dans le profil, sans expiration de rétention,
pour distinguer une proposition nettoyée d'un identifiant inconnu. Ces fichiers
contiennent texte et plan, sans audio. Cette règle est indiquée dans l'interface
et dans README. Les `.tmp` interrompus du nouveau dossier sont collectés selon
les mêmes règles d'appartenance et de chemins que les autres écritures PAM.

## Preuves des critères

| Critère | Preuve suivie |
| --- | --- |
| Dix minutes, configuration, correction échouée ou plus de vingt demandes : aucun bouton ne présente un plan inexécutable comme valide | `sidecar/proposals.test.cjs` : échéance exacte, changement d'alias/application, correction échouée, 25 propositions. `tests/profile-recovery.test.mjs` monte le vrai App : 25 boutons conservés puis retirés à dix minutes simulées, retrait après correction échouée et modification d'application. |
| Confirmation après dix minutes : état métier et bouton retiré | Régression Node : collecte/status puis confirmation à l'échéance et confirmation répétée donnent `expired`, aucune fuite ENOENT/chemin et zéro effet. Test Vue : réponse `expired` à la confirmation retire le bouton et affiche Reformulez. |
| Modification d'application ou d'alias invalide les propositions touchées | Régressions sur alias de fiche, formulation personnelle, désactivation et restauration de l'ancien profil. Suites assistant/command-aliases/media existantes conservent leurs compteurs d'effets et vérifient désormais les états métier. |
| Plus de vingt demandes, double confirmation et redémarrage sans proposition obsolète exécutable | 25 plans conservés ; deux confirmations concurrentes donnent une exécution et un `consumed`, puis aucun rejeu. Nouvelle instance après redémarrage et migration d'un ancien fichier expiré : permission retirée, cause conservée, zéro effet. Tests PAM-03 maintenus : interruption puis lecture du journal après redémarrage, actions connues/inconnues conservées sans rejeu. |

## Validations exécutées

Windows x64 ; Node 24.21.0, npm 11.19.0. Profils jetables uniquement ; effets
simulés, sauf le lancement d'un Node de test créant un marqueur dans l'intégration.

| Commande | Résultat | Trace locale sous `artifacts/autonomy/` |
| --- | --- | --- |
| `npm test` | 0 ; 194 réussis, aucun échec/ignoré | `pam10-test.log` |
| `npm run build` dans `artifacts/pam34/windows` | 0 ; vue-tsc et Vite réussis | `pam10-build-windows.log`, `pam10-build-inputs.json` |
| `npm run test:integration` | 0 ; Needle/Whistle réels, confirmation et marqueur, huit formulations | `pam10-integration.log` |
| `npm run test:deezer:routing` | 0 ; 48 contrôles corrects, Needle réel, effets simulés | `pam10-deezer.log` |
| `npm run test:media:commands` | 0 ; 65 contrôles corrects, Needle réel, sessions/effets simulés | `pam10-media.log` |
| `git diff --check` | 0 | Vérification avant commit |

Le build à la racine refuse les dépendances Linux préexistantes (code 1,
`pam10-build-root.log`), préservées. Le build réussi utilise les dépendances
Windows isolées existantes. Tous les fichiers `src/` et les entrées de build
sont identiques après normalisation des fins de ligne ; copie explicite des
trois fichiers Vue/TypeScript modifiés. Les tests de composants utilisent le
renderer Vue en mémoire, avec services natifs, minuteurs et enfants non concernés
simulés ; ils ne prouvent pas WebView2. Aucun fichier Rust modifié, aucun nouveau
test Rust, paquet Windows ou parcours WebView2 revendiqué pour ce ticket.

Les premiers passages ont détecté les assertions de l'ancien contrat qui
attendaient une exception ; elles vérifient maintenant les états sans retirer
les assertions d'absence de rejeu. Le test de jonction existant a identifié un
accès au dossier `pending` externe : la migration vérifie maintenant racine,
dossiers et fichiers ordinaires, et ne suit pas les jonctions/liens. Le renderer
de test a été complété pour ses directives de formulaire ; aucune assertion
produit n'a été neutralisée. Les nouvelles fixtures sont suivies et ne dépendent
pas des traces ignorées d'artifacts.

## Fichiers livrés

Ajouts : `sidecar/proposals.cjs`, `sidecar/proposals.test.cjs`,
`src/proposals.ts`, cette preuve.
Modifications : `sidecar/assistant.cjs`, `sidecar/temporary-files.cjs`,
`src/App.vue`, `src/types.ts`, `README.md`,
`tests/profile-recovery.test.mjs`, et les assertions du contrat de confirmation
dans `assistant`, `availability`, `budget`, `cardinality`, `command-aliases`,
`deezer-routing`, `media`, `needle-tools` et `protocol` sous `sidecar/`.
Aucun fichier de contrôle ou de protocole modifié.
