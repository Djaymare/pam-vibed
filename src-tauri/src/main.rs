// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().nth(1).as_deref() == Some("--pam-build-info") {
        include_build_info::print();
        return;
    }
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

mod include_build_info {
    include!(concat!(env!("OUT_DIR"), "/pam-build-identity.rs"));
    pub fn print() {
        println!(
            "{}",
            std::hint::black_box(BUILD_INFO)
                .strip_prefix("PAM_BUILD_INFO:")
                .unwrap()
                .strip_suffix(":END_PAM_BUILD_INFO")
                .unwrap()
        );
    }
}
