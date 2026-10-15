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
mod contracts;
mod diagnostics;
mod launch;
pub mod media;

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
    let mut serial = 0u64;
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
            serial += 1;
            let wire = if method == "contract_request" {
                request["payload"].clone()
            } else {
                json!({"version":contracts::VERSION,"id":serial,"requestId":diagnostics::request_id(),"method":method,"payload":request["payload"]})
            };
            let result = handle_assistant_request(&bridge, &catalogue, wire)
                .map_err(|e| serde_json::to_string(&e).unwrap());
            println!(
                "{}",
                match result {
                    Ok(response) => response,
                    Err(error) => json!({"ok":false,"error":error}),
                }
            );
            continue;
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
    request_id: &str,
) -> Result<Value, diagnostics::Error> {
    let request = |method: &str, payload: Value| {
        bridge
            .transport
            .request_correlated(method, payload, request_id)
            .map_err(|e| e.envelope())
    };
    let target_error = |_| diagnostics::Error::new("target_missing", request_id, "target");
    if matches!(method, "save_application" | "test_application") {
        let previous_status = if method == "save_application"
            && payload["enabled"] == false
            && payload["id"].is_string()
        {
            request("status", json!({}))?
        } else {
            Value::Null
        };
        let previous = previous_status["config"]["applications"]
            .as_array()
            .and_then(|a| a.iter().find(|a| a["id"] == payload["id"]));
        catalogue
            .prepare_request(method, payload, previous)
            .map_err(target_error)?;
    } else if method == "set_application_enabled" && payload["enabled"] == true {
        let status = request("status", json!({}))?;
        let original = status["config"]["applications"]
            .as_array()
            .and_then(|a| a.iter().find(|a| a["id"] == payload["id"]))
            .ok_or_else(|| target_error(String::new()))?;
        let mut canonical = original.clone();
        catalogue
            .prepare_fresh(&mut canonical)
            .map_err(target_error)?;
        if canonical["executable"] != original["executable"]
            || canonical["arguments"] != original["arguments"]
        {
            return Err(target_error(String::new()));
        }
    }
    if method == "restart_engine" {
        bridge.transport.restart();
    }
    let mut result = request(method, payload.clone())?;
    if method == "status" {
        catalogue.annotate_status(&mut result);
        result["desktop"] = json!({"shortcut":"Ctrl + Maj + Espace","shortcutAvailable":bridge.shortcut_error.is_empty(),"shortcutError":bridge.shortcut_error,"closeToTray":true});
    }
    Ok(result)
}

// Shared by the Tauri command and the feature-gated native test host, so the
// latter exercises admission validation and the real production response path.
fn handle_assistant_request(
    state: &AssistantBridge,
    catalogue: &applications::Catalogue,
    value: Value,
) -> Result<Value, diagnostics::Error> {
    let request = contracts::decode(value)?;
    let method = request.call.method().name();
    let id = &request.request_id;
    let result = match method {
        "discover_applications" => catalogue
            .scan()
            .map(|apps| json!(apps))
            .map_err(|_| diagnostics::Error::new("target_missing", id, "target")),
        "export_diagnostics" => state.transport.export_diagnostics(),
        "diagnostic_event" => {
            let error = diagnostics::Error::new(
                request.call.payload()["code"].as_str().unwrap(),
                id,
                "microphone",
            );
            state.transport.record_diagnostic(&error, "webview");
            Ok(json!(error))
        }
        _ => catalogue_request(state, catalogue, method, &mut request.call.payload(), id),
    };
    let mut response =
        json!({"version":contracts::VERSION,"id":request.id,"requestId":id,"method":method});
    match result {
        Ok(result) if contracts::valid_result(method, &result) => {
            response["ok"] = json!(true);
            response["result"] = result;
        }
        other => {
            let error = match other {
                Err(e) => diagnostics::Error::new(&e.code, id, &e.stage),
                _ => diagnostics::Error::new("transport_protocol", id, "response"),
            };
            state.transport.record_diagnostic(&error, "rust");
            response["ok"] = json!(false);
            response["error"] = json!(error);
        }
    }
    Ok(response)
}

#[tauri::command]
async fn assistant_request(
    window: tauri::WebviewWindow,
    request: Value,
) -> Result<Value, diagnostics::Error> {
    if window.label() != "main" {
        return Err(diagnostics::Error::new("invalid_request", "", "validation"));
    }
    let decoded = contracts::decode(request.clone())?;
    if decoded.call.method().name() == "desktop_action" {
        let result = desktop_action(
            window,
            decoded.call.payload()["action"]
                .as_str()
                .unwrap()
                .to_owned(),
        );
        return Ok(match result {
            Ok(()) => {
                json!({"version":contracts::VERSION,"id":decoded.id,"requestId":decoded.request_id,"method":"desktop_action","ok":true,"result":null})
            }
            Err(_) => {
                json!({"version":contracts::VERSION,"id":decoded.id,"requestId":decoded.request_id,"method":"desktop_action","ok":false,"error":diagnostics::Error::new("transport_unavailable",&decoded.request_id,"host")})
            }
        });
    }
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        handle_assistant_request(
            &app.state::<AssistantBridge>(),
            &app.state::<Arc<applications::Catalogue>>(),
            request,
        )
    })
    .await
    .map_err(|_| diagnostics::Error::new("transport_unavailable", "", "transport"))?
}
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
        .invoke_handler(tauri::generate_handler![assistant_request,])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                let state = app.state::<AssistantBridge>();
                state.transport.shutdown();
            }
        });
}
