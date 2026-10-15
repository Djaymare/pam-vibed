use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
mod applications;
mod bridge;
mod diagnostics;
mod launch;
pub mod media;

#[tauri::command]
async fn discover_applications(
    window: tauri::WebviewWindow,
) -> Result<Vec<applications::InstalledApplication>, String> {
    if window.label() != "main" {
        return Err("Fenêtre non autorisée.".into());
    }
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || app.state::<Arc<applications::Catalogue>>().scan())
        .await
        .map_err(|error| error.to_string())?
}

struct AssistantBridge {
    transport: bridge::Bridge,
    shortcut_error: String,
}
impl AssistantBridge {
    fn request(&self, method: &str, payload: Value) -> Result<Value, String> {
        if method == "restart_engine" {
            self.transport.restart();
        }
        self.transport
            .request(method, payload)
            .map_err(|error| serde_json::to_string(&error.envelope()).expect("error envelope"))
    }
}

fn runtime_path(resources: &Path, relative: &str) -> PathBuf {
    let packaged = resources.join(relative);
    #[cfg(debug_assertions)]
    if !packaged.exists() {
        return PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(relative);
    }
    packaged
}
fn show(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

// Feature-gated entrypoint in the compiled Tauri executable. Exercises the
// production bridge and job lifecycle with an isolated profile and fixtures.
#[cfg(feature = "process-tests")]
pub fn run_process_test_host() {
    let args: Vec<_> = std::env::args_os().skip(2).collect();
    assert_eq!(
        args.len(),
        4,
        "node, script, runtime, isolated profile required"
    );
    use std::io::BufRead;
    let catalogue = Arc::new(applications::Catalogue::default());
    let bridge = AssistantBridge {
        transport: bridge::Bridge::new(bridge::Config {
            catalogue: catalogue.clone(),
            node: args[0].clone().into(),
            script: args[1].clone().into(),
            runtime: args[2].clone().into(),
            profile: args[3].clone().into(),
        })
        .expect("process-test bridge"),
        shortcut_error: String::new(),
    };
    for line in std::io::stdin().lock().lines() {
        let request: Value = serde_json::from_str(&line.unwrap()).unwrap();
        let method = request["method"].as_str().unwrap();
        if method == "quit" {
            break;
        }
        let result = if method == "create_fixture_shortcut" {
            process_test_shortcut(&request["payload"])
        } else if method == "discover_applications" {
            catalogue.scan().map(|entries| json!(entries))
        } else if method == "restart_sidecar" {
            bridge.transport.restart();
            bridge.request("status", json!({}))
        } else {
            let mut payload = request["payload"].clone();
            catalogue_request(&bridge, &catalogue, method, &mut payload)
        };
        let response = match result {
            Ok(result) => json!({"ok":true,"result":result}),
            Err(error) => json!({"ok":false,"error":error}),
        };
        println!("{response}");
    }
}

#[cfg(all(windows, feature = "process-tests"))]
fn process_test_shortcut(payload: &Value) -> Result<Value, String> {
    use windows::{
        core::{Interface, PCWSTR},
        Win32::{
            System::Com::{
                CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile,
                CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
            },
            UI::Shell::{IShellLinkW, ShellLink},
        },
    };
    let text = |field: &str| -> Result<Vec<u16>, String> {
        let value = payload[field].as_str().ok_or("Fixture field missing")?;
        if value.contains('\0') {
            return Err("Invalid fixture field".into());
        }
        Ok(value.encode_utf16().chain(Some(0)).collect())
    };
    let target = text("target")?;
    let arguments = text("arguments")?;
    let destination = text("destination")?;
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(|e| e.to_string())?;
        let result = (|| -> windows::core::Result<()> {
            let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
            link.SetPath(PCWSTR(target.as_ptr()))?;
            link.SetArguments(PCWSTR(arguments.as_ptr()))?;
            let persist: IPersistFile = link.cast()?;
            persist.Save(PCWSTR(destination.as_ptr()), true)?;
            Ok(())
        })();
        CoUninitialize();
        result.map_err(|e| e.to_string())?;
    }
    Ok(json!({"created":true}))
}

#[cfg(all(not(windows), feature = "process-tests"))]
fn process_test_shortcut(_: &Value) -> Result<Value, String> {
    Err("Windows required".into())
}
fn toggle_voice(app: &tauri::AppHandle) {
    show(app);
    let _ = app.emit_to("main", "pam-toggle-voice", ());
}

fn catalogue_request(
    bridge: &AssistantBridge,
    catalogue: &applications::Catalogue,
    method: &str,
    payload: &mut Value,
) -> Result<Value, String> {
    if matches!(method, "save_application" | "test_application") {
        let previous_status = if method == "save_application"
            && payload["enabled"] == false
            && payload["id"].is_string()
        {
            bridge.request("status", json!({}))?
        } else {
            Value::Null
        };
        let previous = previous_status["config"]["applications"]
            .as_array()
            .and_then(|apps| apps.iter().find(|app| app["id"] == payload["id"]));
        catalogue.prepare_request(method, payload, previous)?;
    } else if method == "set_application_enabled" && payload["enabled"] == true {
        let status = bridge.request("status", json!({}))?;
        let app = status["config"]["applications"]
            .as_array()
            .and_then(|apps| apps.iter().find(|app| app["id"] == payload["id"]))
            .ok_or("Application à modifier introuvable.")?;
        let mut canonical = app.clone();
        catalogue.prepare_fresh(&mut canonical)?;
        if canonical["executable"] != app["executable"]
            || canonical["arguments"] != app["arguments"]
        {
            return Err("La cible a changé. Réparez l’application avant de la réactiver.".into());
        }
    }
    let mut result = bridge.request(method, payload.clone())?;
    if method == "status" {
        catalogue.annotate_status(&mut result);
    }
    Ok(result)
}

