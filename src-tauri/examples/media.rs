#[path = "../src/media.rs"]
mod media;
fn main() {
    media::run_cli();
}
#[cfg(windows)]
#[path = "../src/windows_resources.rs"]
// This standalone helper uses only MTA; the application uses both constructors.
#[allow(dead_code)]
mod windows_resources;
