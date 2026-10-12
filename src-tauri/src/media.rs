//! Native GSMTC adapter. No global keys and no fallback to the current player.
use serde_json::{json, Value};

pub const DEEZER_APP_ID: &str = "Deezer.62021768415AF_q7m17pa7q8kj0!Deezer.Music";

fn allowed_deezer_uri(uri: &str) -> bool {
    let Some(path) = uri
        .strip_prefix("deezer://www.deezer.com/")
        .or_else(|| uri.strip_prefix("dzr://www.deezer.com/"))
    else {
        return false;
    };
    if uri.len() > 4096 || uri.chars().any(|c| c.is_control()) {
        return false;
    }
    if matches!(
        path,
        "" | "podcasts"
            | "explore"
            | "reload"
            | "user/me/flow"
            | "user/me/tracks"
            | "channels/explore"
            | "channels/charts"
            | "channels/moods"
            | "channels/radios"
            | "settings/audio"
            | "settings/app_theme"
    ) {
        return true;
    }
    if let Some(query) = path.strip_prefix("search/") {
        return !query.is_empty()
            && query
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"-_.!~*'()%".contains(&c));
    }
    let Some((kind, id)) = path.split_once('/') else {
        return false;
    };
    if kind == "smarttracklist" {
        let id = id.strip_suffix("?autoplay=true").unwrap_or(id);
        return !id.is_empty()
            && id.len() <= 80
            && id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"_-".contains(&c));
    }
    matches!(
        kind,
        "track" | "album" | "artist" | "playlist" | "show" | "episode" | "profile"
    ) && !id.is_empty()
        && id.len() <= 19
        && !id.starts_with('0')
        && id.bytes().all(|c| c.is_ascii_digit())
}

pub fn handle(request: &Value) -> Result<Value, String> {
    #[cfg(windows)]
    {
        native::handle(request).map_err(|e| format!("Multimédia Windows : {e}"))
    }
    #[cfg(not(windows))]
    {
        let _ = request;
        Err("Les sessions multimédias nécessitent Windows 10 1809 ou plus récent.".into())
    }
}

// Invoked before Tauri/single-instance startup, by the bundled Node sidecar.
// JSON goes over pipes, never through a shell; the caller enforces a deadline.
pub fn run_cli() {
    use std::io::Read;
    let mut bytes = Vec::new();
    let result = std::io::stdin()
        .take(16_385)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())
        .and_then(|_| {
            if bytes.len() > 16_384 {
                return Err("Demande native trop volumineuse.".into());
            }
            let request = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
            handle(&request)
        });
    let response = match result {
        Ok(value) => json!({"ok":true,"result":value}),
        Err(error) => json!({"ok":false,"error":error}),
    };
    println!("{response}");
}

