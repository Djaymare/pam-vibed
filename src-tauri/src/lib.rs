use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    time::Duration,
};
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
mod applications;
pub mod media;

#[tauri::command]
async fn discover_applications(
    window: tauri::WebviewWindow,
) -> Result<Vec<applications::InstalledApplication>, String> {
    if window.label() != "main" {
        return Err("Fenêtre non autorisée.".into());
    }
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || app.state::<applications::Catalogue>().scan())
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(windows)]
struct ProcessJob(windows_sys::Win32::Foundation::HANDLE);
#[cfg(windows)]
unsafe impl Send for ProcessJob {}
#[cfg(windows)]
impl Drop for ProcessJob {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0);
        }
    }
}
#[cfg(windows)]
fn supervise(child: &Child) -> Result<ProcessJob, String> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::System::JobObjects::*;
    unsafe {
        let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if handle.is_null() {
            return Err("Impossible de superviser le sidecar.".into());
        }
        let job = ProcessJob(handle);
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if SetInformationJobObject(
            handle,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const _,
            std::mem::size_of_val(&info) as u32,
        ) == 0
            || AssignProcessToJobObject(handle, child.as_raw_handle()) == 0
        {
            return Err("Impossible de superviser le sidecar.".into());
        }
        Ok(job)
    }
}

struct Worker {
    child: Child,
    stdin: ChildStdin,
    replies: mpsc::Receiver<Result<Value, String>>,
    #[cfg(windows)]
    _job: ProcessJob,
}
impl Drop for Worker {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
struct AssistantBridge {
    node: PathBuf,
    script: PathBuf,
    runtime: PathBuf,
    config: PathBuf,
    worker: Arc<Mutex<Option<Worker>>>,
    shortcut_error: String,
    started: AtomicBool,
    stopped: AtomicBool,
}
impl AssistantBridge {
    fn start(&self) -> Result<Worker, String> {
        if !self.node.is_file() || !self.script.is_file() {
            return Err(
                "Le runtime embarqué est absent. Préparez les ressources avant de compiler PAM."
                    .into(),
            );
        }
        std::fs::create_dir_all(&self.config).map_err(|e| e.to_string())?;
        let mut command = Command::new(&self.node);
        command
            .arg(&self.script)
            .arg(&self.runtime)
            .arg(&self.config)
            .env_remove("NODE_OPTIONS")
            .env_remove("NODE_PATH")
            .env("NEEDLE_TELEMETRY", "0")
            .env("DO_NOT_TRACK", "1")
            .env(
                "PAM_NATIVE_EXE",
                std::env::current_exe().map_err(|e| e.to_string())?,
            )
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut child = command
            .spawn()
            .map_err(|e| format!("Impossible de démarrer Node embarqué : {e}"))?;
        #[cfg(windows)]
        let job = match supervise(&child) {
            Ok(job) => job,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
        };
        let stdin = child.stdin.take().ok_or("stdin du sidecar absent.")?;
        let stdout = child.stdout.take().ok_or("stdout du sidecar absent.")?;
        let (sender, replies) = mpsc::channel();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            loop {
                let mut line = String::new();
                let read = reader.by_ref().take(2_000_001).read_line(&mut line);
                let reply = match read {
                    Ok(0) => break,
                    Ok(_) if line.len() <= 2_000_000 && line.ends_with('\n') => {
                        serde_json::from_str(&line)
                            .map_err(|_| "Réponse du sidecar invalide.".into())
                    }
                    _ => Err("Lecture du sidecar interrompue ou réponse trop volumineuse.".into()),
                };
                let failed = reply.is_err();
                if sender.send(reply).is_err() || failed {
                    break;
                }
            }
        });
        Ok(Worker {
            child,
            stdin,
            replies,
            #[cfg(windows)]
            _job: job,
        })
    }
    fn request(&self, method: &str, payload: Value) -> Result<Value, String> {
        let mut slot = self
            .worker
            .lock()
            .map_err(|_| "Le bridge est indisponible.")?;
        // Serialize configuration, inference and approvals over one persistent pipe.
        if slot
            .as_mut()
            .map(|w| w.child.try_wait().ok().flatten().is_some())
            .unwrap_or(false)
        {
            *slot = None;
        }
        if slot.is_none() {
            *slot = Some(self.start()?);
            self.started.store(true, Ordering::Relaxed);
        }
        let mut bytes =
            serde_json::to_vec(&json!({ "id": 1, "method": method, "payload": payload }))
                .map_err(|e| e.to_string())?;
        if bytes.len() > 5_000_000 {
            return Err("Demande trop volumineuse.".into());
        }
        bytes.push(b'\n');
        let worker = slot.as_mut().unwrap();
        let reply = worker.stdin.write_all(&bytes).map_err(|_| "Communication avec le sidecar interrompue.".to_string())
            .and_then(|_| worker.replies.recv_timeout(Duration::from_secs(50)).map_err(|_| "Le moteur local s’est arrêté ou a dépassé le délai prévu. Réessayez ; il sera redémarré automatiquement.".to_string()))
            .and_then(|r| r);
        match reply {
            Ok(response) if response["id"] == 1 => {
                if response["ok"] == true {
                    Ok(response["result"].clone())
                } else {
                    Err(response["error"]
                        .as_str()
                        .unwrap_or("Erreur inconnue du sidecar.")
                        .into())
                }
            }
            _ => {
                *slot = None;
                Err("Le moteur local a été interrompu. Réessayez ; il sera redémarré automatiquement.".into())
            }
        }
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
fn toggle_voice(app: &tauri::AppHandle) {
    show(app);
    let _ = app.emit_to("main", "pam-toggle-voice", ());
}

#[tauri::command]
async fn assistant_request(
    window: tauri::WebviewWindow,
    method: String,
    payload: Option<Value>,
) -> Result<Value, String> {
    if window.label() != "main" {
        return Err("Fenêtre non autorisée.".into());
    }
    if !matches!(
        method.as_str(),
        "status"
            | "save_application"
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
        return Err("Méthode inconnue.".into());
    }
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AssistantBridge>();
        let mut payload = payload.unwrap_or(json!({}));
        if matches!(method.as_str(), "save_application" | "test_application") {
            app.state::<applications::Catalogue>().prepare(&mut payload)?;
        }
        let mut result = state.request(&method, payload)?;
        if method == "status" { result["desktop"] = json!({ "shortcut": "Ctrl + Maj + Espace", "shortcutAvailable": state.shortcut_error.is_empty(), "shortcutError": state.shortcut_error, "closeToTray": true }); }
        Ok(result)
    }).await.map_err(|e| e.to_string())?
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
        .manage(applications::Catalogue::default())
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
                node,
                script,
                runtime: runtime_path(&resources, "runtime"),
                config,
                worker: Arc::new(Mutex::new(None)),
                shortcut_error,
                started: AtomicBool::new(false),
                stopped: AtomicBool::new(false),
            });
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(15));
                let state = handle.state::<AssistantBridge>();
                if state.stopped.load(Ordering::Relaxed) {
                    break;
                }
                let check = if let Ok(_slot) = state.worker.try_lock() {
                    state.started.load(Ordering::Relaxed)
                } else {
                    false
                };
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
                state.stopped.store(true, Ordering::Relaxed);
                if let Ok(mut slot) = state.worker.try_lock() {
                    *slot = None;
                };
            }
        });
}
