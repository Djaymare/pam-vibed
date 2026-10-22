# Permissions Tauri de PAM

Périmètre du 22 octobre 2026 : consolidation préventive des usages existants,
avant de nouvelles fonctionnalités. Une seule fenêtre/webview de production,
`main`, charge les ressources locales. Aucune origine distante autorisée et
aucune nouvelle fenêtre, commande métier ou permission de plugin ajoutée.

## Accès par usage

| Usage du front | Permission de la webview locale `main` | Frontière supplémentaire |
| --- | --- | --- |
| Profil : status, export_config, preview_import, import_config, recover_config, settings | allow-assistant-request | Contrat versionné, validation du profil, empreintes et confirmations |
| Applications : discover_applications, save_application, set_application_enabled, delete_application, test_application | allow-assistant-request | Catalogue frais ou .exe manuel validé ; confirmation avant suppression |
| Formulations : save_command_alias, delete_command_alias | allow-assistant-request | Références et empreintes du profil |
| Assistant : process_text, process_audio, prepare_action, correct_request, confirm, discard | allow-assistant-request | Bornes WAV, propositions, confirmation, budget commun et non-rejeu |
| Moteur/média : supervisor_status, restart_engine, media_sessions | allow-assistant-request | Superviseur et adaptateurs natifs |
| Bureau : desktop_action, voice_shortcut | allow-assistant-request | Garde explicite main et choix de raccourcis prédéfinis |
| Diagnostics : export_diagnostics, diagnostic_event | allow-assistant-request | Catalogue d'erreurs et export filtré |
| Réception des événements vocaux de Rust | core:event:allow-listen, core:event:allow-unlisten | Aucune émission d'événement depuis JavaScript |
| Choix manuel d'un exécutable | dialog:allow-open | Le chemin choisi est validé à l'enregistrement et avant lancement |

Les 26 méthodes passent par l'unique commande Tauri `assistant_request`,
déclarée dans `build.rs` avec `AppManifest::commands`. Tauri génère sa permission
`allow-assistant-request` pendant le build. Ces méthodes ont aujourd'hui le même
périmètre de confiance ; le contrat de données ne remplace pas une autorisation.
Si une future vue a besoin d'un sous-ensemble, définir une commande/permission
dédiée au lieu de lui ouvrir tout le multiplexeur.

`tauri.conf.json` active explicitement la seule capability `default` : un fichier
ajouté au dossier ne devient donc pas actif automatiquement. La capability cible
`webviews: ["main"]`, `windows: []`, `local: true`, sans `remote`. Les listes
windows et webviews sont additionnées par Tauri : remettre windows: ["main"]
autoriserait aussi les autres webviews de cette fenêtre. La garde Rust vérifie
toujours la fenêtre main avant décodage/dispatch. La CSP de production et celle
de développement sont conservées ; le serveur Vite est l'origine locale en dev.

Les plugins dialog, global-shortcut et single-instance sont initialisés côté
Rust. Seul dialog.open est exposé au front. Les raccourcis sont enregistrés côté
Rust ; aucune permission JavaScript global-shortcut, shell, opener, filesystem,
création de fenêtre, ni accès distant n'est nécessaire. Les opérations Rust sur
la fenêtre, le tray et les menus n'exigent pas de permissions IPC core:default.

## Lancement et protocoles

Un exécutable manuel doit être un fichier .exe absolu existant ; les arguments
restent des chaînes passées directement à Command, sans shell. Le profil limite
à 20 arguments de 2 048 caractères ; la frontière native refuse aussi plus de
20 arguments, NUL et chaînes de plus de 8 192 octets. Une inscription du catalogue
est revalidée et ses arguments doivent correspondre à la cible Windows fraîche.
Ces contrôles ne constituent pas un bac à sable de l'exécutable choisi.

Le bridge inverse accepte seulement launch_application et deezer_open.
L'adaptateur média valide indépendamment les protocoles deezer:// et dzr://,
l'hôte www.deezer.com, les routes établies et leurs paramètres bornés avant COM
ou ouverture. Aucune permission de protocole WebView ou de plugin shell n'est
ajoutée. Les tests de launch.rs et media.rs conservent les refus avant effet.

## Déclarer une évolution

1. Définir l'usage, la fenêtre/webview et les origines exactes ; conserver le refus
   des autres contextes. Une vue distante n'hérite jamais des accès de main.
2. Ajouter la commande au handler et à AppManifest::commands, puis accorder sa
   permission uniquement dans la capability nécessaire. Pour une méthode du
   multiplexeur, mettre à jour le contrat commun et ses validateurs/types générés.
3. Réviser la matrice et le test de politique ; conserver la garde native, la CSP,
   les validations métier et les confirmations. Toute nouvelle capability doit
   être activée explicitement après examen.
4. Ajouter les cas autorisés/refusés au banc natif, puis exécuter les suites.

## Validation Windows

```powershell
node --test tests/tauri-permissions.test.mjs
cargo test --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc
npm run build
npm run test:permissions:build
npm run test:permissions
```

Le build du banc exige MSVC/Rust et les ressources Tauri préparées. Le chemin
du binaire suit CARGO_TARGET_DIR ; PAM_PERMISSION_TEST_HOST permet de le préciser.
Le job CI native exécute aussi ce banc après les autres contrôles WebView2.

Le banc réutilise le handler, la CSP, le manifeste et les capabilities de
production dans de vraies WebView2 : main locale, fenêtre locale non autorisée,
origine HTTP de boucle locale, puis main naviguée vers cette origine. Une
commande témoin enregistrée sans permission doit être refusée partout. Le test
de politique échoue aussi pour une commande ajoutée sans examen ou une extension
de fenêtres/origines/plugins. Chaque méthode est admise à la validation de
payload depuis main et refusée avant décodage depuis les contextes non autorisés.

Le superviseur, les actions de fenêtre et la lecture du raccourci utilisent le
handler de production. Les événements vocaux sont réellement émis par Rust et
écoutés/retirés dans le front. Le test dialog vérifie l'admission par son vrai
désérialiseur avec une entrée invalide : il n'ouvre pas le sélecteur système.
Le backend est indisponible volontairement, le raccourci utilise un double et
aucun tray, modèle, profil personnel ou application externe n'est initialisé.
Les profils et processus de test sont nettoyés. Ces tests établissent les refus
du périmètre actuel ; aucune exploitation distante antérieure n'est revendiquée.

Référence : [Capabilities Tauri](https://v2.tauri.app/security/capabilities/) et sources de la version
Tauri verrouillée dans Cargo.lock.
