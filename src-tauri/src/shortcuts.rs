//! Validated desktop preference, separate from the assistant profile. A failed
//! replacement keeps the previous live registration and persisted selection.
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

pub const DEFAULT: &str = "ctrl_shift_space";
pub fn choice(id: &str) -> Option<(&'static str, Shortcut)> {
    let (label, modifiers, code) = match id {
        "ctrl_shift_space" => (
            "Ctrl + Maj + Espace",
            Modifiers::CONTROL | Modifiers::SHIFT,
            Code::Space,
        ),
        "ctrl_alt_space" => (
            "Ctrl + Alt + Espace",
            Modifiers::CONTROL | Modifiers::ALT,
            Code::Space,
        ),
        "ctrl_shift_f9" => (
            "Ctrl + Maj + F9",
            Modifiers::CONTROL | Modifiers::SHIFT,
            Code::F9,
        ),
        _ => return None,
    };
    Some((label, Shortcut::new(Some(modifiers), code)))
}
pub trait Registrar {
    fn register(&self, id: &str) -> Result<(), String>;
    fn unregister(&self, id: &str) -> Result<(), String>;
}
pub struct NativeRegistrar<'a>(pub &'a tauri::AppHandle);
impl Registrar for NativeRegistrar<'_> {
    fn register(&self, id: &str) -> Result<(), String> {
        self.0
            .global_shortcut()
            .register(choice(id).ok_or("Raccourci invalide")?.1)
            .map_err(|e| e.to_string())
    }
    fn unregister(&self, id: &str) -> Result<(), String> {
        self.0
            .global_shortcut()
            .unregister(choice(id).ok_or("Raccourci invalide")?.1)
            .map_err(|e| e.to_string())
    }
}
pub struct VoiceShortcut {
    path: PathBuf,
    pub id: String,
    pub available: bool,
    pub error: String,
}
impl VoiceShortcut {
    pub fn load(directory: &Path, registrar: &impl Registrar) -> Self {
        let path = directory.join("voice-shortcut.json");
        let (id, read_error) = match std::fs::read(&path) {
            Ok(bytes) => match serde_json::from_slice::<Value>(&bytes)
                .ok()
                .and_then(|v| v.as_str().map(str::to_owned))
                .filter(|v| choice(v).is_some())
            {
                Some(id) => (id, false),
                None => (DEFAULT.into(), true),
            },
            Err(e) => (DEFAULT.into(), e.kind() != std::io::ErrorKind::NotFound),
        };
        let available = registrar.register(&id).is_ok();
        let error = if !available { "Ce raccourci est occupé ou indisponible. Choisissez une autre combinaison ; le bouton du microphone et le menu de PAM restent utilisables." }
            else if read_error { "Le réglage du raccourci est illisible. La combinaison par défaut est active ; enregistrez votre choix pour réparer le réglage." }
            else { "" }.into();
        Self {
            path,
            id,
            available,
            error,
        }
    }
    pub fn snapshot(&self) -> Value {
        json!({"id":self.id,"label":choice(&self.id).unwrap().0,"available":self.available,"error":self.error})
    }
    pub fn change(&mut self, id: &str, registrar: &impl Registrar) -> Value {
        if choice(id).is_none() {
            self.error = "Choisissez une combinaison proposée.".into();
            return self.snapshot();
        }
        let changed = self.id != id;
        let candidate_new = changed || !self.available;
        if candidate_new && registrar.register(id).is_err() {
            self.error = "La combinaison choisie est occupée ou indisponible. Essayez une autre combinaison. Le réglage précédent est conservé.".into();
            return self.snapshot();
        }
        let save = || -> std::io::Result<()> {
            std::fs::create_dir_all(self.path.parent().unwrap())?;
            let temporary = self.path.with_extension(format!(
                "json.{}.{}.tmp",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos()
            ));
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)?;
            use std::io::Write;
            let result = (|| {
                file.write_all(serde_json::to_string(id)?.as_bytes())?;
                file.sync_all()?;
                drop(file);
                std::fs::rename(&temporary, &self.path)
            })();
            if result.is_err() {
                let _ = std::fs::remove_file(&temporary);
            }
            result
        };
        if save().is_err() {
            if candidate_new && registrar.unregister(id).is_err() {
                self.error = "L’enregistrement a échoué et la combinaison essayée n’a pas pu être libérée. Redémarrez PAM avant de changer à nouveau le raccourci. Le choix précédent reste sur disque.".into();
                return self.snapshot();
            }
            self.error = "Le raccourci n’a pas pu être enregistré. Vérifiez l’accès au dossier du profil puis réessayez. Le réglage précédent est conservé.".into();
            return self.snapshot();
        }
        if changed && self.available && registrar.unregister(&self.id).is_err() {
            // Keep both registrations visible as an error rather than claiming
            // the old combination has been released. Both trigger one handler.
            self.error = "Le nouveau raccourci est enregistré, mais l’ancien n’a pas pu être libéré. Redémarrez PAM pour appliquer uniquement le nouveau.".into();
        } else {
            self.error.clear();
        }
        self.id = id.into();
        self.available = true;
        self.snapshot()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::RefCell, collections::HashSet};
    #[derive(Default)]
    struct Fake {
        live: RefCell<HashSet<String>>,
        blocked: RefCell<String>,
    }
    impl Registrar for Fake {
        fn register(&self, id: &str) -> Result<(), String> {
            if *self.blocked.borrow() == id {
                Err("occupied".into())
            } else {
                self.live.borrow_mut().insert(id.into());
                Ok(())
            }
        }
        fn unregister(&self, id: &str) -> Result<(), String> {
            self.live.borrow_mut().remove(id);
            Ok(())
        }
    }
    fn directory() -> PathBuf {
        std::env::temp_dir().join(format!(
            "pam-shortcut-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }
    #[test]
    fn conflict_preserves_selection_then_alternative_survives_reload() {
        let dir = directory();
        let fake = Fake::default();
        *fake.blocked.borrow_mut() = DEFAULT.into();
        let mut state = VoiceShortcut::load(&dir, &fake);
        assert!(!state.available);
        state.change("ctrl_alt_space", &fake);
        assert!(state.available);
        assert_eq!(state.id, "ctrl_alt_space");
        *fake.blocked.borrow_mut() = "ctrl_shift_f9".into();
        state.change("ctrl_shift_f9", &fake);
        assert_eq!(state.id, "ctrl_alt_space");
        assert!(state.available);
        assert!(fake.live.borrow().contains("ctrl_alt_space"));
        state.change("arbitrary", &fake);
        assert_eq!(state.id, "ctrl_alt_space");
        let loaded = VoiceShortcut::load(&dir, &Fake::default());
        assert_eq!(loaded.id, "ctrl_alt_space");
        fake.blocked.borrow_mut().clear();
        state.change("ctrl_shift_f9", &fake);
        assert_eq!(state.id, "ctrl_shift_f9");
        assert_eq!(fake.live.borrow().len(), 1);
        assert_eq!(
            serde_json::from_slice::<String>(
                &std::fs::read(dir.join("voice-shortcut.json")).unwrap()
            )
            .unwrap(),
            "ctrl_shift_f9"
        );
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn write_failure_rolls_back_registration_and_never_writes_assistant_profile() {
        let dir = directory();
        std::fs::write(&dir, b"blocked directory").unwrap();
        let fake = Fake::default();
        let mut state = VoiceShortcut::load(&dir, &fake);
        state.change("ctrl_alt_space", &fake);
        assert_eq!(state.id, DEFAULT);
        assert!(state.available);
        assert!(!fake.live.borrow().contains("ctrl_alt_space"));
        assert_eq!(std::fs::read(&dir).unwrap(), b"blocked directory");
        std::fs::remove_file(dir).unwrap();
    }
    #[test]
    fn corrupt_preference_keeps_startup_available_and_can_be_repaired() {
        let dir = directory();
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("voice-shortcut.json"), b"bad preference").unwrap();
        let fake = Fake::default();
        let mut state = VoiceShortcut::load(&dir, &fake);
        assert!(state.available);
        assert!(!state.error.is_empty());
        state.change(DEFAULT, &fake);
        assert!(state.error.is_empty());
        assert_eq!(
            serde_json::from_slice::<String>(
                &std::fs::read(dir.join("voice-shortcut.json")).unwrap()
            )
            .unwrap(),
            DEFAULT
        );
        std::fs::remove_dir_all(dir).unwrap();
    }
}
