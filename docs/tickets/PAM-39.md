# PAM-39 — Optimiser les transferts audio et la découverte si les mesures le justifient

Ticket : https://app.notion.com/p/3f7b3e0422a4810f843bdc40fbda64b7

Run `c6124deb-00ca-405c-94f8-dd71183eebb3`, worker
`01a15c70-3155-7053-93e6-6b78d9a58304`, génération 38.
Branche `codex/deezer-routing`, base
`9044d466db205b52c1b4db2c2a850a832c19a147`.
Autorisation de lancement relue dans le message humain
`01a1302e-be0e-7f21-b801-56d9d7a578e7` du chat source ; choix humain
« Tant pis, passe à PAM-39 » relu dans
`01a15c63-2f93-75f3-b82b-25f4c150a930`. Relais nominatif
`f58efd82-45fb-40bd-910e-e6824ec55fa9`, branche, HEAD, index vide,
contrat et empreintes de contrôle vérifiés avant écriture.

PAM-30 relu intégralement à « Terminé » avec son commit
`09daa01a67cf7cb466166d4d3a315a103b839c29` présent dans la branche.
Ses dix découvertes natives p50/p95 de 2 942/3 056 ms constituent le coût
mesuré d’activation. Cette mesure comprend trois scans du helper, son
démarrage et la préparation du catalogue ; elle ne démontre pas un goulot
de transfert audio. La sélection a réconcilié l’ancien état qui avait laissé
PAM-39 conditionnellement inactif avec ces mesures et le choix humain.

## Changement et coût démontré

La lecture du statut récupérait les bitmaps de toutes les applications
Windows pour vérifier leurs identifiants et arguments. Les préparations
de cibles faisaient de même, même pour une cible absente. La découverte
dispose désormais de trois portées internes d’icônes : toutes pour le
sélecteur, aucune pour le statut, une seule cible exacte pour la préparation.
L’énumération Windows reste fraîche à chaque vérification ; aucun cache
d’autorité, TTL, stockage d’image ou changement de moteur n’est ajouté.

Les exclusions, raccourcis et arguments de lancement ne changent pas.
Les icônes demandées utilisent les mêmes API Windows, gardes STA/GDI,
bornes 64 × 64 et encodeur PNG. Une image fournie par la WebView ne devient
jamais une autorité ; les erreurs et suppressions ne réutilisent pas une
ancienne cible. Le transport audio, le filtrage Vue et le bundle ne sont
pas refactorisés sans mesure de leur coût.

## Mesures natives avant/après

Windows x64, Intel Core i7-14700KF, Node 24.21.0, Rust 1.99.0.
Le même helper est compilé dans deux fixtures isolées, depuis les sources
Git de la base et les sources courantes. Leurs dépendances verrouillées
sont identiques ; les empreintes de sources et lockfiles sont conservées
dans `docs/evaluation/discovery-provenance.json`.

Dix essais alternent l’ordre avant/après, soit 60 processus pour trois
opérations. Catalogue réel de 115 applications, 32 inscriptions de test,
aucun lancement. Les identifiants/noms/types/arguments sont comparés en
mémoire entre prélecture et opération mesurée ; seuls des compteurs et
mesures sont conservés. Données brutes et distributions :
`docs/evaluation/discovery-performance.json`.

| Opération               | p50 avant → après             | p95 avant → après  | Pic mémoire médian avant → après |
| ----------------------- | ----------------------------- | ------------------ | -------------------------------- |
| Statut, 32 inscriptions | 735,35 → 318,01 ms (−56,75 %) | 759,02 → 332,02 ms | 81,21 → 21,97 Mio (−72,94 %)     |
| Préparation d’une cible | 729,41 → 335,63 ms (−53,99 %) | 766,20 → 338,79 ms | 81,02 → 24,85 Mio (−69,33 %)     |

Le pic de working set est celui du processus entier, prélecture comprise,
fourni par Windows. Ce n’est pas la mémoire de PAM/WebView2 ni un pic
d’allocation par fonction. Les icônes présentes passent de 115 à zéro pour
le statut et de 115 à une pour la cible, sans changer les métadonnées.

Le statut initial de référence réchauffait aussi le cache d’icônes Windows.
Sans ce travail préalable, le scan complet suivant mesure 1 330 ms au p50
contre 730 ms avec la version de référence. Son temps total de processus,
prélecture comprise, est néanmoins de 1 742 contre 2 136 ms. Le code du
sélecteur conserve le scan complet ; aucun gain de latence isolée du
sélecteur n’est revendiqué. Aucun cache disque n’est vidé et aucune borne
universelle de temps ou de mémoire n’est promise.

## Critères et preuves

| Critère                                               | Preuve                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Amélioration chargée sans perte des protections       | Mesure réelle à 115 applications/32 inscriptions ci-dessus. Deux régressions Rust couvrent catalogue de 512 entrées, portées d’icônes, cible exacte, image forgée, cible invalide et absente. Tests natifs existants de pixels, ressources, cache périmé et indisponibilité conservés.    |
| Gain reproductible                                    | Deux compilations isolées, sources Git réelles avant changement, dix essais alternés, distributions et données brutes versionnées ; protocole `docs/discovery-performance.md`.                                                                                                            |
| Annulation, entrée invalide et plafond audio protégés | Les 435 tests Node incluent fermeture du sélecteur/réponse tardive, annulation pendant capture, contrats IPC partagés, WAV corrompu et plafond audio. Les 58 tests Rust incluent admission/contrats, cibles absentes et bitmaps bornés ; aucun chemin audio ou d’annulation n’est changé. |
| Différer sans goulot                                  | Branche conditionnelle non applicable : un coût réel des icônes est démontré et réduit. Aucune optimisation audio, streaming, virtualisation ou découpage du bundle n’est ajoutée.                                                                                                        |

