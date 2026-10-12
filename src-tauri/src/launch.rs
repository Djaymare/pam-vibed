//! Applications are created by the Tauri host, outside the sidecar's job.
use crate::applications::Catalogue;
use serde_json::{json, Value};
use std::{
    path::Path,
    process::{Command, Stdio},
};

pub(crate) fn handle(
    method: &str,
    payload: &Value,
    catalogue: &Catalogue,
) -> Result<Value, String> {
    match method {
        "launch_application" => launch(payload, catalogue),
        "deezer_open" => {
            crate::media::handle(&json!({"method":"deezer_open","uri":payload["uri"]}))
        }
        _ => Err("Demande de lancement inconnue.".into()),
    }
}

fn launch(payload: &Value, catalogue: &Catalogue) -> Result<Value, String> {
    let executable = payload["executable"]
        .as_str()
        .ok_or("Exécutable invalide.")?;
    let path = Path::new(executable);
    if executable.len() > 1024
        || executable.contains('\0')
        || !path.is_absolute()
        || !executable.to_ascii_lowercase().ends_with(".exe")
        || !path.is_file()
    {
        return Err("Choisissez le chemin absolu d’un exécutable .exe existant.".into());
    }
    let arguments = payload["arguments"]
        .as_array()
        .ok_or("Arguments invalides.")?;
    if arguments.len() > 20
        || arguments.iter().any(|v| {
            v.as_str()
                .is_none_or(|s| s.len() > 8192 || s.contains('\0'))
        })
    {
        return Err("Arguments de lancement invalides.".into());
    }
    if !payload["windowsApp"].is_null() {
        let mut canonical = payload.clone();
        catalogue.prepare(&mut canonical)?;
        if canonical["executable"] != payload["executable"]
            || canonical["arguments"] != payload["arguments"]
        {
            return Err("Le lancement ne correspond pas au catalogue Windows.".into());
        }
    }
    let mut command = Command::new(path);
    command
        .args(arguments.iter().map(|v| v.as_str().unwrap()))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000 | 0x00000200); // No console; no shell.
    }
    let child = command
        .spawn()
        .map_err(|e| format!("Impossible de lancer l’application : {e}"))?;
    // Dropping Child closes our handles, without terminating the user's process.
    Ok(json!({"accepted": true, "pid": child.id()}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_invalid_native_launches() {
        for payload in [
            json!({}),
            json!({"executable":"missing.exe","arguments":[]}),
            json!({"executable":"C:\\missing.exe","arguments":[]}),
            json!({"executable":std::env::current_exe().unwrap(),"arguments":[null]}),
            json!({"executable":std::env::current_exe().unwrap(),"arguments":["nul\0argument"]}),
            json!({"executable":std::env::current_exe().unwrap(),"arguments":vec!["x";21]}),
            json!({"executable":std::env::current_exe().unwrap(),"arguments":["x".repeat(8193)]}),
        ] {
            assert!(handle("launch_application", &payload, &Catalogue::default()).is_err());
        }
        assert!(handle("unknown", &json!({}), &Catalogue::default()).is_err());
        assert!(handle(
            "deezer_open",
            &json!({"method":"deezer_open","uri":"https://invalid.test/"}),
            &Catalogue::default()
        )
        .is_err());
    }
}
