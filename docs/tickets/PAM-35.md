# PAM-35 — Inventaire, audits et intégrité du runtime

Ticket : https://app.notion.com/p/3f7b3e0422a481fb805ae8d8ced86f54

Run `c6124deb-00ca-405c-94f8-dd71183eebb3`, worker
`01a14d53-9d56-79a1-bdb7-8e58cca4cd3d`, génération 35.
Base : `a25de03482ca0f3029440523e82bb0aba9a42928`, branche
`codex/deezer-routing`. Vérification effectuée par le worker implémenteur.

Autorisation humaine d'origine relue dans son chat ; identité réelle, run,
transmission nominative et génération vérifiés avant toute écriture. Index et
checkout initialement propres, empreintes du dispositif inchangées. La fiche
intégrale a été relue avant et après passage à En cours ; aucun prérequis.
Son contrat et ses relations sont inchangés lors de la vérification finale.

## Livraison et preuves des critères

| Critère | Preuve |
| --- | --- |
| Avis ou mise à jour d'un composant hors package-lock repérable, sans vulnérabilité native supposée | security-audit.mjs interroge OSV pour 798 identités npm/crates.io uniques incluant Koffi et npm embarqué ; il observe l'index Node officiel, le registre Koffi et les révisions HF Needle/Whistle. Test avec avis Koffi injecté explicitement fictif et changements Node/Cactus. Rapport réel : 27 correspondances d'avis, avec versions, IDs, URLs et périmètres ; leur nombre ne représente pas des vulnérabilités distinctes. |
| Composant embarqué hors lock traçable avec version, source, licence et empreinte | Catalogue suivi runtime-components.json utilisé par prepare-runtime, puis SBOM CycloneDX : 185 entrées npm racine, 475 crates, 7 composants téléchargés, 144 paquets npm embarqués, 2 025 fichiers runtime et l'exécutable Node. Total 2 837 entrées. Archives npm contrôlées par SRI puis SHA-256 ; checksums Cargo et pins des téléchargements ; licences des composants renseignées, notices tierces Node conservées. Schéma officiel CycloneDX 1.6 validé. |
| Altération d'un fichier autre que node.exe détectée | Les archives épinglées produisent les hashes attendus de tous les fichiers extraits. Régressions sur altération npm, manque, ajout, jonction, ZIP/TAR hostile et téléchargement interrompu. Copies jetables des vraies archives : npm-cli.js altéré avec node.exe inchangé, puis DLL Cactus et koffi.node altérés ; chaque contrôle rejette puis reconstruit/vérifie l'arbre entier. Copies supprimées. |
| Conclusions d'audit bornées à leur périmètre | Rapport avec complete/needsReview, sources, périmètres et limites explicites. npm racine : zéro avis ; OSV élargi : 27 correspondances. Aucune absence de risque natif annoncée. Panne d'avis simulée donne complete=false. Un SBOM périmé est refusé. Gate réel code 1 attendu, rapport complet avec signaux à examiner, vérifié par assertions distinctes. |

`docs/dependency-security.md` décrit sources, commandes, portée, cadence
hebdomadaire, revue mensuelle, délais de triage, preuves d'applicabilité et suites
à rejouer selon le composant. Le workflow dédié génère les rapports et utilise
le gate sur planning, demande ou changement pertinent. Il n'a pas été publié ni
exécuté à distance dans ce ticket.

La préparation recontrôle chaque archive, supprime le partiel précis d'un essai
interrompu, écrit les téléchargements avant renommage et répare un arbre via un
staging neuf vérifié avec sauvegarde/restauration au remplacement. Un verrou
exclusif évite deux préparateurs. Un cache déjà valide reste disponible, et les
copies de binaires identiques ne sont pas réécrites. Le manifeste contient
désormais les 2 025 hashes, au lieu de quelques seuls binaires/modèles.
Un fichier runtime inattendu hors sous-arbres gérés fait échouer la préparation.

## Validations exécutées

Windows x64, Node 24.21.0 et npm 11.19.0. Métadonnées Cargo produites par
Cargo 1.99.0 avec manifeste explicite et --locked, sans filtre de cible.
Les dépendances Linux préexistantes sont préservées. Le build utilise la copie
Windows existante du run avec les mêmes 78 entrées de build, comparées par hash.

