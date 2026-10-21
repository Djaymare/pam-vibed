//! Controlled snapshots exercise catalogue decisions without enumerating apps.
use super::*;
use serde_json::json;
use std::collections::VecDeque;

type Snapshot = Result<Vec<InstalledApplication>, String>;
struct Source(Mutex<VecDeque<Snapshot>>);
impl CatalogueSource for Source {
    fn discover(&self, icons: IconScope<'_>) -> Snapshot {
        self.0
            .lock()
            .unwrap()
            .pop_front()
            .expect("unexpected scan")
            .map(|entries| {
                entries
                    .into_iter()
                    .map(|mut entry| {
                        if !icons.includes(&entry.app_id) {
                            entry.icon = None;
                        }
                        entry
                    })
                    .collect()
            })
    }
}
fn catalogue(snapshots: Vec<Snapshot>) -> Catalogue {
    Catalogue {
        entries: Mutex::new(None),
        source: Arc::new(Source(Mutex::new(snapshots.into()))),
    }
}
fn entry(id: &str) -> InstalledApplication {
    InstalledApplication {
        app_id: id.into(),
        name: "Same display name".into(),
        kind: "desktop".into(),
        icon: None,
        launch_argument: format!("shell:AppsFolder\\{id}"),
    }
}
fn payload(id: &str) -> Value {
    json!({"windowsApp":{"appId":id,"kind":"forged","launchArgument":"forged"},"executable":"forged","arguments":["forged"]})
}
#[test]
fn empty_and_inaccessible_catalogues_fail_without_changing_target() {
    for snapshot in [Ok(vec![]), Err("injected access denied".into())] {
        let catalogue = catalogue(vec![snapshot]);
        let mut draft = payload("fixture");
        let original = draft.clone();
        assert!(catalogue.prepare_fresh(&mut draft).is_err());
        assert_eq!(draft, original);
    }
}
#[test]
fn duplicate_names_use_exact_ids_and_cannot_authorize_a_name_or_forged_target() {
    let catalogue = catalogue(vec![Ok(vec![entry("first"), entry("second")])]);
    catalogue.scan().unwrap();
    for id in ["first", "second"] {
        let mut draft = payload(id);
        catalogue.prepare(&mut draft).unwrap();
        assert_eq!(
            draft["arguments"],
            json!([format!("shell:AppsFolder\\{id}")])
        );
        assert_eq!(draft["windowsApp"]["kind"], "desktop");
        assert_eq!(draft["executable"], explorer().unwrap());
    }
    assert!(catalogue
        .prepare(&mut payload("Same display name"))
        .is_err());
    assert!(catalogue.prepare(&mut payload("FIRST")).is_err());
}
#[test]
fn fresh_target_checks_never_fall_back_to_stale_cache_after_removal_or_denial() {
    let catalogue = catalogue(vec![
        Ok(vec![entry("old")]),
        Ok(vec![entry("new")]),
        Err("injected access denied".into()),
        Ok(vec![]),
    ]);
    let mut old = payload("old");
    catalogue.prepare(&mut old).unwrap();
    assert!(catalogue.prepare_fresh(&mut payload("old")).is_err());
    let mut new = payload("new");
    catalogue.prepare(&mut new).unwrap();
    assert!(catalogue
        .prepare_fresh(&mut payload("new"))
        .unwrap_err()
        .contains("access denied"));
    assert!(catalogue.prepare_fresh(&mut payload("new")).is_err());
    assert!(catalogue
        .entries
        .lock()
        .unwrap()
        .as_ref()
        .unwrap()
        .is_empty());
}
#[test]
fn inaccessible_refresh_marks_status_unavailable_even_with_a_cached_entry() {
    let catalogue = catalogue(vec![
        Ok(vec![entry("fixture")]),
        Err("injected access denied".into()),
    ]);
    catalogue.scan().unwrap();
    let mut status = json!({"config":{"applications":[{"id":"registered","windowsApp":{"appId":"fixture"},"arguments":["shell:AppsFolder\\fixture"]}]},"applicationAvailability":{"registered":{"available":true}}});
    catalogue.annotate_status(&mut status);
    assert_eq!(
        status["applicationAvailability"]["registered"]["available"],
        false
    );
    assert_eq!(
        status["applicationAvailability"]["registered"]["reason"],
        "injected access denied"
    );
}

#[test]
fn loaded_catalogue_only_requests_pixels_for_picker_or_exact_selected_id() {
    let image = "data:image/png;base64,iVBORw0KGgo=".to_owned();
    let entries: Vec<_> = (0..512)
        .map(|i| {
            let mut e = entry(&format!("fixture-{i}"));
            e.icon = Some(image.clone());
            e
        })
        .collect();
    let catalogue = catalogue(vec![Ok(entries.clone()), Ok(entries.clone()), Ok(entries)]);
    assert_eq!(
        catalogue
            .scan()
            .unwrap()
            .iter()
            .filter(|e| e.icon.is_some())
            .count(),
        512
    );
    let registered: Vec<_> = (0..32).map(|i| json!({"id":format!("registered-{i}"),"windowsApp":{"appId":format!("fixture-{i}")},"arguments":[format!("shell:AppsFolder\\fixture-{i}")]})).collect();
    let mut status = json!({"config":{"applications":registered},"applicationAvailability":{}});
    for i in 0..32 {
        status["applicationAvailability"][format!("registered-{i}")] = json!({"available":true});
    }
    catalogue.annotate_status(&mut status);
    assert!(catalogue
        .entries
        .lock()
        .unwrap()
        .as_ref()
        .unwrap()
        .iter()
        .all(|e| e.icon.is_none()));
    for i in 0..32 {
        assert_eq!(
            status["applicationAvailability"][format!("registered-{i}")]["available"],
            true
        );
    }
    let mut draft = payload("fixture-31");
    draft["windowsApp"]["icon"] = json!("forged");
    catalogue.prepare_fresh(&mut draft).unwrap();
    assert_eq!(draft["windowsApp"]["icon"], image);
    assert_eq!(draft["arguments"], json!(["shell:AppsFolder\\fixture-31"]));
    let cache = catalogue.entries.lock().unwrap();
    let icons: Vec<_> = cache
        .as_ref()
        .unwrap()
        .iter()
        .filter(|e| e.icon.is_some())
        .map(|e| e.app_id.as_str())
        .collect();
    assert_eq!(icons, ["fixture-31"]);
}

#[test]
fn invalid_target_is_rejected_before_scan_and_missing_target_keeps_original_payload() {
    let invalid = catalogue(vec![]);
    let mut draft = json!({"windowsApp":{"appId":123,"icon":"forged"},"executable":"forged"});
    let original = draft.clone();
    assert!(invalid
        .prepare_fresh(&mut draft)
        .unwrap_err()
        .contains("invalide"));
    assert_eq!(draft, original);
    let missing = catalogue(vec![Ok(vec![entry("other")])]);
    let mut draft = payload("fixture");
    let original = draft.clone();
    assert!(missing.prepare_fresh(&mut draft).is_err());
    assert_eq!(draft, original);
}
