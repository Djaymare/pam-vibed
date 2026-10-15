//! Runtime validation against the same descriptor used by Node and Vue.
use serde_json::{json, Value};
use std::sync::OnceLock;
#[allow(dead_code)]
#[rustfmt::skip]
#[path = "contracts_generated.rs"]
pub mod generated;
pub use generated::{Request, VERSION};
fn contract() -> &'static Value {
    static CONTRACT: OnceLock<Value> = OnceLock::new();
    CONTRACT.get_or_init(|| {
        serde_json::from_str(include_str!("../../sidecar/contracts.json"))
            .expect("contract descriptor")
    })
}
pub fn matches(value: &Value, schema: &Value, definitions: &Value) -> bool {
    if let Some(name) = schema.as_str() {
        return match name {
            "string" => value.is_string(),
            "boolean" => value.is_boolean(),
            "number" => value.is_number(),
            "integer" => value.as_u64().is_some_and(|n| n <= 9_007_199_254_740_991),
            "byte" => value.as_u64().is_some_and(|n| n <= 255),
            _ => definitions
                .get(name)
                .is_some_and(|s| matches(value, s, definitions)),
        };
    }
    if let Some(literal) = schema.get("literal") {
        return value == literal;
    }
    if let Some(values) = schema["enum"].as_array() {
        return values.contains(value);
    }
    if let Some(inner) = schema.get("nullable") {
        return value.is_null() || matches(value, inner, definitions);
    }
    if let Some(inner) = schema.get("array") {
        return value.as_array().is_some_and(|a| {
            a.len() as u64 <= schema["max"].as_u64().unwrap_or(0)
                && a.iter().all(|v| matches(v, inner, definitions))
        });
    }
    let Some(object) = value.as_object() else {
        return false;
    };
    if let Some(inner) = schema.get("record") {
        return object.values().all(|v| matches(v, inner, definitions));
    }
    let Some(properties) = schema["properties"].as_object() else {
        return false;
    };
    if schema["extra"] != true
        && object.keys().any(|key| {
            !properties.contains_key(key) && !properties.contains_key(&format!("{key}?"))
        })
    {
        return false;
    }
    properties.iter().all(|(key, s)| {
        let name = key.strip_suffix('?').unwrap_or(key);
        object
            .get(name)
            .map_or(key.ends_with('?'), |v| matches(v, s, definitions))
    })
}
pub fn valid_type(value: &Value, name: &str) -> bool {
    let c = contract();
    matches(value, &json!(name), &c["definitions"])
}
pub fn valid_payload(method: &str, payload: &Value) -> bool {
    let c = contract();
    c["methods"]
        .get(method)
        .is_some_and(|s| matches(payload, &s[0], &c["definitions"]))
}
pub fn valid_result(method: &str, result: &Value) -> bool {
    let c = contract();
    c["methods"]
        .get(method)
        .is_some_and(|s| matches(result, &s[1], &c["definitions"]))
        && serde_json::from_value::<generated::MethodResult>(
            json!({"method":method,"result":result}),
        )
        .is_ok()
}
pub fn valid_host_payload(method: &str, payload: &Value) -> bool {
    let c = contract();
    c["hostMethods"]
        .get(method)
        .is_some_and(|s| matches(payload, s, &c["definitions"]))
}
pub fn valid_reference(id: &str) -> bool {
    let parts: Vec<_> = id.split('-').collect();
    (parts.len() == 4
        && parts[0] == "pam"
        && parts[1..].iter().enumerate().all(|(index, p)| {
            !p.is_empty()
                && p.len() <= if index == 1 { 10 } else { 20 }
                && p.bytes().all(|b| b.is_ascii_digit())
        }))
        || (parts.iter().map(|p| p.len()).collect::<Vec<_>>() == [8, 4, 4, 4, 12]
            && id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-'))
}
pub fn decode(value: Value) -> Result<Request, crate::diagnostics::Error> {
    if value.as_object().is_none_or(|v| {
        v.keys().any(|k| {
            !matches!(
                k.as_str(),
                "version" | "id" | "requestId" | "method" | "payload"
            )
        })
    }) || !valid_payload(value["method"].as_str().unwrap_or(""), &value["payload"])
    {
        return Err(crate::diagnostics::Error::new(
            "invalid_request",
            value["requestId"].as_str().unwrap_or(""),
            "validation",
        ));
    }
    let id = value["requestId"].as_str().unwrap_or("").to_owned();
    let request: Request = serde_json::from_value(value)
        .map_err(|_| crate::diagnostics::Error::new("invalid_request", &id, "validation"))?;
    if request.version != VERSION
        || request.id == 0
        || request.id > 9_007_199_254_740_991
        || !valid_payload(request.call.method().name(), &request.call.payload())
        || !valid_reference(&request.request_id)
    {
        return Err(crate::diagnostics::Error::new(
            "invalid_request",
            &id,
            "validation",
        ));
    }
    Ok(request)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shared_fixtures_conform_in_rust() {
        assert_eq!(generated::CONTRACT_SHA256.len(), 64);
        let fixtures: Value =
            serde_json::from_str(include_str!("../../tests/fixtures/contracts.json")).unwrap();
        for fixture in fixtures.as_array().unwrap() {
            let accepted = if fixture.get("request").is_some() {
                decode(fixture["request"].clone()).is_ok()
            } else {
                valid_type(&fixture["value"], fixture["type"].as_str().unwrap())
            };
            assert_eq!(
                accepted,
                fixture["valid"].as_bool().unwrap(),
                "{}",
                fixture["name"]
            );
            if accepted && fixture["type"] == "Turn" {
                assert!(
                    serde_json::from_value::<generated::Turn>(fixture["value"].clone()).is_ok()
                );
            }
            if accepted && fixture["type"] == "PamError" {
                assert!(
                    serde_json::from_value::<generated::PamError>(fixture["value"].clone()).is_ok()
                );
            }
        }
        for code in contract()["definitions"]["PamError"]["properties"]["code"]["enum"]
            .as_array()
            .unwrap()
        {
            let error = crate::diagnostics::Error::new(
                code.as_str().unwrap(),
                "11111111-1111-4111-8111-111111111111",
                "response",
            );
            assert!(valid_type(&json!(error), "PamError"));
        }
    }
}
