# Frontières Rust et ressources Windows

`lib.rs` compose Tauri et admet les commandes de la fenêtre principale.
`host.rs` conserve la validation et la distribution IPC communes à Tauri et à
l’hôte natif de tests. Les formes de messages viennent de `contracts`, sans
copie supplémentaire du contrat PAM-13.

| Module | Responsabilité et isolation |
| --- | --- |
| `bridge` | Acteur unique, file bornée, pipe, budgets, corrélation et absence de rejeu. `with_services` remplace l’horloge et la création de processus ; `RequestTransport` permet de tester l’admission et les réponses de `host` sans Node. |
| `supervision` | Interfaces `Process`, `ProcessFactory`, `Clock`, propriété `OwnedProcess` et politique de cycle de vie/reprise. Les tests de décision et d’erreur peuvent fonctionner sans processus réel. |
| `job` | Job Object interne avec `KILL_ON_JOB_CLOSE`, configuration et assignation Windows ; propriétaire `OwnedHandle`. |
| `desktop` | Fenêtre, tray, raccourci et ressources. Le bridge possède sa surveillance. |
| `windows_resources` | Initialisation STA COM ou MTA WinRT et désinitialisation symétrique. |
| `applications/native` | Lecture du catalogue Shell, propriétés et icônes dans un STA. |
| `process_tests` | Hôte de test optionnel et création de raccourcis jetables, avec les mêmes fonctions IPC que l’application. |

Le bridge possède l’acteur et le contrôleur de délais, avec leurs handles de fin.
L’acteur sérialise aussi les sondes `status`, après 15 secondes d’inactivité d’un
transport déjà utilisé. Les états sont démarrage, prêt (IPC), reprise, arrêt
demandé et arrêté. Après panne de transport/démarrage ou de modèle, les délais
sont 1, 2, 4, 8, 16, 32 puis 60 secondes, plafond conservé jusqu’à un retour
durable de 60 secondes vérifié par des réponses. Une demande pendant ce délai
échoue avec `transport_busy` ; elle n’est pas conservée pour un rejeu. Une reprise
automatique ne fait que `status` et son warmup, jamais une inférence métier ou
un effet externe. Le contrôleur de délais peut tuer le job sans verrou de pipe,
y compris pour une sonde sans appelant. Il ne crée aucun processus.

`shutdown` ferme l’admission, interrompt le job, réveille les appelants dans une
tranche de 50 ms et joint les deux threads avec un budget commun de 2 secondes.
Son résultat indique si les handles ont tous été joints. Un appel natif déjà
engagé peut dépasser ce budget ; aucun nouveau démarrage ni effet n’est alors
autorisé. La transition retardée journalise le dépassement lorsque cet appel
revient. Le destructeur ne répète pas le budget après un arrêt explicite.
Les transitions sont enregistrées dans les diagnostics locaux filtrés PAM-12.
Les attentes de canal/pipe restent de vraies attentes système ; injecter une
horloge ne simule pas l’ordonnanceur Windows. Les tests natifs restent nécessaires.

Le processus du sidecar est possédé avant toute configuration faillible du job.
Tout abandon tue puis collecte la sortie du processus pendant au plus 500 ms.
Le Job Object conserve la terminaison des descendants internes sous Windows.
Une fois publié dans le contrôle du
bridge, une interruption termine le job sans prendre le verrou du pipe. Lors
du retrait, le job est fermé avant l’attente des lecteurs pour fermer aussi
les pipes hérités par les enfants internes. Une application demandée par
l’utilisateur est lancée par `launch` dans l’hôte, hors de ce job.

Chaque appel unsafe restant porte sa justification locale, vérifiée par
`clippy::undocumented_unsafe_blocks`. Le lint `unsafe_op_in_unsafe_fn` impose
aussi une zone explicite dans les fonctions unsafe. Aucune implémentation
unsafe de `Send` ou `Sync` n’est nécessaire.

| Ressource | Invariant de propriété |
| --- | --- |
| Job | `CreateJobObjectW` transfère un handle non nul à un unique `OwnedHandle`. Les appels empruntent ce propriétaire ; les erreurs de configuration ferment aussi le handle. |
| Appartement | Seules les initialisations réussies créent une garde. Même `S_FALSE` acquiert un compte à libérer. Le marqueur `Rc` interdit transfert et partage entre threads. Déclarer la garde avant les interfaces pour libérer celles-ci d’abord. |
| Interfaces COM | Les wrappers `windows` libèrent leurs références dans le même STA, avant sa garde. Aucun pointeur d’interface n’est exporté par le catalogue. |
| Chaîne Shell | `take_string` accepte uniquement un résultat Shell alloué par CoTaskMem, UTF-16 terminé par NUL, possédé par l’appelant. `TaskString` libère aussi les chaînes vides ou mal encodées. |
| Bitmap et DC | `Bitmap` libère le résultat de `GetImage`/la fixture par `DeleteObject`. `ScreenDc` associe `GetDC(None)` et `ReleaseDC(None)` sur le même thread, y compris après erreur d’encodage. Aucun bitmap n’est sélectionné dans un DC. |
| Buffers | Les appels reçoivent tailles et alignements exacts. Le raster 32 bpp est limité à 64 × 64 et alloue `largeur × hauteur × 4` octets ; la hauteur utilise `checked_abs`. Les chaînes de raccourci conservent leur buffer UTF-16 terminé pendant chaque appel synchrone. |

Références : [Rustonomicon](https://doc.rust-lang.org/nomicon/safe-unsafe-meaning.html),
[GetDIBits](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-getdibits),
[GetImage](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-ishellitemimagefactory-getimage),
[CoUninitialize](https://learn.microsoft.com/en-us/windows/win32/api/combaseapi/nf-combaseapi-couninitialize).
