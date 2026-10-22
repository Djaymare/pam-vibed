# PAM-38 — préparation de la signature et de la validation Windows

- Fiche : https://app.notion.com/p/3f7b3e0422a4810b8fc2e8e7fd202eef
- Run : `c6124deb-00ca-405c-94f8-dd71183eebb3`.
- Worker : `01a16178-c8b7-72c3-882b-4c1d2df1062b`, génération 43.
- Branche : `codex/deezer-routing`.
- Base : `7cc9ca7e4d912f3f951ef3b11c2058822c7f1d9c`.
- Outcome : **blocked**. Préparation locale vérifiée ; aucun paquet PAM signé
  ni aucune installation sur VM propre validés. Le ticket doit rester ouvert.

## Contrat et autorisation

Lancement humain de la chaîne relu dans le chat d'origine
`01a1302e-073c-7c53-9a09-84a51b1ab6af`, message
`01a1302e-be0e-7f21-b801-56d9d7a578e7`. Activation humaine spécifique
« Lance PAM-38 » relue dans le chat prédécesseur, message
`01a16174-d489-7c33-91ff-f2b506f17205`. La relance de ce même chat après échec
initial de quota a été explicitement autorisée par le message
`01a1630c-ea43-7c70-b4c1-f268c16a6755`. Aucun deuxième worker créé.

Le relais `addf87de-a177-45bd-84d9-5a527689ac84` a été reçu nominativement en
génération 43 avant toute mutation. Branche, HEAD initial, index vide et checkout
propre vérifiés ; empreintes des fichiers de contrôle inchangées. PAM-11, PAM-29,
PAM-33 et PAM-35 ont été relus intégralement dans Notion : Terminé, relations
inchangées, preuves présentes et tous les commits des reçus ancêtres de HEAD.
Le contrat actuel correspond au snapshot transmis, hors passage contrôlé de
PAM-38 à En cours, confirmé par relecture. La demande active la préparation,
sans autoriser achat, publication, push ou changement de permissions.

## Préparation livrée

- `scripts/windows-signing.mjs` : génération explicite d'un fragment Tauri
  ignoré sous `artifacts/release/`, sélection du certificat par empreinte,
  SHA-256 et RFC 3161 HTTPS, sans copier de secret. Vérification native d'un
  fichier précis avec hash et éditeur attendus, arguments séparés sans shell.
- `scripts/verify-windows-signature.ps1` : hash avant/après, signature embarquée
  valide, éditeur épinglé, horodatage et SignTool `/pa /all /tw` avec code zéro.
  Tout refus reste un échec ; aucun changement de stratégie d'exécution.
- Tests suivis de configuration et de refus ; suite native dédiée avec une
  copie altérée d'une fixture signée approuvée, sans exécuter cette copie.
- `docs/windows-release.md` : canal de remise manuelle privée proposé,
  versions/commit/buildId, conditions CI/sécurité, signature, profil, conservation
  des données, upgrade/rollback et matrice portable/NSIS sur snapshots propres.
- Commandes npm explicites ; lien depuis `docs/portable.md`.

Le fragment ne s'intègre pas automatiquement au build existant. Les inventaires
actuels figent les hashes avant Tauri ; NSIS peut signer des ressources pendant
le bundling. Un staging séparé et des inventaires des octets signés restent à
implémenter/valider. La configuration n'est donc pas présentée comme un circuit
de build signé opérationnel. Les contrôles de fraîcheur/intégrité existants ne
sont ni réduits ni contournés. Aucun cache épinglé n'est signé ou modifié.

## Critères d'acceptation : état réel

| Critère | État et preuve disponible |
| --- | --- |
| Machine propre : installation et mise à jour identifiables sans perte de configuration ; portable et NSIS distingués | **Non satisfait** : matrice et prérequis distincts documentés, aucune VM propre disponible pour exécution. |
| Binaire/installeur identifiable, vérifiable et lié au commit validé | **Non satisfait** : vérificateur natif éprouvé sur un outil Microsoft, configuration Tauri préparée ; aucun PAM/setup signé ni contenu NSIS installé vérifié sur ce commit. |
| Upgrade/rollback conservent ou restaurent applications et formulations | **Non satisfait** : procédure de sauvegarde/restauration et comparaison documentée ; aucun cycle N → N+1 → N exécuté sur VM. |
| Installation/désinstallation sans auxiliaire actif ni perte silencieuse de données | **Non satisfait** : protocole avec sentinelle et inventaire des processus défini ; aucune désinstallation réelle sur VM. |

Aucune case Notion d'acceptation ne doit être cochée pour cette préparation.

## Contrôles exécutés

