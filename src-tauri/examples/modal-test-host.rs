//! Disposable WebView2 host for the frontend regression suite. No PAM sidecar,
//! tray, shortcut, personal profile or application launch is initialized.
fn set_test_viewport(window: tauri::WebviewWindow, mode: &str) -> Result<(), String> {
    let (width, height, zoom) = match mode {
        "normal" => (1180.0, 820.0, 1.0),
        "minimum" => (780.0, 620.0, 1.0),
        "zoom200" => (780.0, 620.0, 2.0),
        _ => return Err("Unknown test viewport".into()),
    };
    window
        .set_size(tauri::LogicalSize::new(width, height))
        .map_err(|error| error.to_string())?;
    window.set_zoom(zoom).map_err(|error| error.to_string())
}

fn main() {
    let url = std::env::var("PAM_MODAL_TEST_URL").expect("test URL");
    let profile = std::env::var("PAM_MODAL_TEST_PROFILE").expect("disposable profile");
    assert!(url.starts_with("http://127.0.0.1:"));
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().app.security.csp = None;
    context.config_mut().app.security.dev_csp = None;
    tauri::Builder::default()
        .setup(move |app| {
            tauri::WebviewWindowBuilder::new(
                app,
                "modal-test",
                tauri::WebviewUrl::External(url.parse()?),
            )
            .title("PAM disposable modal test")
            .inner_size(1180.0, 820.0)
            .data_directory(std::path::PathBuf::from(&profile))
            .on_page_load(|window, payload| {
                // Dimensions and zoom belong to this disposable host. No IPC
                // command or permission is added to the production application.
                if let Some((_, mode)) = payload
                    .url()
                    .query_pairs()
                    .find(|(key, _)| key == "viewport")
                {
                    set_test_viewport(window, &mode).expect("test viewport");
                }
            })
            .build()?;
            Ok(())
        })
        .run(context)
        .expect("WebView2 test host");
}
