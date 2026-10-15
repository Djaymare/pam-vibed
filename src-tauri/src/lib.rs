#![deny(unsafe_op_in_unsafe_fn, clippy::undocumented_unsafe_blocks)]
use host::AssistantBridge;
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::ShortcutState;
mod applications;
mod bridge;
mod contracts;
mod desktop;
mod diagnostics;
mod host;
#[cfg(windows)]
mod job;
mod launch;
pub mod media;
#[cfg(feature = "process-tests")]
mod process_tests;
mod supervision;
#[cfg(windows)]
mod windows_resources;
#[cfg(feature = "process-tests")]
pub use process_tests::run_process_test_host;

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
        let result = desktop::action(
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
        host::handle_assistant_request(
            &app.state::<AssistantBridge>(),
            &app.state::<Arc<applications::Catalogue>>(),
            request,
        )
    })
    .await
    .map_err(|_| diagnostics::Error::new("transport_unavailable", "", "transport"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Arc::new(applications::Catalogue::default()))
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            desktop::show(app)
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _, event| {
                    if event.state() == ShortcutState::Pressed {
                        desktop::toggle_voice(app);
                    }
                })
                .build(),
        )
        .setup(desktop::setup)
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
