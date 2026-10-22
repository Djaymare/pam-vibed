//! Native authorization fixture. Only compiled with process-tests. The production
//! handler, AppManifest, capabilities and CSP are used without widening grants.
use crate::{applications, bridge, host::AssistantBridge, shortcuts};
use std::{path::PathBuf, sync::Arc};
use tauri::{Emitter, Manager};

struct NoShortcut;
impl shortcuts::Registrar for NoShortcut {
    fn register(&self, _: &str) -> Result<(), String> {
        Ok(())
    }
    fn unregister(&self, _: &str) -> Result<(), String> {
        Ok(())
    }
}

pub fn run_permission_test_host() {
    let profile =
        PathBuf::from(std::env::var_os("PAM_PERMISSION_TEST_PROFILE").expect("disposable profile"));
    let remote: tauri::Url = std::env::var("PAM_PERMISSION_TEST_REMOTE")
        .expect("fixture origin")
        .parse()
        .unwrap();
    assert_eq!(remote.host_str(), Some("127.0.0.1"));
    assert_eq!(remote.scheme(), "http");
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    let handler = crate::ipc_handler();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(move |invoke| {
            // Intentionally registered without a permission. Removing the app
            // manifest would make this reachable from local untrusted windows.
            if invoke.message.command() == "permission_canary" {
                invoke.resolver.resolve("UNAUTHORIZED_CANARY_DISPATCH");
                true
            } else {
                handler(invoke)
            }
        })
        .setup(move |app| {
            let catalogue = Arc::new(applications::Catalogue::default());
            app.manage(catalogue.clone());
            app.manage(std::sync::Mutex::new(shortcuts::VoiceShortcut::load(
                &profile,
                &NoShortcut,
            )));
            app.manage(AssistantBridge {
                transport: bridge::Bridge::new(bridge::Config {
                    catalogue,
                    node: profile.join("no-node.exe"),
                    script: profile.join("no-sidecar.cjs"),
                    runtime: profile.join("no-runtime"),
                    profile: profile.join("assistant"),
                })?,
            });
            for label in ["main", "untrusted"] {
                tauri::WebviewWindowBuilder::new(
                    app,
                    label,
                    tauri::WebviewUrl::App("__permission_test".into()),
                )
                .title(format!("PAM authorization fixture {label}"))
                .visible(false)
                .use_https_scheme(true)
                .data_directory(profile.join("webview"))
                .on_web_resource_request(|request, response| {
                    if request.uri().path() == "/__permission_test" {
                        *response.status_mut() = tauri::http::StatusCode::OK;
                        response.headers_mut().insert(
                            tauri::http::header::CONTENT_TYPE,
                            "text/html; charset=utf-8".parse().unwrap(),
                        );
                        *response.body_mut() =
                            b"<!doctype html><title>PAM authorization fixture</title>"
                                .to_vec()
                                .into();
                    }
                })
                .build()?;
            }
            tauri::WebviewWindowBuilder::new(app, "remote", tauri::WebviewUrl::External(remote))
                .title("PAM authorization fixture remote")
                .visible(false)
                .data_directory(profile.join("webview"))
                .build()?;
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                for _ in 0..600 {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    let _ = app_handle.emit_to("main", "pam-toggle-voice", ());
                }
            });
            Ok(())
        })
        .build(context)
        .expect("permission fixture")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                app.state::<AssistantBridge>().transport.shutdown();
            }
        });
}
