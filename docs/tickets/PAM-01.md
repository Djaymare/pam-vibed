# PAM-01 — applications utilisateur hors du Job Object

- Fiche : https://app.notion.com/p/3f7b3e0422a481378e14fc10dca04b80
- Run : `c6124deb-00ca-405c-94f8-dd71183eebb3`.
- Worker : `01a13051-d244-73c2-9f6f-a26a5dcc7ee4`, génération 2.
- Branche : `codex/deezer-routing`.
- Base : `6acefc795ee3185c62635b43f579ac65df1ac796`.
- Windows x64, Node 24.21.0 / npm 11.19.0, Rust 1.99.0.
- Aucun prérequis bloquant ; contrat et relations Notion relus sans divergence.

## Frontière et chemins de lancement

L’hôte Rust attribue seulement Node au Job Object. `KILL_ON_JOB_CLOSE` reste
actif, sans autorisation de breakaway. Node, son moteur Needle/Whistle chargé
dans un worker thread, et ses processus auxiliaires restent supervisés.

Dans PAM compilé, Rust définit `PAM_LAUNCH_HOST=1`. Les lancements utilisateur
remontent alors par le pipe privé sous forme de requêtes `host_request` avec
UUID ; la réponse `host_response` reprend le même identifiant. Le sidecar reçoit
ces réponses immédiatement, hors de sa file de demandes, pour éviter un deadlock.
Un timeout ou une interruption échoue sans rejouer le lancement. L’hôte refuse
les identifiants dupliqués et borne le nombre de lancements par demande.

| Chemin | Frontière finale |
| --- | --- |
| Exécutable manuel, test de brouillon, confirmation ou plan validé | `hostLauncher` → pipe → `launch.rs` → `Command::spawn` depuis Rust, hors du job Node |
| Catalogue desktop/Store, AppsFolder ou raccourci | Même frontière ; le catalogue natif partagé revalide l’exécutable Explorer et ses arguments exacts |
| Protocole Deezer | Pipe → hôte Rust → validation native des URI et Windows `Launcher`, ciblé sur la famille Deezer ; attente de 10 s puis annulation demandée, sans retry |
| GSMTC et autres auxiliaires internes | `nativeRequest` / `execFile` depuis Node ; ils restent dans le job |

Le sidecar conserve ses validations et confirmations. Rust vérifie en plus
le chemin absolu d’un fichier `.exe` existant et au plus 20 arguments de chaînes,
sans NUL, bornés à 8192 octets après substitution. Aucun interpréteur de commandes
n’est introduit. `host.cjs` est déclaré dans les ressources Tauri ; le portable
copie déjà tout le dossier sidecar.

Cette séparation utilise le parent réel des applications, sans considérer
`detached` comme une sortie de job. Microsoft documente l’héritage des jobs
par les enfants et la fermeture avec `KILL_ON_JOB_CLOSE` :
[Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects).

## Critères et preuves Windows

Le banc construit **l’exécutable Tauri PAM** avec la feature `process-tests`.
Son entrée de test utilise les véritables `AssistantBridge`, `Worker`,
`supervise`, catalogue COM et lanceur Rust, ainsi que le sidecar et le moteur
réels. Cette entrée est absente des compilations normales. Une fixture Rust
inoffensive écrit son PID et ses arguments puis attend. Le wrapper sidecar
crée une seconde instance comme auxiliaire interne après attribution au job.
Les raccourcis jetables sont créés via COM, sans shell.

| Scénario final | PID hôte | PID utilisateur | PID Node/moteur | PID auxiliaire | Résultat |
| --- | --- | --- | --- | --- | --- |
| Sortie normale, manuel | 32208 | 21212 | 29036 | 27852 | Utilisateur vivant ; internes arrêtés |
| Redémarrage sidecar, manuel | 9296 | 10080 | 25268 | 1340 | Utilisateur vivant ; anciens internes arrêtés ; nouveau moteur chargé |
| Arrêt brutal, manuel | 27736 | 28224 | 27672 | 32304 | Utilisateur vivant ; internes arrêtés |
| Sortie normale, catalogue | 5000 | 7332 | 28752 | 32176 | Utilisateur vivant ; internes arrêtés |
| Redémarrage sidecar, catalogue | 24756 | 27404 | 31064 | 31872 | Utilisateur vivant ; anciens internes arrêtés ; nouveau moteur chargé |
| Arrêt brutal, catalogue | 31468 | 27684 | 29116 | 2428 | Utilisateur vivant ; internes arrêtés |

Les deux premiers critères redondants du contrat sont satisfaits par ces six
scénarios. Le troisième est vérifié par les PID internes, le statut du moteur
réel chargé et l’arrêt du PID Node qui héberge ce moteur. Le quatrième est
vérifié à chaque scénario par un chemin absent et un `.exe` existant invalide :
erreurs Node puis Rust corrélées, sans lancement utilisateur. Les tests Rust
couvrent aussi les arguments NUL, non chaînes, trop nombreux ou trop longs.