#[tauri::command]
async fn assistant_request(
    window: tauri::WebviewWindow,
    method: String,
    payload: Option<Value>,
) -> Result<Value, diagnostics::Error> {
    if window.label() != "main" {
        return Err(diagnostics::Error::new("invalid_request", "", "validation"));
    }
    if !matches!(
        method.as_str(),
        "status"
            | "export_diagnostics"
            | "diagnostic_event"
            | "recover_config"
            | "export_config"
            | "preview_import"
            | "import_config"
            | "save_application"
            | "set_application_enabled"
            | "delete_application"
            | "settings"
            | "process_text"
            | "process_audio"
            | "confirm"
            | "discard"
            | "correct_request"
            | "restart_engine"
            | "test_application"
            | "media_sessions"
            | "prepare_action"
            | "save_command_alias"
            | "delete_command_alias"
    ) {
        return Err(diagnostics::Error::new("invalid_request", "", "validation"));
    }
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AssistantBridge>();
        let mut payload = payload.unwrap_or(json!({}));
        if method == "export_diagnostics" { return state.transport.export_diagnostics(); }
        if method == "diagnostic_event" {
            let code = payload["code"].as_str().unwrap_or("");
            if !matches!(code,"microphone_denied"|"microphone_missing") { return Err(diagnostics::Error::new("invalid_request", "", "validation")); }
            let error = diagnostics::Error::new(code, "", "microphone");
            state.transport.record_diagnostic(&error, "webview");
            return Ok(json!(error));
        }
        let mut result = catalogue_request(&state, &app.state::<Arc<applications::Catalogue>>(), &method, &mut payload).map_err(|text| {
            let error = serde_json::from_str::<Value>(&text).ok().filter(|v| v["code"].is_string()).map(|v| diagnostics::Error::from_value(&v,v["requestId"].as_str().unwrap_or("")))
                .unwrap_or_else(|| diagnostics::Error::new("target_missing", "", "target"));
            state.transport.record_diagnostic(&error,"rust"); error
        })?;
        if method == "status" { result["desktop"] = json!({ "shortcut": "Ctrl + Maj + Espace", "shortcutAvailable": state.shortcut_error.is_empty(), "shortcutError": state.shortcut_error, "closeToTray": true }); }
        Ok(result)
    }).await.map_err(|_| diagnostics::Error::new("transport_unavailable", "", "transport"))?
}
#[tauri::command]
fn desktop_action(window: tauri::WebviewWindow, action: String) -> Result<(), String> {
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
                tray.set_tooltip(Some(if action == "listening" {
                    "PAM — microphone actif"
                } else {
                    "PAM — Ctrl + Maj + Espace pour parler"
                }))
                .map_err(|e| e.to_string())?;
            }
            Ok(())
        }
        _ => Err("Action inconnue.".into()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Arc::new(applications::Catalogue::default()))
        .plugin(tauri_plugin_single_instance::init(|app, _, _| show(app)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle_voice(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            use tauri::{
                menu::{Menu, MenuItem},
                tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
            };
            let show_item = MenuItem::with_id(app, "show", "Afficher PAM", true, None::<&str>)?;
            let listen_item = MenuItem::with_id(
                app,
                "listen",
                "Parler / arrêter (Ctrl + Maj + Espace)",
                true,
                None::<&str>,
            )?;
            let quit_item = MenuItem::with_id(app, "quit", "Quitter PAM", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &listen_item, &quit_item])?;
            TrayIconBuilder::with_id("pam")
                .icon(app.default_window_icon().ok_or("Icône absente")?.clone())
                .tooltip("PAM — Ctrl + Maj + Espace pour parler")
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
            let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);
            let shortcut_error = app
                .global_shortcut()
                .register(shortcut)
                .err()
                .map(|e| format!("Ctrl + Maj + Espace est indisponible : {e}"))
                .unwrap_or_default();
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
            app.manage(AssistantBridge {
                transport: bridge::Bridge::new(bridge::Config {
                    catalogue: app.state::<Arc<applications::Catalogue>>().inner().clone(),
                    node,
                    script,
                    runtime: runtime_path(&resources, "runtime"),
                    profile: config,
                })?,
                shortcut_error,
            });
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(15));
                let state = handle.state::<AssistantBridge>();
                if state.transport.is_stopped() {
                    break;
                }
                let check = state.transport.is_idle() && state.transport.has_started();
                // Supervise while hidden too. Warm a replacement without replaying
                // a failed request, approval or application launch.
                if check {
                    let _ = state.request("status", json!({}));
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.emit("pam-cancel-voice", ());
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            assistant_request,
            desktop_action,
            discover_applications
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                let state = app.state::<AssistantBridge>();
                state.transport.shutdown();
            }
        });
}
