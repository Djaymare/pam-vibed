//! Real IPC/ACL, isolated WebView2 profile, no tray or personal applications.
fn main() {
    pam_lib::run_permission_test_host();
}
