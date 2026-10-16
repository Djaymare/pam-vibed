//! Tauri windows, tray and shortcut integration.
use crate::shortcuts::{NativeRegistrar, VoiceShortcut};
use crate::{applications, bridge, host::AssistantBridge};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};
use tauri::{Emitter, Manager};
fn runtime_path(resources: &Path, relative: &str) -> PathBuf {
    let packaged = resources.join(relative);
    #[cfg(debug_assertions)]
    if !packaged.exists() {
        return PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(relative);
    }
    packaged
}

pub(crate) fn show(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub(crate) fn toggle_voice(app: &tauri::AppHandle) {
    show(app);
    let _ = app.emit_to("main", "pam-toggle-voice", ());
}

pub(crate) fn action(window: tauri::WebviewWindow, action: String) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Fenêtre non autorisée.".into());
    }
    match action.as_str() {
        "hide" => {
            window
                .emit("pam-cancel-voice", ())
                .map_err(|e| e.to_string())?;
            window.hide().map_err(|e| e.to_string())
        }
        "quit" => {
            window.app_handle().exit(0);
            Ok(())
        }
        "listening" | "idle" => {
            if let Some(tray) = window.app_handle().tray_by_id("pam") {
                let tooltip = if action == "listening" {
                    "PAM — microphone actif".to_owned()
                } else {
                    let state = window
                        .app_handle()
                        .state::<std::sync::Mutex<VoiceShortcut>>();
                    let preference = state.lock().map_err(|_| "Réglage indisponible")?;
                    if preference.available {
                        format!(
                            "PAM — {} pour parler",
                            crate::shortcuts::choice(&preference.id).unwrap().0
                        )
                    } else {
                        "PAM — utilisez le menu pour parler".into()
                    }
                };
                tray.set_tooltip(Some(tooltip)).map_err(|e| e.to_string())?;
            }
            Ok(())
        }
        _ => Err("Action inconnue.".into()),
    }
}

pub(crate) fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::{
        menu::{Menu, MenuItem},
        tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    };
    let show_item = MenuItem::with_id(app, "show", "Afficher PAM", true, None::<&str>)?;
    let listen_item = MenuItem::with_id(app, "listen", "Parler / arrêter", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quitter PAM", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &listen_item, &quit_item])?;
    TrayIconBuilder::with_id("pam")
        .icon(app.default_window_icon().ok_or("Icône absente")?.clone())
        .tooltip("PAM — afficher ou parler depuis le menu")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show(app),
            "listen" => toggle_voice(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                show(tray.app_handle());
            }
        })
        .build(app)?;
    let resources = app.path().resource_dir()?;
    let executable = std::env::current_exe()?;
    let node = executable
        .parent()
        .ok_or("Dossier de l’application absent")?
        .join("pam-node.exe");
    #[cfg(debug_assertions)]
    let node = if node.exists() {
        node
    } else {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries/pam-node-x86_64-pc-windows-msvc.exe")
    };
    let script = resources.join("sidecar/main.cjs");
    #[cfg(debug_assertions)]
    let script = if script.exists() {
        script
    } else {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../sidecar/main.cjs")
    };
    // Optional isolated profile for development and packaged integration tests.
    let config = if let Some(directory) = std::env::var_os("PAM_PROFILE_DIR") {
        let directory = PathBuf::from(directory);
        if !directory.is_absolute() {
            return Err("PAM_PROFILE_DIR doit être un chemin absolu.".into());
        }
        directory
    } else {
        app.path().app_config_dir()?
    };
    let preference = VoiceShortcut::load(&config, &NativeRegistrar(app.handle()));
    app.manage(std::sync::Mutex::new(preference));
    app.manage(AssistantBridge {
        transport: bridge::Bridge::new(bridge::Config {
            catalogue: app.state::<Arc<applications::Catalogue>>().inner().clone(),
            node,
            script,
            runtime: runtime_path(&resources, "runtime"),
            profile: config,
        })?,
    });
    Ok(())
}
