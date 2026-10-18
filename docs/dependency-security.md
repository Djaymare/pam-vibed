# Inventaire et suivi des dépendances

Le lock npm racine ne décrit pas le runtime distribué entier. PAM conserve
trois sources : `package-lock.json`, `src-tauri/Cargo.lock` et
`security/runtime-components.json`. Le dernier catalogue est utilisé directement
par la préparation ; il fixe les archives Node, la CLI et la DLL Cactus,
Needle/Whistle, les deux paquets Koffi et les licences téléchargées. Aucun de
ces composants n'est mis à jour automatiquement.

## Commandes reproductibles

Avec les versions de `docs/development.md`, depuis la racine :

```sh
npm run prepare:runtime
npm run security:sbom
npm run security:audit
npm run security:gate
```

`security:sbom` appelle `cargo metadata --manifest-path src-tauri/Cargo.toml
--locked --format-version 1`, pour **toutes** les cibles du lock. Il requiert
Cargo et l'accès aux sources des crates. `PAM_CARGO_METADATA` peut désigner une
capture complète de cette commande dans le même checkout ; une crate absente
fait échouer la génération. Une capture d'un autre lock n'est pas acceptable.
`CARGO` permet d'indiquer le chemin du programme Cargo sans shell.

La sortie `artifacts/security/sbom.cdx.json` est un SBOM CycloneDX 1.6 JSON.
Elle contient les paquets npm racine, y compris développement et plateformes
optionnelles, toutes les crates verrouillées, le catalogue téléchargé, les
paquets de npm embarqué et chaque fichier runtime. Chaque composant téléchargé
porte version/révision, source, licence et SHA-256 ; chaque fichier a son hash.
Les archives npm sont téléchargées dans un cache séparé, contrôlées avec le SRI
du lock puis hachées en SHA-256. Cargo fournit ses checksums SHA-256 d'archives.
Les composants vendus dans Node portent l'empreinte de leur `package.json` et
une propriété explicite `pam:hash-kind` ; leurs autres fichiers ont chacun une
entrée de fichier. Une licence absente est déclarée NOASSERTION, jamais devinée.
Le champ licence de Node renvoie à ses notices tierces dans NODE-LICENSE.txt.

Le SBOM concerne les dépendances verrouillées et les ressources Windows x64,
pas un verdict de sécurité ou un inventaire exact des crates effectivement
liées dans un binaire. Les bibliothèques système, WebView2 et la toolchain sont
externes. Les transitives internes d'une bibliothèque native opaque restent
limitées aux notices et aux informations publiées par son fournisseur ; sans
SBOM amont, leur exhaustivité n'est pas établie. Ne pas leur attribuer des
versions ou vulnérabilités par supposition. Le paquet final et son exécutable
PAM ont leur propre validation de packaging.

## Audit, surveillance et interprétation

