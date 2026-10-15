//! Stable IPC admission and host dispatch; shared by Tauri and native tests.
use crate::{applications, bridge, contracts, diagnostics};
use serde_json::{json, Value};
pub(crate) struct AssistantBridge {
    pub transport: bridge::Bridge,
    pub shortcut_error: String,
}
impl AssistantBridge {
    pub fn request(&self, method: &str, payload: Value) -> Result<Value, String> {
        if method == "restart_engine" {
            self.transport.restart();
        }
        self.transport
            .request(method, payload)
            .map_err(|error| serde_json::to_string(&error.envelope()).expect("error envelope"))
    }
}

fn catalogue_request(
    transport: &impl bridge::RequestTransport,
    shortcut_error: &str,
    catalogue: &applications::Catalogue,
    method: &str,
    payload: &mut Value,
    request_id: &str,
) -> Result<Value, diagnostics::Error> {
    let request = |method: &str, payload: Value| {
        transport
            .request_correlated(method, payload, request_id)
            .map_err(|e| e.envelope())
    };
    let target_error = |_| diagnostics::Error::new("target_missing", request_id, "target");
    if matches!(method, "save_application" | "test_application") {
        let previous_status = if method == "save_application"
            && payload["enabled"] == false
            && payload["id"].is_string()
        {
            request("status", json!({}))?
        } else {
            Value::Null
        };
        let previous = previous_status["config"]["applications"]
            .as_array()
            .and_then(|a| a.iter().find(|a| a["id"] == payload["id"]));
        catalogue
            .prepare_request(method, payload, previous)
            .map_err(target_error)?;
    } else if method == "set_application_enabled" && payload["enabled"] == true {
        let status = request("status", json!({}))?;
        let original = status["config"]["applications"]
            .as_array()
            .and_then(|a| a.iter().find(|a| a["id"] == payload["id"]))
            .ok_or_else(|| target_error(String::new()))?;
        let mut canonical = original.clone();
        catalogue
            .prepare_fresh(&mut canonical)
            .map_err(target_error)?;
        if canonical["executable"] != original["executable"]
            || canonical["arguments"] != original["arguments"]
        {
            return Err(target_error(String::new()));
        }
    }
    if method == "restart_engine" {
        transport.restart();
    }
    let mut result = request(method, payload.clone())?;
    if method == "status" {
        catalogue.annotate_status(&mut result);
        result["desktop"] = json!({"shortcut":"Ctrl + Maj + Espace","shortcutAvailable":shortcut_error.is_empty(),"shortcutError":shortcut_error,"closeToTray":true});
    }
    Ok(result)
}

// Shared by the Tauri command and the feature-gated native test host, so the
// latter exercises admission validation and the real production response path.
pub(crate) fn handle_assistant_request(
    state: &AssistantBridge,
    catalogue: &applications::Catalogue,
    value: Value,
) -> Result<Value, diagnostics::Error> {
    dispatch(&state.transport, &state.shortcut_error, catalogue, value)
}

fn dispatch(
    transport: &impl bridge::RequestTransport,
    shortcut_error: &str,
    catalogue: &applications::Catalogue,
    value: Value,
) -> Result<Value, diagnostics::Error> {
    let request = contracts::decode(value)?;
    let method = request.call.method().name();
    let id = &request.request_id;
    let result = match method {
        "discover_applications" => catalogue
            .scan()
            .map(|apps| json!(apps))
            .map_err(|_| diagnostics::Error::new("target_missing", id, "target")),
        "export_diagnostics" => transport.export_diagnostics(),
        "diagnostic_event" => {
            let error = diagnostics::Error::new(
                request.call.payload()["code"].as_str().unwrap(),
                id,
                "microphone",
            );
            transport.record_diagnostic(&error, "webview");
            Ok(json!(error))
        }
        _ => catalogue_request(
            transport,
            shortcut_error,
            catalogue,
            method,
            &mut request.call.payload(),
            id,
        ),
    };
    let mut response =
        json!({"version":contracts::VERSION,"id":request.id,"requestId":id,"method":method});
    match result {
        Ok(result) if contracts::valid_result(method, &result) => {
            response["ok"] = json!(true);
            response["result"] = result;
        }
        other => {
            let error = match other {
                Err(e) => diagnostics::Error::new(&e.code, id, &e.stage),
                _ => diagnostics::Error::new("transport_protocol", id, "response"),
            };
            transport.record_diagnostic(&error, "rust");
            response["ok"] = json!(false);
            response["error"] = json!(error);
        }
    }
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    #[derive(Default)]
    struct FakeTransport(Mutex<Vec<String>>);
    impl bridge::RequestTransport for FakeTransport {
        fn request_correlated(
            &self,
            method: &str,
            _: Value,
            id: &str,
        ) -> Result<Value, bridge::Error> {
            self.0.lock().unwrap().push(format!("{method}:{id}"));
            Ok(Value::Null) // deliberately invalid response, checked by dispatch
        }
        fn restart(&self) {
            self.0.lock().unwrap().push("restart".into());
        }
        fn export_diagnostics(&self) -> Result<Value, diagnostics::Error> {
            panic!("unexpected export");
        }
        fn record_diagnostic(&self, error: &diagnostics::Error, _: &str) {
            self.0.lock().unwrap().push(error.code.clone());
        }
    }
    fn wire(method: &str, payload: Value) -> Value {
        json!({"version":contracts::VERSION,"id":1,"requestId":"11111111-1111-4111-8111-111111111111","method":method,"payload":payload})
    }
    #[test]
    fn host_admission_is_isolated_from_process_and_transport_effects() {
        let transport = FakeTransport::default();
        for wire in [
            wire("unknown", json!({})),
            wire("status", json!({"unexpected":true})),
            json!({"version":0}),
        ] {
            assert!(dispatch(&transport, "", &applications::Catalogue::default(), wire).is_err());
        }
        assert!(transport.0.lock().unwrap().is_empty());
    }
    #[test]
    fn host_validates_fake_transport_response_and_keeps_correlation() {
        let transport = FakeTransport::default();
        let response = dispatch(
            &transport,
            "",
            &applications::Catalogue::default(),
            wire("status", json!({})),
        )
        .unwrap();
        assert_eq!(response["ok"], false);
        assert_eq!(response["error"]["code"], "transport_protocol");
        assert_eq!(response["error"]["requestId"], response["requestId"]);
        assert_eq!(
            *transport.0.lock().unwrap(),
            [
                "status:11111111-1111-4111-8111-111111111111",
                "transport_protocol"
            ]
        );
    }
}
