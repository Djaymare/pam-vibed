//! Real Windows registration conflicts and persistence using only a disposable
//! preference directory. No assistant sidecar or personal application is used.
#[path = "../src/shortcuts.rs"]
mod shortcuts;
use shortcuts::{NativeRegistrar, Registrar, VoiceShortcut};
#[link(name = "user32")]
unsafe extern "system" {
    fn RegisterHotKey(window: *mut std::ffi::c_void, id: i32, modifiers: u32, key: u32) -> i32;
    fn UnregisterHotKey(window: *mut std::ffi::c_void, id: i32) -> i32;
}
fn main() {
    let directory = std::path::PathBuf::from(
        std::env::var_os("PAM_SHORTCUT_TEST_PROFILE").expect("disposable profile"),
    );
    assert!(directory.is_absolute());
    std::fs::create_dir_all(&directory).unwrap();
    let profile = directory.join("config.json");
    std::fs::write(&profile, b"unchanged test profile").unwrap();
    let (ready_tx, ready_rx) = std::sync::mpsc::channel();
    let (stop_tx, stop_rx) = std::sync::mpsc::channel();
    let holder = std::thread::spawn(move || {
        // SAFETY: null HWND creates a thread-owned hotkey with a constant ID.
        // Registration and release occur on this same live thread; no pointers
        // cross the FFI and no keyboard input is synthesized.
        let registered = unsafe { RegisterHotKey(std::ptr::null_mut(), 0x7026, 0x4006, 0x20) } != 0;
        ready_tx.send(registered).unwrap();
        if registered {
            let _ = stop_rx.recv();
            // SAFETY: releases only this thread's successfully registered ID.
            unsafe {
                UnregisterHotKey(std::ptr::null_mut(), 0x7026);
            }
        }
    });
    assert!(
        ready_rx.recv().unwrap(),
        "Test holder must own the default hotkey"
    );
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(move |app| {
            let app = app.handle().clone();
            std::thread::spawn(move || {
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    let registrar = NativeRegistrar(&app);
                    let mut preference = VoiceShortcut::load(&directory, &registrar);
                    assert!(!preference.available, "Windows must reject the occupied default");
                    assert!(preference.snapshot()["error"].as_str().unwrap().contains("occupé"));
                    preference.change("ctrl_alt_space", &registrar);
                    assert!(preference.available && preference.id == "ctrl_alt_space", "Alternative registered");
                    preference.change("ctrl_shift_space", &registrar);
                    assert!(preference.available && preference.id == "ctrl_alt_space", "Failed replacement retains the active alternative");
                    assert_eq!(std::fs::read(&profile).unwrap(), b"unchanged test profile");
                    registrar.unregister("ctrl_alt_space").unwrap();
                    let loaded = VoiceShortcut::load(&directory, &registrar);
                    assert!(loaded.available && loaded.id == "ctrl_alt_space", "Persisted choice registered after restart");
                    registrar.unregister("ctrl_alt_space").unwrap();
                    println!("PASS Windows occupied shortcut; alternative; failed replacement; unchanged profile; persisted reload");
                }));
                let _ = stop_tx.send(()); let _ = holder.join();
                app.exit(if result.is_ok() { 0 } else { 1 });
            });
            Ok(())
        })
        .run(context)
        .expect("shortcut test host");
}