`security:audit` écrit `artifacts/security/audit.json`, daté et lié au SHA-256
du SBOM. Il exécute `npm audit --json --ignore-scripts` sur le lock racine et
refuse un SBOM dont les empreintes des deux lockfiles ou du catalogue ont changé.
Il interroge OSV pour chaque identité/version npm et crates.io du SBOM, y compris
Koffi et npm embarqué. [RustSec exporte ses avis dans OSV](https://rustsec.org/).
Le rapport garde identifiant, version, source et périmètre des correspondances.
Plusieurs identifiants peuvent être des alias du même avis : leur nombre n'est
pas le nombre de vulnérabilités distinctes. Un avis d'abandon de maintenance
n'est pas une vulnérabilité démontrée.

La surveillance compare la version Node épinglée à l'index officiel dans sa
branche majeure, relève les releases marquées security, compare les versions
Koffi au registre npm et les révisions Needle/Whistle aux dépôts Hugging Face.
Elle conserve les sources. Une nouvelle révision peut ne modifier qu'une carte
de modèle ; examiner le diff et les hashes avant de décider une mise à jour.
Le [blog de sécurité Node](https://nodejs.org/en/blog/vulnerability) donne les
avis à lire pour qualifier une release. Les avis Cactus/Koffi doivent aussi être
revus dans leurs sources amont ; aucune base complète d'avis natifs n'est garantie.

Le mode observation sort 0 lorsque les collectes ont toutes abouti, même avec
des signaux à traiter. Ce code signifie « rapport complet », pas « aucun risque ».
`complete`, `needsReview`, les erreurs et les données brutes restent visibles.
Une panne réseau, une sortie npm invalide ou une réponse OSV tronquée sort 1.
`security:gate` sort également 1 si un avis ou une modification amont reste à
examiner. Il ne contient ni liste d'exclusion ni acceptation implicite. Une
nouvelle version disponible n'est pas à elle seule une vulnérabilité.

Un npm audit sans avis ne prouve rien sur Cactus, les modèles, le Node natif,
ses bibliothèques internes, Windows ou WebView2. Un match OSV est une preuve
d'avis correspondant à une identité déclarée, pas de l'exploitabilité dans PAM.
Examiner les alias, retraits, plages affectées, cible Windows, usage et conditions
d'exploitation depuis la source de l'avis avant toute conclusion native.

## Cadence et traitement

`.github/workflows/security.yml` exécute génération et gate chaque lundi,
sur demande et lors des changements de dépendances/préparation. Les rapports
restent téléchargeables même si le gate bloque. Le workflow préparé n'est actif
sur GitHub qu'après intégration/push autorisé et selon la configuration du dépôt.
Le mainteneur PAM lit chaque rapport hebdomadaire et avant toute distribution.
Il accuse réception d'un signal critique/haut sous un jour ouvré, le qualifie
sous deux jours ; les autres sont triés dans la semaine. Ce sont des délais de
traitement internes, pas une déclaration de gravité pour les signaux observés.

Pour chaque signal, ouvrir un suivi avec composant/version, URL/ID d'avis,
alias éventuels, cible/périmètre, impact établi ou encore inconnu, propriétaire,
mesure temporaire et échéance. Une absence d'application doit être justifiée
par des preuves. Ne pas masquer l'avis pour obtenir un gate vert ; une évolution
de politique exige une décision explicite et traçable. Une distribution reste
bloquée par les signaux non qualifiés. Revoir les versions au moins chaque mois
et après une annonce de sécurité ; conserver les anciens pins pour reproduction.

| Composant modifié | Validations à rejouer |
| --- | --- |
| npm Vue/outillage, crates Rust | npm test, build Windows et Linux, lint/format, Cargo fmt/test/Clippy --locked sur Windows, parcours WebView2 et paquet selon le diff |
| Node, Koffi, DLL/CLI Cactus | Tests de cache, SBOM/audits, npm test, test:integration, test:confidence, test:execution, test:languages, bench:performance, bridge Rust engine-integration et verify:bundle sur paquet frais |
| Modèle Needle ou Whistle | Tests précédents d'inférence réelle, corpus indépendant et calibration distincts, langues, commandes ambiguës, audio synthétique borné, budgets mémoire/latence ; réévaluer toute politique d'exécution automatique |

## Intégrité et reprise du cache

`prepare:runtime` acquiert un verrou exclusif contenant son PID ; une deuxième
préparation échoue. Un verrou résiduel exige de vérifier que ce processus est
terminé avant de retirer le seul verrou concerné. Son âge ne suffit pas.
Chaque archive est recontrôlée par son SHA-256 épinglé. Les téléchargements
écrivent un `.partial`, vérifient le flux puis le renomment ; erreur ou coupure
ne fait jamais accepter un partiel. Le prochain essai supprime ce partiel précis.

Les entrées de ZIP/TAR vérifiés fournissent les empreintes attendues de tous
les fichiers, sans se fier à un manifeste recalculé depuis le cache existant.
Tout manque, ajout, lien ou altération (dont npm hors node.exe) invalide l'arbre.
La réparation prépare et vérifie un arbre voisin neuf, conserve l'ancien le
temps du remplacement, puis nettoie son propre staging. Une erreur de renommage
restaure l'ancien arbre. Après une coupure système entre ces opérations, les
dossiers voisins `.stage-*`/`.old-*` ne sont jamais pris comme cache valide ;
les inspecter après arrêt confirmé du préparateur. Aucune suppression globale.
Les archives refusent traversée de chemins, liens et entrées tronquées.

Le runtime généré inclut toutes les empreintes de fichiers dans manifest.json,
compatible avec verify:bundle. Un fichier inattendu hors des sous-arbres gérés
fait échouer la préparation ; l'examiner plutôt que l'intégrer au manifeste.
Les tests de corruption utilisent uniquement des dossiers temporaires et ne
modifient aucun modèle ni profil utilisateur.
