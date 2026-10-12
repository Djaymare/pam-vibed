# PAM-08 — Refuser les lancements dupliqués pour une commande simple

Ticket : https://app.notion.com/p/3f7b3e0422a481c8b81bdd48d0ccfb5c

Livraison du 13 octobre 2026, branche `codex/deezer-routing`, base
`cdb6f9da4250642f5d8faf7c161fab14e6297423`. Aucun prérequis bloquant.

## Contrat et comportement

Une invocation littérale, un alias de commande ou une correction résolue vers
une seule action autorise exactement un appel non vide, ouverture comprise.
La cardinalité est vérifiée sur tout le plan avant exécution ou création d’une
proposition à confirmer. Un plan invalide produit une erreur demandant de
reformuler ; aucun de ses appels n’est lancé. Le seuil global reste inchangé.

Les demandes composées gardent leurs appels dans l’ordre. Les clauses sont
séparées par `et`, `puis`, `and`, `then`, une virgule ou un point-virgule.
Chaque application autorise une ouverture, sauf lorsque ses clauses littérales
en demandent davantage. `Ouvre Test et Autre` conserve deux lancements ; un
troisième appel inventé invalide tout le plan.

Les répétitions d’ouverture sont reconnues dans les clauses correspondant sans
ambiguïté à un nom/alias configuré : `Ouvre Test deux fois`, `Ouvre deux fois
Test`, `Open Test twice`, `Open Test 2 times` ou `Ouvre Test puis ouvre Test`.
Les nombres de 1 à 8 en chiffres ou en mots français/anglais sont pris en charge,
ainsi que `once` et `twice`, avec la borne existante de huit appels par plan.
Le nombre est propre à l’application concernée : `Ouvre Test deux fois et Autre`
autorise deux ouvertures de Test et une d’Autre. Un nombre insuffisant ou excessif
est refusé, sans réduire silencieusement la répétition.

Les citations et le texte après `avec le texte` / `with the text` ne donnent
aucune autorisation de répétition. Une formulation non reconnue ne permet pas
d’augmenter le nombre d’ouvertures ; elle demande une reformulation lorsque le
modèle propose des doublons. Cette validation locale ne prétend pas comprendre
toute formulation libre. Une commande valide de faible confiance, supprimée
par Needle ou marquée ambiguë/non ancrée reste à confirmer. La confirmation
conserve le plan et ne peut pas être rejouée.

## Preuves par critère

| Critère | Preuve |
| --- | --- |
| Appel inventé refusé et plans composés conservés | `cardinality.test.cjs` vérifie zéro lancement pour un troisième appel inventé, deux lancements pour deux applications, et le maintien des résultats utilisateur. |
| Aucune double ouverture pour une commande simple | Régression `Ouvre Test` à 99 %, variante libre, vocal, appels supprimés : refus avant tout lancement. Un appel simple valide produit exactement un lancement et un résultat réussi. |
| Répétition explicite et multi-application valides | Tests des formulations françaises/anglaises, majuscules, clauses répétées, profil avec une seule application, attribution du nombre à chaque cible, dépassement et réduction interdits. |
| Faible confiance / ambiguïté : confirmation | Tests à 20 %, `validation.ungrounded` et `suppressed_calls` : zéro effet avant confirmation, puis le nombre attendu, sans rejeu. Une répétition à faible confiance confirme le plan entier. |

## Validations réellement exécutées

Windows x64, Node `24.21.0`, npm `11.19.0`, runtime Needle/Whistle Windows présent.

| Commande / contrôle | Résultat | Trace locale |
| --- | --- | --- |
| Régression avant correctif | Échec attendu : double appel accepté | `artifacts/autonomy/pam08-before.log` |
| Reproduction au code du commit de base | 99 %, `executed`, **2 lancements simulés et 2 résultats** | `artifacts/autonomy/pam08-baseline-reproduction.log` |
| `npm test` | 177 tests réussis, 0 échec, 0 ignoré ; inclut les 13 nouvelles régressions | `artifacts/autonomy/pam08-npm-test.log` |
| `npm run test:confidence` | Needle réel : 32 cas + 4 contrôles de formulations réussis ; score 0,2346 → 0,7202 | `artifacts/autonomy/pam08-confidence.log` |
| `npm run test:integration` | Réussite : Needle, silence Whistle, confirmation, lancement d’un exécutable de test, 8 alias | `artifacts/autonomy/pam08-integration.log` |
| `npm run test:media:commands` | Needle réel : 65 contrôles réussis | `artifacts/autonomy/pam08-media-commands.log` |
| `npm run test:deezer:routing` | Needle réel : 48 contrôles réussis | `artifacts/autonomy/pam08-deezer-routing.log` |
| `git diff --check` | Réussite | Vérification Git avant commit |

Le sandbox Windows bloque la création des processus de `npm test` (`EPERM`).
La commande complète a ensuite été exécutée avec autorisation d’environnement
et a réussi. Les tests du budget conservent toutes leurs assertions d’effets,
d’interruption et de non-rejeu ; leurs textes génériques deviennent des
demandes explicitement répétées correspondant aux plans simulés.

Les nouveaux tests comptent les appels effectifs au lanceur simulé et les
résultats de l’assistant. Les suites natives exécutent les vrais moteurs avec
profils jetables ; l’intégration lance uniquement le Node de test qui écrit
un marqueur et termine. Aucun lecteur ou exécutable personnel n’est commandé.
Les profils et processus de test ont terminé. Aucune modification Rust/Vue ;
aucune validation WebView2 ou packaging requise par ce diff et aucune annoncée.
Les traces sous `artifacts/` sont locales et ignorées par Git ; les fixtures et
régressions versionnées ne dépendent pas de leur présence.

Fichiers livrés : `sidecar/assistant.cjs`, `sidecar/cardinality.test.cjs`,
`sidecar/budget.test.cjs`, `docs/tickets/PAM-08.md`.
