// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(feature = "process-tests")]
    if std::env::args().nth(1).as_deref() == Some("--pam-process-test") {
        pam_lib::run_process_test_host();
        return;
    }
    if std::env::args().nth(1).as_deref() == Some("--pam-native") {
        pam_lib::media::run_cli();
        return;
    }
    pam_lib::run()
}