#[cfg(windows)]
mod native {
    use super::*;
    use windows::{
        core::HSTRING,
        Foundation::Uri,
        Media::Control::{
            GlobalSystemMediaTransportControlsSession as Session,
            GlobalSystemMediaTransportControlsSessionManager as Manager,
            GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
        },
        System::{Launcher, LauncherOptions},
        Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED},
    };

    struct Apartment;
    impl Drop for Apartment {
        fn drop(&mut self) {
            unsafe { RoUninitialize() };
        }
    }
    fn source(session: &Session) -> Result<String, String> {
        Ok(session.SourceAppUserModelId().map_err(err)?.to_string())
    }
    fn err(e: windows::core::Error) -> String {
        e.to_string()
    }
    fn snapshot(session: &Session) -> Result<Value, String> {
        let info = session.GetPlaybackInfo().map_err(err)?;
        let c = info.Controls().map_err(err)?;
        let properties = session
            .TryGetMediaPropertiesAsync()
            .map_err(err)?
            .join()
            .map_err(err)?;
        let status = match info.PlaybackStatus().map_err(err)? {
            PlaybackStatus::Playing => "Lecture",
            PlaybackStatus::Paused => "Pause",
            PlaybackStatus::Stopped => "Arrêt",
            PlaybackStatus::Closed => "Fermée",
            PlaybackStatus::Opened => "Ouverte",
            PlaybackStatus::Changing => "Transition",
            _ => "Inconnu",
        };
        Ok(json!({
            "sourceAppId": source(session)?, "title": properties.Title().map_err(err)?.to_string(),
            "artist": properties.Artist().map_err(err)?.to_string(), "album": properties.AlbumTitle().map_err(err)?.to_string(),
            "playbackStatus": status,
            "capabilities": {"play":c.IsPlayEnabled().map_err(err)?, "pause":c.IsPauseEnabled().map_err(err)?,
                "next":c.IsNextEnabled().map_err(err)?, "previous":c.IsPreviousEnabled().map_err(err)?,
                "stop":c.IsStopEnabled().map_err(err)?, "toggle":c.IsPlayPauseToggleEnabled().map_err(err)?}
        }))
    }
    pub fn handle(request: &Value) -> Result<Value, String> {
        unsafe { RoInitialize(RO_INIT_MULTITHREADED) }.map_err(err)?;
        let _apartment = Apartment;
        let method = request["method"]
            .as_str()
            .ok_or("Méthode native manquante.")?;
        if method == "deezer_open" {
            let uri = request["uri"].as_str().ok_or("Lien Deezer manquant.")?;
            // Defence in depth. The plugin performs stricter route validation.
            if !allowed_deezer_uri(uri) {
                return Err("Lien Deezer non autorisé.".into());
            }
            let options = LauncherOptions::new().map_err(err)?;
            options
                .SetTargetApplicationPackageFamilyName(&HSTRING::from(
                    DEEZER_APP_ID.split('!').next().unwrap(),
                ))
                .map_err(err)?;
            let operation = Launcher::LaunchUriWithOptionsAsync(
                &Uri::CreateUri(&HSTRING::from(uri)).map_err(err)?,
                &options,
            )
            .map_err(err)?;
            // This operation now runs in the host. Keep a bounded wait within
            // the reverse RPC deadline and never replay a timed-out launch.
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
            while operation.Status().map_err(err)?.0 == 0 {
                if std::time::Instant::now() >= deadline {
                    let _ = operation.Cancel();
                    return Err(
                        "Windows n’a pas répondu au lancement. La commande ne sera pas rejouée."
                            .into(),
                    );
                }
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            let accepted = operation.GetResults().map_err(err)?;
            return Ok(json!({"accepted":accepted,"uri":uri}));
        }
        let manager = Manager::RequestAsync().map_err(err)?.join().map_err(err)?;
        let sessions = manager.GetSessions().map_err(err)?;
        if method == "media_sessions" {
            let mut result = Vec::new();
            for session in &sessions {
                // A session can disappear while enumerating; preserve that fact.
                result.push(snapshot(&session).unwrap_or_else(|error| json!({"sourceAppId":source(&session).unwrap_or_default(),"error":error})));
            }
            return Ok(json!(result));
        }
        if method != "media_action" {
            return Err("Méthode native inconnue.".into());
        }
        let target = request["sourceAppId"]
            .as_str()
            .filter(|s| !s.is_empty() && s.len() <= 1024)
            .ok_or("Lecteur cible manquant.")?;
        let candidates: Vec<Session> = sessions
            .into_iter()
            .filter(|s| source(s).is_ok_and(|id| id.eq_ignore_ascii_case(target)))
            .collect();
        if candidates.is_empty() {
            return Err("Aucune session compatible pour ce lecteur. Ouvrez un média dans ce lecteur puis actualisez les sessions.".into());
        }
        if candidates.len() != 1 {
            return Err("Plusieurs sessions de ce lecteur sont présentes. Fermez les médias supplémentaires pour choisir sans ambiguïté.".into());
        }
        let session = &candidates[0];
        let before = snapshot(session)?;
        let action = request["action"].as_str().ok_or("Action manquante.")?;
        if !matches!(
            action,
            "play" | "pause" | "next" | "previous" | "stop" | "toggle"
        ) {
            return Err("Action multimédia inconnue.".into());
        }
        if before["capabilities"][action] != true {
            return Err(format!(
                "Ce lecteur ne prend actuellement pas en charge l’action {action}."
            ));
        }
        // Verify the chosen object still belongs to the live set, with no re-resolution.
        if !manager
            .GetSessions()
            .map_err(err)?
            .into_iter()
            .any(|s| s == *session)
        {
            return Err(
                "La session multimédia s’est fermée. Réessayez après actualisation.".into(),
            );
        }
        let operation = match action {
            "play" => session.TryPlayAsync(),
            "pause" => session.TryPauseAsync(),
            "next" => session.TrySkipNextAsync(),
            "previous" => session.TrySkipPreviousAsync(),
            "stop" => session.TryStopAsync(),
            "toggle" => session.TryTogglePlayPauseAsync(),
            _ => unreachable!(),
        }
        .map_err(err)?;
        let accepted = operation.join().map_err(err)?;
        Ok(
            json!({"accepted":accepted,"action":action,"sourceAppId":target,"before":before,
            "after":snapshot(session).unwrap_or_else(|error| json!({"error":error}))}),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::allowed_deezer_uri;
    #[test]
    fn only_established_deezer_routes() {
        for path in [
            "track/3135556",
            "album/1",
            "search/%C3%A9t%C3%A9%20%2F%3F",
            "user/me/flow",
            "user/me/tracks",
            "smarttracklist/known-id?autoplay=true",
            "channels/explore",
            "channels/charts",
            "channels/moods",
            "channels/radios",
            "settings/audio",
            "settings/app_theme",
            "reload",
            "",
        ] {
            assert!(
                allowed_deezer_uri(&format!("deezer://www.deezer.com/{path}")),
                "{path}"
            );
            assert!(
                allowed_deezer_uri(&format!("dzr://www.deezer.com/{path}")),
                "{path}"
            );
        }
        for uri in [
            "deezer://www.deezer.com/flushCache",
            "deezer://www.deezer.com/autolog/token",
            "deezer://www.deezer.com/redirect?url=https://other",
            "deezer://www.deezer.com/track/1?autoplay=true",
            "deezer://other/track/1",
            "file:///track/1",
            "deezer://www.deezer.com/track/1/../../flushCache",
        ] {
            assert!(!allowed_deezer_uri(uri), "{uri}");
        }
    }
}
