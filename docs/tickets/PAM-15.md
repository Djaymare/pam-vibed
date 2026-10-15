# PAM-15 — Cycle de vie du superviseur

Ticket : https://app.notion.com/p/3f7b3e0422a4817c9f32cade622bbfcf

Run `c6124deb-00ca-405c-94f8-dd71183eebb3`, worker
`01a13e9c-9806-75c3-9da8-0d2c8e0f2749`, génération 16.
Base `b4e80034ed743f0d31e586fdd2f62e3e5d017120`, branche
`codex/deezer-routing`. Autorisation humaine d’origine, relais nominatif,
contrat intégral, empreintes du dispositif et prérequis PAM-01, PAM-02,
PAM-04, PAM-12 vérifiés. Leurs commits sont intégrés et leurs fiches sont
terminées. Validation du 15 octobre 2026 sous Windows x64, Rust/MSVC 1.99.0,
Node 24.21.0 et npm 11.19.0. Vérification effectuée par le worker implémenteur.

## Changement et limites de fonctionnement

Le bridge possède maintenant les deux handles de son acteur et de son
contrôleur de délais. Le thread détaché du desktop a été retiré. L’acteur
possède le flux et sérialise demandes et sondes. Le contrôleur de délais
ne fait que l’annulation/terminaison du job par le contrôle indépendant
du pipe ; il ne démarre aucun processus. Il couvre également les sondes
sans appelant, qui ne disposaient sinon d’aucun moyen de débloquer un pipe.

Les états sont démarrage, prêt (transport IPC), reprise, arrêt demandé et
arrêté. Les erreurs de démarrage, transport ou modèle entraînent des délais
de 1, 2, 4, 8, 16, 32 puis 60 secondes, avec plafond. Une réponse réussie
isolée ne réinitialise pas les échecs : 60 secondes de fonctionnement réussi
du même processus sont nécessaires. Les demandes pendant ce délai échouent
avec l’enveloppe structurée `transport_busy`. Elles ne restent pas en file.
Une sortie inattendue est aussi comptée ; un redémarrage explicite ne permet
pas de contourner le délai. Les sondes normales attendent 15 secondes
d’inactivité ; après panne, la reprise attend l’échéance croissante.

La seule opération automatiquement réessayée est `status`, qui effectue le
warmup et le nettoyage PAM-02. Aucune demande métier, inférence utilisateur,
confirmation ou action native émise n’est rejouée. Les résultats partiels
et états performed/unknown/not_started restent conservés par PAM-04/PAM-09.
Les transitions et erreurs utilisent le journal local filtré et borné PAM-12,
avec identifiant corrélé et sans contenu vocal ni chemin personnel.

L’arrêt ferme l’admission, marque l’état terminal et interrompt le job
sans attendre le pipe. Les appelants constatent l’arrêt par tranches de 50 ms.
La jointure de l’acteur et du contrôleur dispose d’un budget commun de deux
secondes ; `shutdown` indique si les deux handles ont été joints. Une création
native déjà engagée ou un effet natif déjà émis peut dépasser ce budget :
aucun nouveau travail n’est admis, l’appelant revient et le dépassement est
journalisé lorsque l’opération revient. Le destructeur ne répète pas ce budget
après un arrêt explicite. Le processus est possédé avant la configuration
faillible du job, puis tué/collecté avec une attente de sortie limitée à 500 ms.
Les lecteurs sont joints après fermeture du job et de leurs canaux.

Ces budgets sont des échéances logicielles sur Windows, pas une garantie
d’ordonnancement temps réel ni une interruption forcée d’un appel système
synchrone. Les tests warmup/inférence utilisent des processus simulés ; ils
ne prétendent pas suspendre une DLL Needle réelle. Le banc d’isolation charge
en revanche le vrai moteur et vérifie les PID avec des exécutables jetables.

## Critères et preuves

