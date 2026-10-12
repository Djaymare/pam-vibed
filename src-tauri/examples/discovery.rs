// Read-only native smoke test, runnable on Windows after cargo-xwin compilation.
#[path = "../src/applications.rs"]
mod applications;
fn main() {
    let catalogue = applications::Catalogue::default();
    match catalogue.scan() {
        Ok(applications) => {
            for entry in &applications {
                let mut draft = serde_json::json!({ "executable": "invented.exe", "arguments": ["invented"],
                    "windowsApp": { "appId": entry.app_id, "kind": "invented", "icon": "invented" } });
                catalogue.prepare(&mut draft).unwrap();
                assert_eq!(
                    draft["arguments"],
                    serde_json::json!([entry.launch_argument])
                );
                assert_eq!(draft["windowsApp"]["kind"], entry.kind);
                assert_eq!(draft["windowsApp"]["icon"], serde_json::json!(entry.icon));
                assert!(draft["executable"]
                    .as_str()
                    .unwrap()
                    .to_lowercase()
                    .ends_with("\\explorer.exe"));
            }
            assert!(catalogue
                .prepare_request(
                    "test_application",
                    &mut serde_json::json!({"windowsApp": {"appId": "PAM.UnknownApp!Fixture"}}),
                    None
                )
                .is_err());
            let mut status = serde_json::json!({"config":{"applications":[{"id":"absent","windowsApp":{"appId":"PAM.UnknownApp!Fixture"}}]},"applicationAvailability":{"absent":{"available":true}}});
            catalogue.annotate_status(&mut status);
            assert_eq!(
                status["applicationAvailability"]["absent"]["available"],
                false
            );
            println!("{}", serde_json::to_string(&applications).unwrap());
        }
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}
