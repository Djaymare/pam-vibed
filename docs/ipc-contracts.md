# Contrat IPC local — version 1

`sidecar/contracts.json` est la source commune. `scripts/generate-contracts.mjs`
produit les types et unions discriminées TypeScript, les modèles/enums Rust,
les appels Rust discriminés par méthode et leurs résultats. Le validateur
JavaScript du navigateur est généré depuis celui de Node. Rust valide le même
descripteur puis désérialise les modèles générés. Aucune dépendance npm ajoutée.

Après un changement :

```text
node scripts/generate-contracts.mjs
node scripts/generate-contracts.mjs --check
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --locked
```

`--check`, exécuté par les tests, refuse une sortie absente ou divergente.
Les fixtures communes valides/invalides sont suivies dans
`tests/fixtures/contracts.json` et utilisées par Node, le navigateur et Rust.
Le test de dérive altère une copie jetable du schéma. Les tests TypeScript
vérifient aussi les refus de méthode, payload, action et type de réponse.

## Enveloppes et frontières

Les payloads `delete_application` et `delete_command_alias` acceptent
`expectedFingerprint` (optionnel pour les clients version 1 existants).
L’interface le transmet systématiquement après une confirmation explicite.
Il lie la confirmation à la fiche complète et aux formulations associées
(ou à la seule formulation choisie avec sa fiche). Les clés des objets sont
triées avant SHA-256 pour traverser Rust sans dépendre de leur ordre JSON.
Toute divergence refuse l’écriture et exige une nouvelle confirmation.
Les écritures gardent également le contrôle de concurrence du magasin de profil.

Toutes les commandes de l’interface passent par `src/ipc.ts`, vers l’unique
commande Tauri `assistant_request` :

```json
{"version":1,"id":7,"requestId":"11111111-1111-4111-8111-111111111111","method":"confirm","payload":{"id":"22222222-2222-4222-8222-222222222222"}}
```

La réponse reprend version, id, requestId et méthode ; `ok:true` porte `result`,
`ok:false` porte l’enveloppe `PamError` de PAM-12. Rust conserve requestId sur
le transport Node ; son id numérique interne est distinct, croissant et lié à
la tentative. Les appels inverses `host_request`/`host_response` portent la même
version/requestId et un UUID propre à l’effet. Progression et diagnostic portent
la version, requestId et l’id de la tentative.

Une version incompatible ou un schéma invalide est refusé avant dispatch.
Le navigateur valide la réponse avant de la rendre à Vue. Rust ignore une
réponse à un autre id/requestId et conserve l’échéance initiale. Un navigateur
recevant une réponse périmée la rejette sans fournir son contenu au composant.
Aucun de ces refus ne rejoue une demande. Une réponse mal formée du sidecar
retire le worker ; les résultats partiels connus restent conservés.

Les objets du descripteur sont fermés, avec `?` pour un champ facultatif,
`nullable` pour null, `array`/`max`, `record`, `enum` et `literal`. Les objets de
métadonnées natifs et le manifeste autorisent explicitement des champs
supplémentaires. Les schémas contrôlent la forme ; les validations métier déjà
présentes contrôlent ensuite références, empreintes, capacités, URI, chemin
natif et confirmations avant effet. Elles restent nécessaires.

## Inventaire des méthodes Vue → Rust

| Méthodes | Payload | Résultat |
| --- | --- | --- |
| `status` | vide | RuntimeStatus, configuration et propositions |
| `export_diagnostics` | vide | export filtré PAM-12 |
| `diagnostic_event` | code microphone autorisé | PamError |
| `export_config` | vide | chaîne JSON du profil |
| `preview_import` | contenu du profil | empreintes et résumé |
| `import_config` | contenu, empreintes, confirmation | configuration et sauvegarde |
| `recover_config` | empreinte, confirmation, choix de sauvegarde | configuration et sauvegarde |
| `save_application`, `test_application` | application, id facultatif ; input facultatif pour test | Config / ActionResult |
| `set_application_enabled` | id et booléen | Config |
| `delete_application` | id | Config |
| `settings` | langue, exécution automatique, seuil | Config |
| `save_command_alias` | formulation et action ; id facultatif | Config |
| `delete_command_alias` | id | Config |
| `process_text`, `process_audio` | texte / tableau d’octets WAV | Turn |
| `prepare_action` | application, action, arguments et libellé facultatifs | Turn pending |
| `correct_request` | id, texte et choix de correction | Turn |
| `confirm`, `discard` | id | Turn |
| `restart_engine` | vide | EngineStatus |
| `media_sessions` | vide | MediaSession[] |
| `desktop_action` | hide / quit / listening / idle | null |
| `discover_applications` | vide | InstalledApplication[] |

Diagnostic, export, découverte et action de fenêtre restent dans Rust. Les
autres méthodes traversent le bridge sérialisé vers Node. Node refuse les
méthodes réservées à Rust. Le pipe inverse expose seulement
`launch_application` (exécutable et arguments contrôlés) et `deezer_open`
(URI contrôlé), avec validation de forme avant les contrôles natifs existants.
Les échanges internes avec les moteurs et auxiliaires restent leurs protocoles
privés existants ; ils ne constituent pas de nouvelles méthodes de l’interface.

`TurnStatus`, `ProposalState`, `CommandAction` et `ActionOutcome` viennent du
même schéma dans les trois couches. `partial`, les issues par action et
`expired`/`invalidated`/`consumed` gardent le sens établi par PAM-03 et PAM-10.
Un résultat inconnu ne donne jamais une permission de rejeu. Cette version est
un changement coordonné de l’application, sans négociation avec une ancienne
version du sidecar ; redémarrer l’application complète après mise à jour.
