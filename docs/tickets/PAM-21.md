# PAM-21 — Disponibilité, étapes et annonces

Ticket : https://app.notion.com/p/3f7b3e0422a4816fbd9eef753055e4ec

Run `c6124deb-00ca-405c-94f8-dd71183eebb3`, worker
`01a14299-8514-7681-b854-9ab49823f381`, génération 22.
Base `b46d21d6274597eab443f0a1794ee9882621bdd1`, branche
`codex/deezer-routing`. Autorisation humaine d’origine, transmission nominative,
index/checkout propres et empreintes du dispositif vérifiés. PAM-15 et PAM-17
sont terminés dans Notion, avec leurs reçus, preuves et commits intégrés.
Vérification par le worker implémenteur.

## Comportement livré

Le front lit `supervisor_status`, directement dans Rust : cette lecture courte
ne rejoint pas la file d’inférence, ne démarre aucun processus et ne rejoue aucun
effet. Elle expose démarrage, prêt, reprise, arrêt demandé et arrêt, ainsi que
l’activité de transport. Une cible tuée ou déjà sortie n’est plus présentée prête,
même avant la prochaine sonde du superviseur. Les payloads/résultats sont validés
par le contrat partagé et les sorties générées.

La disponibilité exige une lecture de santé réussie, un runtime/profil valide,
un superviseur prêt, des applications actives et l’absence d’opération exclusive
ou de capture. Démarrer une autre mutation ne réhabilite pas une ancienne santé
en échec. Cette disponibilité contrôle microphone, envoi écrit, préparation média
et confirmation ; les handlers refusent aussi les soumissions directes pendant
une reprise. Les préférences et le bandeau utilisent le même état natif.

Les étapes affichées distinguent permission micro, capture, préparation audio,
transcription/préparation, émission native, confirmation, sauvegarde du profil et
échec récupérable. Transcription et préparation sont annoncées ensemble : le
protocole n’expose pas leur frontière exacte. Aucune progression fictive en
pourcentage n’est ajoutée.

L’annulation de permission/capture/préparation audio précède l’envoi et empêche
`process_audio`. Après l’envoi, aucun bouton ne promet d’annuler des effets déjà
possibles ; le message demande d’attendre le résultat et de vérifier les effets
incertains. Une annulation tardive ne masque plus un résultat déjà émis. Les
propositions gardent leur action Annuler avant confirmation native.

Trois régions persistantes annoncent étape, résultat et erreur. Les annonces de
résultat suivent les changements métier par identifiant, sans dépendre du temps,
du compte à rebours ou des objets recréés par le polling. Aucun focus n’est
demandé par ce mécanisme. Le champ écrit devient en lecture seule pendant la
demande et garde le focus, puis redevient éditable.

## Critères et preuves

| Critère | Preuve |
| --- | --- |
| Disponibilité cohérente avec les boutons, demande et résultat compréhensibles sans écran | Huit tests ciblés `tests/status.test.mjs`, vrais composables et région live ; parcours clavier WebView2, trace NVDA des étapes et résultats. |
| Runtime indisponible/en reprise jamais annoncé prêt | Matrice starting/recovering/stopping/stopped, santé échouée et profil invalide ; garde média/confirmation ; tests Rust du snapshot pendant démarrage bloqué, reprise et arrêt, et détection immédiate d’un processus retiré. |
| Sauvegarde de préférence distincte du vocal | Test d’état et sauvegarde différée dans la WebView2, message de mise à jour du profil ; aucune annonce de transcription. |
| Résultat et erreur annoncés une fois, sans déplacement intempestif de focus | Régions montées avant l’événement ; aucun changement de DOM du résultat pendant trois secondes de polling ; champ écrit toujours focalisé ; NVDA 2026.2 reçoit exactement une proposition, un résultat et une erreur. |

## Validations exécutées

Windows x64, Node 24.21.0, npm 11.19.0, Rust 1.99.0,
WebView2 Edge 155 et NVDA 2026.2 portable signé NV Access.
Journaux locaux sous `artifacts/autonomy/`.

