# PAM-11 — Sauvegarde, migrations et transfert du profil

Ticket : https://app.notion.com/p/3f7b3e0422a4818b8659c04db96dceba

Run `c6124deb-00ca-405c-94f8-dd71183eebb3`, worker
`01a13d6c-66ca-79d3-b390-1adb2679ef92`, génération 12.
Base : `a849ee654a9590c40f7ba149e3828fa1eaaf6b20`, branche
`codex/deezer-routing`. Autorisation de lancement vérifiée dans le message humain
`01a1302e-be0e-7f21-b801-56d9d7a578e7` du chat de lancement.
Relais nominatif `b72f24b8-eaf7-4191-bf57-1234a73dfc7b` acquis avant écriture.
Contrat courant relu, conforme au snapshot ; PAM-05 relu intégralement dans
Notion, Terminé, preuve et commit `1210cf04b0bdb89391a7082c3cd14c2e722d400b`
présents dans l’intégration. Vérification effectuée par le worker implémenteur.

## Livraison

Toutes les écritures du profil utilisent `createConfigStore`. La source est
lue et validée avant remplacement. Sa dernière version valide est conservée
exactement dans `applications.backup.json`, par temporaire exclusif synchronisé
sur disque puis renommé. Le nouveau profil est ensuite écrit et synchronisé
dans un autre temporaire, renommé et relu. Aucun unlink de destination pour
contourner un refus Windows. Un refus d’ouverture, écriture partielle, disque
plein simulé, échec de sync ou renommage conserve le courant et/ou sa sauvegarde.
La première création sécurise aussi une copie avant de publier le courant.
Les empreintes contrôlent les changements depuis la lecture et avant remplacement.

La lecture d’un profil corrompu, d’une version future ou d’un courant absent
avec une sauvegarde existante ne bascule pas silencieusement sur un profil vide.
L’interface présente une récupération explicite, avec aperçu des applications,
formulations et préférences de la dernière copie valide. La confirmation est
liée aux empreintes du courant et de la sauvegarde. La copie exacte du courant
est conservée exclusivement sous `applications.invalid.<date>.<uuid>.json` et
vérifiée avant restauration ; elle n’écrase ni la preuve de corruption ni la
dernière copie valide. La restauration volontaire d’un profil valide est aussi
disponible dans Préférences. Le profil vide demeure un choix explicite sur erreur.

Le registre de migrations déterministes transforme la v1 en v2, dont la liste
de formulations est explicite. Il valide l’entrée et chaque sortie, sans muter
l’entrée ni écrire pendant la lecture. Une première modification sauvegarde les
octets de la v1 avant persistance v2. Une erreur de migration préserve l’original,
refuse l’utilisation et indique de restaurer une sauvegarde ou d’utiliser une
version compatible. Les versions futures inconnues restent refusées.

Préférences offre un export JSON validé, local, à copier volontairement dans un
fichier ; l’interface ne prétend pas avoir enregistré un fichier à la place de
l’utilisateur. L’import accepte ce JSON collé ou un fichier UTF-8 (2 Mio maximum).
Il présente l’aperçu du remplacement complet, y compris l’exécution automatique
et le seuil, puis exige une confirmation liée au contenu et au profil courant.
Les identifiants sont conservés ; aucun mélange ni remappage implicite. Le schéma
commun refuse doublons, alias orphelins, capacités incohérentes et données invalides.
Un import sur corruption sauvegarde le courant endommagé avant remplacement.

Import et restauration retirent les permissions des anciens plans avant le
remplacement. Si ce retrait échoue, aucun remplacement n’a lieu. Ces opérations
n’exécutent ni moteur ni application. La disponibilité des exécutables et le
contrôle natif Windows restent distincts de la validation structurelle. Le bridge
autorise les trois méthodes de transfert ; les contrôles de lancement sont conservés.

Les temporaires utilisent l’identité PID/session et les règles de collecte
existantes, étendues au seul nom `applications.backup.json`. Les copies de
corruption et les sauvegardes ne sont pas collectées comme des temporaires.

## Preuves des critères