## Validations

| Commande                                                                                                                                 | Résultat et journal local                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                                                                                                                               | 435/435, aucun échec/ignoré ; `artifacts/autonomy/pam39-npm-test.log`.                                                                             |
| `npm run build`                                                                                                                          | Réussi sur Windows dans le checkout courant ; `pam39-build.log`.                                                                                   |
| `npm run lint`                                                                                                                           | Réussi sans avertissement ; `pam39-lint-final.log`.                                                                                                |
| `cargo test --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc --all-features`                                | 58/58 tests de bibliothèque ; main/doc-tests sans cas ; `pam39-rust-test.log`.                                                                     |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc --all-targets --all-features -- -D warnings` | Réussi ; `pam39-clippy.log`.                                                                                                                       |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check`                                                                                 | Réussi ; `pam39-rustfmt.log`.                                                                                                                      |
| Fixtures Cargo natives, lockfiles générés puis builds `--locked --offline --target x86_64-pc-windows-msvc --bins`                        | Réussis dans deux répertoires target distincts ; `pam39-fixtures-build-isolated.log`.                                                              |
| `node scripts/benchmark-discovery.mjs AVANT.exe APRES.exe docs/evaluation/discovery-performance.json`                                    | 10/10 essais, 60 processus ; `pam39-discovery-benchmark.log`.                                                                                      |
| Benchmark PAM-30 avant/après                                                                                                             | Deux campagnes réussies, six profils et 18 générations chacune ; journaux `pam39-benchmark-before-final.log` et `pam39-benchmark-after-final.log`. |

## Rejeu complet PAM-30

Le même pilote corrigé a terminé les six profils 1/8/32 applications, simples
ou enrichis, trois générations et dix répétitions par génération avant et
après. Les deux rapports conservent 30 demandes par parcours chaud,
30 effets simulés par profil et dix découvertes natives. Les empreintes du
pilote, du sidecar et de l’audio synthétique sont identiques. Les sources
natives réellement compilées restent distinguées par la provenance des
fixtures et les empreintes des binaires.

Le scénario natif PAM-30 passe de 2935.86 / 2981.26 ms
au p50/p95 à 2028.54 / 2118.58 ms, soit
30.90 % de baisse du p50. Données brutes :
`docs/evaluation/performance-pam39-before.json` et
`docs/evaluation/performance-pam39-after.json`.

Les profils enrichis de 8 et 32 applications conservent chacun 30 refus
audio de capacité dans chaque campagne ; les quatre autres profils ont
30 propositions audio en attente. Les sondes de 56/224 outils sont refusées
avant initialisation ; la sonde ciblée à un outil et les effets simulés
restent exécutés. Aucune amélioration de la transcription ou du routage
Node n’est attribuée à cette optimisation native.

## Incidents et limites

Le contrôle des blobs indexés confirme les mêmes contenus que les fichiers
validés, avec la seule normalisation Git CRLF → LF de `src-tauri/Cargo.toml`.
Les empreintes brutes des entrées mesurées sont conservées ; les empreintes
des blobs Git et cette conversion sont consignées dans la vérification locale.

La première campagne PAM-30 a terminé trois profils puis s’est arrêtée
avec le code 70 pendant une sonde native de capacité sur le profil enrichi
de huit applications. Cette sonde contournait le plafond produit de 32
outils. Le pilote applique désormais le même refus de capacité que la
production avant initialisation ; les catalogues de 56/224 outils restent
explicitement refusés. Les scénarios de production conservent leurs profils,
leurs moteurs et leurs répétitions. La même correction du pilote s’applique
aux deux versions de la comparaison.

Le profil synthétique abandonné a été comparé exactement à la fixture
8/enrichi puis archivé sous `artifacts/autonomy/pam39-failed-benchmark-profile`
comme preuve, après la fin du processus. La suppression récursive initialement
envisagée a été refusée par le contrôle automatique ; l’archivage conserve les
données générées. Aucun profil personnel n’a été utilisé.

Un premier partage de répertoire target entre deux fixtures a produit deux
binaires identiques malgré des sources différentes. L’assertion sur le nombre
d’icônes a rejeté cette campagne dès le premier essai ; aucun résultat de cet
essai n’est utilisé. Les fixtures ont été recompilées dans des targets séparés,
leurs empreintes diffèrent et la campagne finale a réussi.

Les mesures de catalogue ne lancent aucune application. Les effets et sessions
du benchmark moteur sont simulés. Ni microphone réel, lecteur personnel,
WebView2, paquet, signature ou CI distante ne sont validés par ce ticket.
La nouvelle complexité de production est une portée d’icônes interne ; les
deux fonctionnalités Windows supplémentaires servent au compteur mémoire
du helper. Vérification réalisée par le worker implémenteur, sans sous-agent,
push, publication ou déploiement.

## Fichiers concernés

Catalogue Rust, module natif et tests ; options Windows de Cargo ; helper de
profilage, préparation des fixtures et pilote de comparaison ; admission de
la sonde de capacité PAM-30 ; protocole de performance, résultats bruts,
provenance et cette preuve.