Les scénarios manuels vérifient les guillemets, caractères de commandes,
antislash final et Unicode littéralement reçus par la fixture. Redémarrage et
arrêt brutal passent par enregistrement, proposition et confirmation ; une
seconde confirmation échoue. Le catalogue conserve l’argument du raccourci.
Chaque scénario nettoie et vérifie tous les PID de fixture, ses raccourcis et
son profil sous `.runtime-cache/process-*`.

## Commandes et résultats

Journaux et empreintes locaux ignorés : `artifacts/pam01/`. Le reçu du run
conserve les SHA complets de livraison séparément du présent document.

| Commande exécutée | Résultat | Journal |
| --- | --- | --- |
| `npm test` | 0 ; **133 réussis, 0 échec, 0 ignoré**, dont trois tests du pipe et du routage des protocoles | `npm-test.log` |
| `npm run test:integration` | 0 ; Needle/Whistle réels, confirmation et fixture de lancement, profil jetable | `integration.log` |
| `cargo test --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc` | 0 ; 2 tests Rust réussis, cible Windows native | `cargo-test.log` |
| `cargo build --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc --features process-tests` | 0 ; exécutable Tauri du banc | `cargo-build-process.log` |
| `rustc --edition 2021 tests/fixtures/process-fixture.rs -o artifacts/pam01/process-fixture.exe` | 0 ; fixture native compilée depuis la suite versionnée | sortie de compilation et fixture locale |
| `npm run test:processes -- artifacts/pam01/pam-process-test.exe artifacts/pam01/process-fixture.exe` | 0 ; six scénarios natifs, nettoyage vérifié | `process-isolation-stored-binary.log` |
| `cargo build --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc` | 0 ; compilation normale sans entrée de banc | `cargo-build-default.log` |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc --all-targets --features process-tests` | 0 ; deux avertissements préexistants dans le catalogue, également vus dans l’exemple discovery | `clippy.log` |
| `rustfmt --check --edition 2021 --config skip_children=true` sur les fichiers Rust touchés et la fixture | 0 | `format.log` |
| `git diff --check`, relecture du diff et vérification des fichiers de contrôle | 0 ; contrôles intacts, aucun test neutralisé | reçu et `validated-sources.json` |

Pour reproduire le banc sur un checkout Windows préparé, compiler PAM avec
la feature indiquée, copier `src-tauri/target/x86_64-pc-windows-msvc/debug/pam.exe`
vers `artifacts/pam01/pam-process-test.exe`, compiler la fixture, puis lancer
`npm run test:processes` avec ces deux chemins. Créer `artifacts/pam01` avant
compilation de la fixture. Le runtime embarqué doit être préparé selon la
procédure du dépôt. Cette exécution a réutilisé la toolchain et le cache Cargo
Windows établis par PAM-34, sans modifier les dépendances Linux préexistantes.

## Incidents résolus et limites

- Le premier banc terminait ses assertions mais attendait une seconde sortie
  d’un processus déjà tué. Nettoyage corrigé pour tenir compte de `signalCode`,
  fixture résiduelle nettoyée nominativement, suite finale entièrement réussie.
- Un nouveau scan du catalogue pouvait changer l’identité d’un raccourci frais.
  La sélection et le lancement utilisent maintenant le même catalogue natif.
- Une syntaxe de caractère nul incorrecte ajoutée au test Rust a été corrigée ;
  la compilation et les tests finaux réussissent.
- Le banc exécute les chemins natifs de PAM compilé ; il ne teste pas les clics
  ou le rendu WebView2. Aucune application personnelle n’a été commandée.
- Les six scénarios utilisent des exécutables manuels et des raccourcis desktop
  jetables. Le routage Deezer est testé avec des doubles ; la validation des URI
  est testée nativement. Aucun protocole Deezer personnel ni application Store
  personnelle n’a été activé. Les erreurs Windows restent remontées au caller.
- Aucun installeur NSIS, push, publication ou déploiement n’a été effectué.
- La reprise de quota est configurée dans ce chat ; l’outil n’a pas renvoyé de
  date effective de prochain déclenchement. Aucun reset n’a été consommé.

Fichiers : `package.json`, `sidecar/main.cjs`, `sidecar/host.cjs`,
`sidecar/host.test.cjs`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`,
`src-tauri/src/lib.rs`, `src-tauri/src/main.rs`, `src-tauri/src/launch.rs`,
`src-tauri/src/media.rs`, `scripts/smoke-process-isolation.mjs`, les deux
fixtures sous `tests/fixtures/` et ce document.