| Critère | Preuves suivies |
| --- | --- |
| Une mise à jour, un disque plein ou une corruption ne perdent pas sans recours applications et formulations | `sidecar/config-persistence.test.cjs` : migration en mémoire, sauvegarde exacte v1, huit fautes E/S (dont ENOSPC après écriture partielle) sur courant/sauvegarde, récupération du profil riche après corruption, conservation des formulations et préférences. |
| Panne avant, pendant ou après écriture : au moins une copie valide récupérable | Cinq sous-processus réellement arrêtés à code 86 après sync du temporaire de sauvegarde, après son renommage, après sauvegarde, après sync du courant et après son renommage. Chaque cas valide les copies, collecte les temporaires après mort et restaure le profil attendu. Première écriture interrompue, conflit de source et journal refusé également couverts. Fixture suivie `sidecar/fixtures/profile-crash.cjs`. |
| Export puis import équivalent, sans alias orphelin ni doublon | Profil avec application, arguments, alias, capacité média, formulation et préférences : aller-retour complet, import répété sans duplication, UUID conservés. Doublons et références invalides refusés. Aperçu annulé, contenu modifié et source modifiée ne remplacent rien. Tests Vue du vrai App et de ProfileTransfer : export, aperçu, édition, annulation, confirmation et erreur. |
| Une migration échouée garde l’original restaurable et explique la récupération | Registre injecté en échec et sortie de migration invalide : original/sauvegarde intacts, erreur de profil avant utilisation et message de restauration/version compatible. Version 999 refusée sans réécriture. |

## Contrôles exécutés

Windows x64, Node 24.21.0 et npm 11.19.0. Profils jetables uniquement.

| Contrôle | Résultat | Trace locale sous `artifacts/autonomy/` |
| --- | --- | --- |
| `npm test` | 0 ; 221 réussis, aucun échec/ignoré | `pam11-test.log` |
| Tests ciblés de persistance, inclus dans npm test | 24 réussis, dont le smoke Windows natif | `sidecar/config-persistence.test.cjs`, sortie de `pam11-test.log` |
| Tests Vue, inclus dans npm test | 12 réussis | `tests/profile-recovery.test.mjs`, sortie de `pam11-test.log` |
| `npm run build` dans `artifacts/pam34/windows` | 0 ; vue-tsc et Vite réussis, 24 entrées identiques | `pam11-build-windows.log`, `pam11-build-inputs.json` |
| `npm run test:integration` | 0 ; Whistle/Needle réels et lancement d’un Node de test créant un marqueur | `pam11-integration.log` |
| `npm run test:deezer:routing` | 0 ; 48 contrôles, Needle réel, effets simulés | `pam11-deezer.log` |
| `npm run test:media:commands` | 0 ; 65 contrôles, Needle réel, sessions/effets simulés | `pam11-media.log` |
| `cargo test --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc` | 0 ; 16 réussis | `pam11-cargo-test.log` |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc --all-targets -- -D warnings` | 0 ; sans avertissement | `pam11-clippy.log` |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | 0 | `pam11-format.log` |
| `git diff --check` | 0 | Contrôle avant commit |

Le smoke Windows ouvre réellement le profil avec `FileShare.Read`, sans partage
de suppression, dans un PowerShell de test masqué. Le remplacement est refusé,
le profil et la sauvegarde restent valides. Après fermeture du handle, le test
réussit une modification puis une restauration après corruption, avec preuve
exacte de cette corruption. Aucun programme personnel ni lecteur n’est commandé.

Le build à la racine refuse le node_modules Linux préexistant (code 1,
`pam11-build-root.log`), préservé. Le build Windows isolé utilise toutes les sources
courantes, comparées après normalisation des fins de ligne. Les tests Vue montent
les composants réels avec le renderer en mémoire, les services natifs et les
minuteurs simulés. La compilation de test désactive uniquement la mise en commun
des nœuds HTML statiques, que ce renderer ne prend pas en charge. Aucun test
WebView2, paquet ou panne matérielle de disque/cache n’est revendiqué. Les fautes
ENOSPC/EIO sont injectées ; les arrêts de processus et le verrou Windows sont réels.

## Fichiers concernés

Ajouts : `sidecar/config-migrations.cjs`, `sidecar/config-persistence.test.cjs`,
`sidecar/fixtures/profile-crash.cjs`, `src/components/ProfileTransfer.vue`, cette preuve.
Modifications : `sidecar/config-store.cjs`, `sidecar/config-schema.cjs`,
`sidecar/assistant.cjs`, `sidecar/temporary-files.cjs`, `sidecar/config.test.cjs`,
`src/App.vue`, `src/types.ts`, `src/style.css`, `src-tauri/src/lib.rs`,
`tests/profile-recovery.test.mjs`, `README.md`.
Les assertions existantes sont conservées ; le test de version future vise
désormais v3 et la lecture v1 attend sa représentation migrée v2.
Aucun fichier de contrôle ou de protocole modifié.
