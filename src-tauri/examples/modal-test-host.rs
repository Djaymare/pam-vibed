//! Disposable WebView2 host for the frontend regression suite. No PAM sidecar,
//! tray, shortcut, personal profile or application launch is initialized.
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
            .build()?;
            Ok(())
        })
        .run(context)
        .expect("WebView2 test host");
}
