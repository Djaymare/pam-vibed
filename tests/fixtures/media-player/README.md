# Lecteur GSMTC jetable

Cette fixture Windows utilise `MediaPlayer`, un WAV silencieux créé par le test
et un volume local de zéro. Elle publie titre, état et capacités dans les vraies
sessions GSMTC ; ses boutons natifs pilotent exclusivement cet objet. Le gestionnaire
automatique est désactivé pour rendre les transitions de capacités explicites.
L’application PAM et son validateur natif restent inchangés.

Depuis la racine, avec Rust/MSVC et les dépendances Windows disponibles :

```powershell
cargo build --manifest-path src-tauri/Cargo.toml --locked --target x86_64-pc-windows-msvc --example media
cargo build --manifest-path tests/fixtures/media-player/Cargo.toml --locked --target x86_64-pc-windows-msvc
npm run test:media:refresh
```

Si `CARGO_TARGET_DIR` est personnalisé, définir `PAM_NATIVE_EXE` vers `media.exe`
et `PAM_MEDIA_TEST_PLAYER` vers `pam-media-fixture.exe`. Le script refuse toute
cible préexistante, ambiguë ou dont le titre n’a plus le marqueur unique du test.
Il envoie `quit` par stdin, vérifie l’arrêt du processus et supprime son seul
répertoire temporaire. Aucun profil ou lecteur personnel n’est commandé.

Les métadonnées/capacités sont celles de cette fixture, pas celles de tous les
lecteurs du marché. Le renderer Vue et les événements de premier plan sont
simulés ; la publication, l’énumération et les commandes GSMTC sont réelles.
