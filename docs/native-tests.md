# Tests Rust et adaptateurs Windows

Depuis la racine, sous Windows x64, utiliser Node 24.21.0 officiel x64,
Rust/MSVC 1.99.0 et les outils Visual Studio C++. Aucun modèle, npm install,
profil utilisateur ou application personnelle n’est nécessaire pour la suite
par défaut :

```powershell
node scripts/prepare-native-tests.mjs
cargo test --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc --all-targets -- -D warnings
```

La préparation vérifie version et SHA-256 de Node puis copie seulement cet
exécutable dans `src-tauri/binaries`. Elle crée le répertoire de ressources vide
requis par Tauri sans télécharger de modèles. Les fixtures IPC utilisent un
chemin de runtime inexistant. `bridge_tests` est compilé uniquement sous Windows.
Les tests de politiques, contrats et dispatch isolent processus et transport.

| Frontière | Tests/fixtures |
| --- | --- |
| Budget et transport | Horloge et fabrique injectées par `with_services`, vrais pipes Node ; stdin non lu, EOF, JSON invalide, réponse tronquée/surdimensionnée, enfant mort, file saturée, réponse tardive et arrêt pendant requête. Retrait du flux, PID morts, reprise explicite et absence de rejeu vérifiés. |
| Job et ressources | `job`, `supervision`, `windows_resources` et `applications/native` : erreurs anticipées, terminaison des descendants héritant des pipes, jointure bornée, COM/WinRT et bitmaps. |
| Permissions | Garde de fenêtre utilisée par la commande Tauri avant décodage ; labels non autorisés sans dispatch, capability limitée à `main`, aucune origine distante. Ce test ne lance pas une WebView2. |
| Catalogue | `applications/tests.rs` : source simulée, catalogue vide/refusé, noms identiques avec identifiants distincts, sélection exacte, entrée disparue après actualisation et ancien cache inutilisable pour autoriser un effet après échec du scan. |

PAM-40 ajoute le [banc d'autorisation WebView2](tauri-permissions.md) :
`npm run build`, `npm run test:permissions:build`, puis `npm run test:permissions`.
Il utilise le vrai handler/ACL Tauri et vérifie main locale, fenêtre non autorisée,
origine HTTP, navigation de main vers cette origine puis retour local. Les services
sont jetables et le backend volontairement indisponible ; la réception des
événements est réelle. Ce banc complète le test unitaire de garde de fenêtre.

Chaque profil est créé par le test, le bridge est arrêté et ses handles joints
avant suppression. Les commandes externes ne ciblent que les exécutables et PID
des fixtures. Les scans Shell lisent le catalogue sans lancer ses applications.
Une horloge simulée ne remplace pas l’ordonnanceur Windows : les délais des pipes
et de nettoyage sont aussi vérifiés en temps réel.

Les deux tests de délai d’écriture préparent d’abord leur fixture par un
échange `status` borné à cinq secondes. La fixture cesse de lire stdin avant
d’accuser réception ; son éventuel enfant hérite alors déjà des pipes.
Une fabrique retarde volontairement chaque lancement d’une seconde, au-delà
des budgets d’écriture de 600 et 800 ms. Après cet échange, l’horloge injectée
est figée pendant l’admission et la sérialisation de la trame synthétique de
4 Mo, puis reprend en temps réel lorsque l’acteur atteint `WRITING`.
L’attente de ce stade reste bornée à cinq secondes réelles. Le résultat doit
rester `bridge_write_timeout`, en moins de deux secondes réelles depuis la
reprise de l’horloge, avec nettoyage des PID et reprise sans rejeu. Les échanges
de préparation et de récupération ont leur propre borne de cinq secondes.
Le budget de bout en bout de production reste couvert séparément par les tests
d’admission, de file et de démarrage ; aucun délai de production n’est modifié.

## Contrôles historiques

Avec l’historique Git complet, après compilation de la suite ci-dessus :

```powershell
New-Item -ItemType Directory -Force .runtime-cache | Out-Null
rustc --edition 2021 --target x86_64-pc-windows-msvc tests/fixtures/process-fixture.rs -o .runtime-cache/native-fixture.exe
node scripts/test-native-history.mjs rustc .runtime-cache/native-fixture.exe
```

Le script lit les sources exactes du commit audité
`2aff3f94cf8c3cc0e6266f59f2739b0a977ae122` dans une copie jetable : aucune
modification des sources de production. Il compile l’ancien bridge avec les
dépendances du cache Cargo, puis exige un échec précis de chaque prédicat corrigé :
PAM-01 (fixture utilisateur survivant à la fermeture du job), PAM-03 (budget
commun limitant les émissions à deux sur huit), PAM-04 (pipe borné).
Un échec de compilation, un crash imprévu ou un défaut de préparation échoue
au contrôle ; ils ne valent pas reproduction du défaut. Le sidecar bloqué est
terminé par son PID connu pour libérer le test historique. Les processus et
répertoires jetables sont ensuite nettoyés. Le même scénario de budget est
exécuté sur l’assistant courant et doit réussir. Les prédicats Rust et Job
corrigés sont couverts par la suite et le smoke d’isolation ci-dessous.

## Intégrations avec moteurs réels

Ces commandes exigent les ressources préparées et restent distinctes de la
suite sans modèles :

```powershell
npm run prepare:runtime
cargo test --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc --features engine-integration
cargo build --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc --features process-tests --bins --examples
node scripts/smoke-process-isolation.mjs src-tauri/target/x86_64-pc-windows-msvc/debug/pam.exe .runtime-cache/native-fixture.exe
node scripts/smoke-application-availability.mjs src-tauri/target/x86_64-pc-windows-msvc/debug/pam.exe
```

Adapter les chemins du binaire si `CARGO_TARGET_DIR` est défini. La feature
`engine-integration` ajoute la récupération avec le vrai collecteur et le
warmup ; aucun test n’est marqué ignoré pour masquer l’absence des modèles.
Le banc d’isolation couvre quitter/restart/crash, manuel et catalogue COM,
moteur réel chargé, application jetable survivante, auxiliaires internes morts
et arguments préservés. Les raccourcis ajoutés ont un UUID et sont supprimés
par le banc. Le smoke de disponibilité vérifie suppression, désactivation,
réparation et réactivation des cibles avec conservation des données.

## Workflow et preuve CI

`.github/workflows/windows.yml` contient un job Windows `native-tests` sans
modèles avec formatage, Clippy, tests Rust et contrôles historiques. Le job
`build` exécute séparément les tests `engine-integration` après préparation.
Le checkout complet du premier job fournit le commit historique.

La barrière PAM-33 ajoute les parcours WebView2 au job sans modèles. Les trois
tests Node de DLL/sidecar/contexte natif sont dans `tests/integration/`, avec la commande
`npm run test:integration:node` obligatoire dans `ci:integration` ; `npm test`
reste sans modèles. Voir [ci-quality.md](ci-quality.md) pour les dépendances
avant packaging, les diagnostics et les checks à rendre requis côté dépôt.

L’ajout du workflow ne prouve pas son exécution hébergée. Conserver l’URL et
le SHA du run réussi sur le commit à livrer pour satisfaire ce critère de
PAM-31. Les commandes ci-dessus et la matrice des fixtures servent de base à
la barrière complète PAM-33 ; elles ne déclenchent ni push ni publication.