Windows x64, Node `24.21.0`, npm `11.19.0`, PowerShell 7 du runtime local déjà
configuré `RemoteSigned`, SDK Windows `10.0.26100.0` x64. Journaux locaux ignorés
sous `artifacts/autonomy/` ; les suites ne dépendent pas de ces journaux.

| Contrôle | Résultat réel | Journal/preuve locale |
| --- | --- | --- |
| `npm test`, avec `PAM_POWERSHELL_PATH` pointant l'hôte PowerShell 7 existant | Code 0 ; 468 tests réussis, 0 échec, 0 ignoré | `pam38-npm-test.log` |
| `node --test tests/windows-signing.test.mjs` | Code 0 ; 4 réussis, configuration/refus, hash faux et fichier non signé Windows réel | Sorties du chat ; inclus dans la suite complète |
| `npm run test:signing:native`, SDK et empreintes de fixture explicites | Code 0 ; 1 test réussi, aucun ignoré : confiance réelle, autre éditeur et altération refusés | `pam38-native-regressions.log` |
| Vérification native distincte du SignTool Microsoft signé et horodaté | Code 0 ; chaîne de confiance et hash corrects, faux hash/faux éditeur/copie altérée rejetés, copie supprimée | `pam38-native-verification.json`, `.log` |
| `npm run signing:config` avec empreinte synthétique et domaine `.invalid` | Code 0 ; fragment conforme aux propriétés du schéma Tauri installé ; sortie factice déplacée hors chemin de configuration actif | `pam38-config-fixture.log`, `pam38-signing-config-fixture.json` |
| Prettier sur les 3 sources JS/CJS nouvelles ; `node --check` ; `git diff --check` | Réussis | Sorties du chat |
| Certificats CodeSigning CurrentUser/My et LocalMachine/My | 0 certificat trouvé ; aucune clé de signature approuvée disponible | Contrôle natif du chat |
| Découverte des moyens VM | Namespace Hyper-V `root/virtualization/v2` absent ; Get-VM, VBoxManage, vmrun et WindowsSandbox non disponibles | Contrôle natif du chat |
| Signature PAM, build signé et matrice VM Windows portable/NSIS | **Non exécutés** | Dépendances externes non disponibles |

La fixture positive est le SignTool SDK déjà installé, SHA-256
`e7b517a6a2828af2d1fba3da60ae1e322a95141bfae192622725329630caa2b3`, certificat
`6ACE61BAE3F09F4DD2697806D73E022CBFE70EB4`. Cela valide le vérificateur,
pas la signature du produit ni la possession de la clé de cet éditeur.

## Incidents et limites

Le premier test négatif n'exigeait qu'un rejet générique. Le renforcement du
test pour contrôler la cause exacte a révélé que Windows PowerShell bloquait
le script selon sa stratégie. Cette sortie initiale n'est pas comptée comme
preuve de refus d'un fichier non signé. L'hôte PowerShell 7 existant a été
sélectionné explicitement, sa stratégie `RemoteSigned` relue, sans changement
de politique ni option Bypass ; les refus exacts et le cas positif ont alors
réellement été exécutés. La même sélection est requise pour npm test sur ce
poste ; le vérificateur conserve l'échec si l'hôte choisi interdit le script.

La suite native SDK est dédiée : elle exige ses entrées et ne s'insère pas
dans les intégrations moteur existantes. Aucun test applicatif n'est neutralisé.
Pas de modification Vue/Rust/routage : leurs builds et tests natifs ne sont pas
revendiqués dans cette préparation. Aucun succès VM/installation déduit des
468 tests ou du contrôle SignTool. Les copies de test sont supprimées ; aucun
processus PAM, moteur ou application personnelle n'a été lancé pour ces essais.

## Blocage et reprise

Pour terminer PAM-38, il faut un certificat/une clé et un poste de signature
approuvés, un environnement Windows propre pilotable avec deux versions de test,
la revue sécurité encore requise avant signature/diffusion, puis l'intégration
du staging signé et la matrice complète avec preuves. Aucun achat ou ajout de
confiance n'est effectué. La remise à des tiers exige son accord distinct.

Le checkout de préparation peut rester intégré et propre avec outcome blocked.
Le reçu local conserve les SHA complets et les contrôles. La fiche doit rester
En pause avec cette cause. La sélection finale doit relire les 40 pages et
ne créer un successeur que si un autre ticket est réellement éligible.

Fichiers : `package.json`, `scripts/windows-signing.mjs`,
`scripts/verify-windows-signature.ps1`, `tests/windows-signing.test.mjs`,
`tests/integration/windows-signing-native.cjs`, `docs/windows-release.md`,
`docs/portable.md` et cette preuve. Aucun fichier du dispositif d'autonomie,
certificat, profil, exécutable ou cache n'est inclus.