| Commande/contrôle | Résultat |
| --- | --- |
| `npm test` | 296 tests réussis, aucun échec/ignoré ; `pam21-npm-test-final.log`. Huit nouveaux tests, assertions antérieures conservées. |
| `npm run build` | vue-tsc/Vite réussis dans la copie Windows, entrées identiques et même lockfile ; `pam21-build.log`, `pam21-build-inputs.json`. |
| `npm run lint` / `npm run format:check` | Réussis ; `pam21-lint.log`, `pam21-format.log`. |
| ESLint/Prettier du nouveau composant d’annonces | Réussis ; `pam21-components-lint.log`, `pam21-components-format.log`. |
| `cargo test --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc --features process-tests -- --test-threads=1` | 47 tests réussis, zéro échec/ignoré ; `pam21-cargo-final.log`. |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc --features process-tests --all-targets -- -D warnings` | Réussi ; `pam21-clippy-final.log`. |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | Réussi ; `pam21-fmt-check.log`. |
| `node scripts/test-modals.mjs` avec la trace NVDA | 91 contrôles réussis, dont les 77 antérieurs ; `pam21-modals-validated.log`. |
| `node scripts/test-modals.mjs --status-only` avec la trace NVDA | 14 contrôles rejoués sur le dernier changement de santé ; `pam21-status-webview-final.log`. |
| Contrats, diff, empreintes et intégration | Régénération vérifiée par npm test, fixtures valides/invalides communes Node/navigateur/Rust ; `git diff --check` et reçu local. |

Le build racine refuse le node_modules Linux préexistant, conservé
(`pam21-build-root.log`). La copie Windows réutilise ses dépendances isolées et
compare les octets de toutes les entrées du build. Les premiers contrôles ont
détecté un service simulé incomplet et un hôte WebView2 privé du manifeste
Common Controls par cargo test ; fixtures et reconstruction de l’hôte corrigées
avant les passages réussis.
Un essai NVDA sans premier plan a correctement échoué au comptage ; le scénario
isolé a été relancé avec focus vérifié avant ses annonces, puis a réussi.

## Reproduire le contrôle NVDA

Utiliser une copie portable et une configuration jetables, avec
`[development] enableScratchpadDir = True`. Copier
`tests/fixtures/nvda-status.py` dans `scratchpad/globalPlugins/` de cette
configuration. Définir `PAM_NVDA_SPEECH_LOG` vers une trace locale avant de lancer
NVDA avec `--minimal --config-path=...`, puis exécuter la suite WebView2 avec la
même variable. Le script compte les émissions reçues par NVDA depuis le début
du scénario d’états. La fenêtre de test doit être au premier plan.

Le plugin observe l’extension `pre_speech` de NVDA, en lecture, seulement quand
`modal-test-host` possède le premier plan. La validation utilise la trace textuelle
réelle de NVDA avec synthèse silencieuse ; elle ne revendique pas une écoute
humaine de l’audio. Aucun profil utilisateur ou programme personnel n’est testé.
Références : [messages d’état WCAG](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html),
[NVDA portable et options](https://api.nvaccess.org/documentation/userGuide.html).

## Fichiers et limites

App, vues Assistant/Préférences, composables de profil/requêtes/audio/propositions,
nouvelle projection d’état et composant d’annonces, styles ; bridge/hôte Rust,
contrats source et générés ; tests d’états, fixtures contrats et services,
chargeur de récupération, suite WebView2 et fixture NVDA ; documentation IPC.

La WebView2 exécute le vrai Vue avec services natifs simulés. Les transitions
réelles de supervision sont testées séparément dans Rust Windows avec processus
jetables ; aucun parcours vocal matériel, inférence réelle, lecteur personnel,
paquet portable/NSIS ou signature de PAM n’est revendiqué. Aucun protocole
d’annulation native après émission n’est inventé. Processus NVDA/WebView2 et
profils WebView2 arrêtés et nettoyés avant clôture. NVDA est arrêté ; le contrôle
automatique a refusé (`blocked by policy`) la suppression de la copie portable
et de sa configuration sous `%TEMP%/pam21-nvda`, ainsi que celle du journal local
de diagnostic `artifacts/autonomy/pam21-nvda.log`. Ces fichiers de test sont
conservés, hors Git ; aucun NVDA installé, profil personnel modifié ou processus
résiduel. Aucun changement de dépendance,
du dispositif autonome, push, publication ou déploiement.