| Commande / contrôle | Résultat | Trace locale sous artifacts/autonomy |
| --- | --- | --- |
| npm run prepare:runtime | Réussi ; 2 025 fichiers vérifiés | pam35-prepare-delivery.log |
| npm run security:sbom | Réussi ; 2 837 entrées | pam35-sbom-final.log ; sortie artifacts/security/sbom.cdx.json |
| Schéma JSON CycloneDX 1.6 officiel (avec SPDX/JSF) | Valide ; AJV 6.15, formats IRI/email fournis ; deux avertissements sur des frères de $ref dans le schéma officiel | pam35-schema-delivery.log |
| npm run security:audit | Code 0, collectes complètes ; npm 0 avis, OSV 27 correspondances, 798 identités interrogées | pam35-audit-final.log ; artifacts/security/audit.json |
| npm run security:gate et vérification du rejet attendu | Gate code 1, complete=true, needsReview=true ; wrapper code 0 après assertions | pam35-gate.log, pam35-gate-expected.json |
| node --test tests/runtime-security.test.mjs | 7 tests réussis, zéro ignoré | pam35-targeted-final.log |
| Copies des vraies archives corrompues puis réparées | Node/npm, wheel Cactus et Koffi : réussis ; nettoyage confirmé | pam35-real-cache.log |
| npm test | 403 réussis, zéro échec/ignoré | pam35-test-delivery.log |
| npm run build avec dépendances Windows | TypeScript et Vite réussis ; 78 entrées identiques | pam35-build.log, pam35-build-inputs.json |
| npm run test:integration | npm embarqué, Needle, Whistle/silence, confirmations et exécutable marqueur réels : réussis | pam35-integration.log |
| Format des nouveaux scripts/tests/JSON/YAML et git diff --check | Réussis | pam35-format-new.log, chat et reçu |

Le gate refuse les signaux actuels : Node v24.22.0 disponible (aucune nouvelle
release marquée security dans l'index de cette branche après le pin), Koffi
3.3.3 et révisions HF différentes. Ces changements restent à examiner, sans
mise à jour automatique. Les 27 correspondances OSV incluent des avis sur des
crates d'autres plateformes et npm embarqué ; alias, avis d'abandon, plages et
usage Windows doivent être qualifiés avant de parler de vulnérabilité native.
Le périmètre de PAM-35 est le suivi vérifiable, pas une mise à jour massive ou
une attestation de distribution sûre. Aucun gate rouge n'a été enregistré vert.

Un premier npm test lancé en même temps que la préparation a échoué sur un
budget temporel existant ; la préparation a également rencontré une DLL en
cours d'utilisation. Ces commandes ont été séparées, les copies identiques de
binaires évitées, puis les validations finales ont réussi. Le premier SBOM a
refusé les métadonnées Cargo filtrées Windows ; les métadonnées complètes ont
résolu cet échec sans changer le lock. Une parenthèse de la nouvelle fixture a
été corrigée avant les tests finaux.

## Fichiers et limites

package.json ; scripts/prepare-runtime.mjs, runtime-integrity.mjs,
security-sbom.mjs et security-audit.mjs ; security/runtime-components.json ;
tests/runtime-security.test.mjs ; .github/workflows/security.yml ; les deux
documents de cette livraison.

Aucune version embarquée, dépendance ou lockfile modifié. Les suites d'inférence
complètes sur versions nouvelles ne sont donc pas requises ; l'intégration
réelle existante a néanmoins été rejouée. Pas de modification Rust ou Vue.
La CI distante, Linux et le paquet installé ne sont pas revendiqués : le daemon
Docker local était indisponible lors de sa consultation, sans rapport avec les
contrôles Windows réalisés. Le workflow reste à activer par une intégration
autorisée. Les sources transitives d'un binaire natif opaque ne sont pas
inventées ; leurs limites restent indiquées dans le SBOM et la politique.
La reprise de quota a été armée dans ce chat, sans consommation de reset.
Aucun fichier du dispositif autonome modifié, aucun push/publication, aucune
application personnelle commandée. Profils et processus de test terminés.
