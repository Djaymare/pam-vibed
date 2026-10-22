fn main() {
    println!("cargo:rerun-if-env-changed=PAM_BUILD_IDENTITY");
    let identity = match std::env::var("PAM_BUILD_IDENTITY") {
        Ok(path) => {
            println!("cargo:rerun-if-changed={path}");
            std::fs::read_to_string(path).expect("PAM build identity must be readable")
        }
        Err(_) => "null".to_string(),
    };
    let output = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
    std::fs::write(
        output.join("pam-build-identity.rs"),
        format!(
            "pub const BUILD_INFO: &str = {:?};",
            format!("PAM_BUILD_INFO:{identity}:END_PAM_BUILD_INFO")
        ),
    )
    .unwrap();
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["assistant_request"])),
    )
    .expect("Tauri permissions and resources must be valid")
}