| Critère du ticket | Preuves exécutées |
| --- | --- |
| Démarrages toujours défaillants sans boucle coûteuse ; quitter rapide pendant une demande ; aucun effet externe rejoué | Fabrique refusant neuf démarrages avec horloge contrôlée : huit délais croissants, demandes répétées refusées sans nouveau spawn, aucune exécution métier ; arrêt des deux threads sous 300 ms, avance de dix minutes et restart après arrêt sans nouvelle tentative. Régressions de résultats partiels et de réponses tardives conservées. |
| Démarrages toujours défaillants sans boucle rapide ni orphelins | Quatre crashes Node natifs successifs avec un enfant interne chacun ; reprises déclenchées par horloge contrôlée, contrôle Windows de mort de tous les PID après chaque faute et fermeture. Job Object KILL_ON_JOB_CLOSE conservé. |
| Quitter borné pendant warmup, inférence, attente et écriture bloquée | Warmup/status silencieux, demande audio silencieuse, pipe non lu avec enfant héritier et demande en file : arrêt sous deux secondes, handles joints, PID morts, appels en attente terminés et aucun redémarrage possible. Arrêt inactif sous 300 ms. Fabrique native suspendue : retour dans le budget de deux secondes (tolérance de test 500 ms), résultat de jointure false, libération contrôlée puis jointure et état terminal confirmés. Sonde automatique silencieuse sans appelant : son délai termine réellement le processus, puis programme le délai de reprise de deux secondes. |
| Reprise nettoyant les temporaires abandonnés sans effet métier rejoué | Un vrai enfant Node crée WAV/keywords avec le propriétaire PAM-02 et émet un effet fichier simulé, puis exit(70). Les fichiers sont constatés présents avant reprise. La sonde automatique lance le vrai main/assistant/collecteur Node ; les fichiers disparaissent, applications.json reste identique et le compteur d’effet reste exactement à une émission. |

La politique pure vérifie aussi le plafond de 60 secondes, l’absence de remise
à zéro après 59 secondes, la remise à zéro après 60 secondes et l’irréversibilité
des états d’arrêt, y compris après succès/échec tardif ou second shutdown.

## Contrôles réellement exécutés

Les journaux sont locaux, non versionnés, sous `artifacts/autonomy/`.
Les tests et fixtures nécessaires sont suivis dans le dépôt.

| Commande | Résultat | Journal |
| --- | --- | --- |
| `cargo test --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc --all-features` | 41 réussis, zéro échec/ignoré | `pam15-cargo-final.log` |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc --all-targets --all-features -- -D warnings` | Réussi sans avertissement | `pam15-clippy-final.log` |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | Réussi | `pam15-format-check.log` |
| `npm test` | 235 réussis, zéro échec/ignoré ; collecte PAM-02 incluse | `pam15-npm-test.log` |
| `npm run test:integration` | Whistle/Needle réels, confirmation et effet jetable réussis | `pam15-integration.log` |
| `cargo build --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc --features process-tests --bins --examples` | Réussi | `pam15-native-build.log` |
| `rustc tests/fixtures/process-fixture.rs --edition 2021 --target x86_64-pc-windows-msvc -o .runtime-cache/pam15-process-fixture.exe` | Réussi | `pam15-fixture-build.log` |
| `node scripts/smoke-process-isolation.mjs <hôte compilé> <fixture compilée>` | Six scénarios Windows : quit/restart/kill, chemins manuel et catalogue ; vrais moteurs chargés, internes arrêtés, application jetable survivante et paramètres conservés | `pam15-process-isolation.log` |
| `git diff --check`, revue du diff, empreintes des sources validées et contrôle de nettoyage | Réussis | `pam15-final-verification.log`, `pam15-validated-sources.json` |

Les premiers essais ont découvert une sonde dont l’identifiant dépassait les
entiers exacts de JavaScript ; corrigé et régression de sonde sans appelant
ajoutée. Son watchdog couvre maintenant toutes les demandes actives. Un test
lisait le marqueur de démarrage avant l’exécution Node : il attend désormais
la réception effective. Un second arrêt réécrivait Stopped en Stopping : la
transition est maintenant idempotente et testée. Le premier appel Clippy avait
perdu le séparateur d’arguments dans le wrapper PowerShell ; l’appel final
transmet explicitement le tableau complet. Tous les contrôles finaux portent
sur les sources livrées ; aucun contrôle non exécuté n’est compté réussi.

## Fichiers et périmètre

`src-tauri/src/bridge.rs`, `bridge_tests.rs`, `supervision.rs`, `desktop.rs`,
`diagnostics.rs`, `tests/fixtures/bridge-sidecar.cjs`, `docs/rust-boundaries.md`
et cette preuve. Les empreintes et le reçu local conservent les SHA complets
après commit. Aucun changement du contrat autonome, de branche, de profil
personnel, de permissions ou de dépendances. Aucun push, paquet, installateur,
publication ou parcours visuel WebView2 revendiqué. Les contrôles natifs et
les tests n’ont laissé ni processus, ni raccourci, ni profil de test.
