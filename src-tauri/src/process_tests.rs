//! Disposable native host. Only compiled with process-tests.
use crate::{applications, bridge, contracts, diagnostics, host::AssistantBridge};
use serde_json::{json, Value};
use std::sync::Arc;
// Feature-gated entrypoint in the compiled Tauri executable. Exercises the
// production bridge and job lifecycle with an isolated profile and fixtures.
#[cfg(feature = "process-tests")]
pub fn run_process_test_host() {
    let args: Vec<_> = std::env::args_os().skip(2).collect();
    assert_eq!(
        args.len(),
        4,
        "node, script, runtime, isolated profile required"
    );
    use std::io::BufRead;
    let catalogue = Arc::new(applications::Catalogue::default());
    let bridge = AssistantBridge {
        transport: bridge::Bridge::new(bridge::Config {
            catalogue: catalogue.clone(),
            node: args[0].clone().into(),
            script: args[1].clone().into(),
            runtime: args[2].clone().into(),
            profile: args[3].clone().into(),
        })
        .expect("process-test bridge"),
        shortcut_error: String::new(),
    };
    let mut serial = 0u64;
    for line in std::io::stdin().lock().lines() {
        let request: Value = serde_json::from_str(&line.unwrap()).unwrap();
        let method = request["method"].as_str().unwrap();
        if method == "quit" {
            break;
        }
        let result = if method == "create_fixture_shortcut" {
            process_test_shortcut(&request["payload"])
        } else if method == "discover_applications" {
            catalogue.scan().map(|entries| json!(entries))
        } else if method == "restart_sidecar" {
            bridge.transport.restart();
            bridge.request("status", json!({}))
        } else {
            serial += 1;
            let wire = if method == "contract_request" {
                request["payload"].clone()
            } else {
                json!({"version":contracts::VERSION,"id":serial,"requestId":diagnostics::request_id(),"method":method,"payload":request["payload"]})
            };
            let result = crate::host::handle_assistant_request(&bridge, &catalogue, wire)
                .map_err(|e| serde_json::to_string(&e).unwrap());
            println!(
                "{}",
                match result {
                    Ok(response) => response,
                    Err(error) => json!({"ok":false,"error":error}),
                }
            );
            continue;
        };
        let response = match result {
            Ok(result) => json!({"ok":true,"result":result}),
            Err(error) => json!({"ok":false,"error":error}),
        };
        println!("{response}");
    }
}

#[cfg(all(windows, feature = "process-tests"))]
fn process_test_shortcut(payload: &Value) -> Result<Value, String> {
    use windows::{
        core::{Interface, PCWSTR},
        Win32::{
            System::Com::{CoCreateInstance, IPersistFile, CLSCTX_INPROC_SERVER},
            UI::Shell::{IShellLinkW, ShellLink},
        },
    };
    let text = |field: &str| -> Result<Vec<u16>, String> {
        let value = payload[field].as_str().ok_or("Fixture field missing")?;
        if value.contains('\0') {
            return Err("Invalid fixture field".into());
        }
        Ok(value.encode_utf16().chain(Some(0)).collect())
    };
    let target = text("target")?;
    let arguments = text("arguments")?;
    let destination = text("destination")?;
    let _apartment = crate::windows_resources::Apartment::sta().map_err(|e| e.to_string())?;
    // SAFETY: this thread owns an STA guard. The COM wrappers release their
    // interfaces before it; each UTF-16 buffer is NUL-terminated, has no interior
    // NUL and stays allocated for the synchronous call that copies it.
    unsafe {
        let result = (|| -> windows::core::Result<()> {
            let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
            link.SetPath(PCWSTR(target.as_ptr()))?;
            link.SetArguments(PCWSTR(arguments.as_ptr()))?;
            let persist: IPersistFile = link.cast()?;
            persist.Save(PCWSTR(destination.as_ptr()), true)?;
            Ok(())
        })();
        result.map_err(|e| e.to_string())?;
    }
    Ok(json!({"created":true}))
}

#[cfg(all(not(windows), feature = "process-tests"))]
fn process_test_shortcut(_: &Value) -> Result<Value, String> {
    Err("Windows required".into())
}
