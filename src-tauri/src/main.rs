// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().nth(1).as_deref() == Some("--pam-native") {
        pam_lib::media::run_cli();
        return;
    }
    pam_lib::run()
}
