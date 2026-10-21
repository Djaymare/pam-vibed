//! Read-only profiling of the fresh catalogue, never launches an application.
#[path = "../src/applications.rs"]
#[allow(dead_code)]
mod applications;
#[path = "../src/windows_resources.rs"]
#[allow(dead_code)]
mod windows_resources;

use serde_json::json;
use std::time::Instant;
use windows::Win32::System::{
    ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS},
    Threading::GetCurrentProcess,
};

fn main() {
    let mode = std::env::args().nth(1).expect("all, status or target");
    assert!(["all", "status", "target"].contains(&mode.as_str()));
    let catalogue = applications::Catalogue::default();
    let mut seed = json!({"config":{"applications":[{"id":"probe","windowsApp":{"appId":"PAM.UnknownApp!Fixture"}}]},"applicationAvailability":{}});
    catalogue.annotate_status(&mut seed);
    let reference = catalogue
        .entries
        .lock()
        .unwrap()
        .clone()
        .expect("native scan");
    assert!(!reference.is_empty());
    let registered: Vec<_> = reference.iter().take(32).enumerate().map(|(i, app)| {
        json!({"id":format!("fixture-{i}"),"windowsApp":{"appId":app.app_id},"arguments":[app.launch_argument]})
    }).collect();
    let mut status = json!({"config":{"applications":registered},"applicationAvailability":{}});
    for i in 0..registered.len() {
        status["applicationAvailability"][format!("fixture-{i}")] = json!({"available":true});
    }
    let mut target = json!({"windowsApp":{"appId":reference[0].app_id}});
    let start = Instant::now();
    match mode.as_str() {
        // Before PAM-39, status and target validation both used this full scan.
        "all" => {
            catalogue.scan().unwrap();
        }
        "status" => catalogue.annotate_status(&mut status),
        "target" => catalogue.prepare_fresh(&mut target).unwrap(),
        _ => unreachable!(),
    }
    let duration_ms = start.elapsed().as_secs_f64() * 1000.0;
    let entries = catalogue.entries.lock().unwrap();
    let entries = entries.as_ref().unwrap();
    assert_eq!(
        entries.len(),
        reference.len(),
        "catalogue changed during benchmark"
    );
    for (a, b) in entries.iter().zip(&reference) {
        assert_eq!(
            (&a.app_id, &a.name, &a.kind, &a.launch_argument),
            (&b.app_id, &b.name, &b.kind, &b.launch_argument)
        );
    }
    if mode == "status" {
        for i in 0..registered.len() {
            assert_eq!(
                status["applicationAvailability"][format!("fixture-{i}")]["available"],
                true
            );
        }
    }
    let mut memory = PROCESS_MEMORY_COUNTERS {
        cb: std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32,
        ..Default::default()
    };
    // SAFETY: the current-process pseudo handle needs no close. The live,
    // initialized output has exactly the size supplied; no pointer is retained.
    unsafe {
        GetProcessMemoryInfo(
            GetCurrentProcess(),
            &mut memory,
            std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32,
        )
    }
    .unwrap();
    println!(
        "{}",
        json!({"mode":mode,"durationMs":duration_ms,"catalogueCount":entries.len(),"registeredCount":registered.len(),"iconCount":entries.iter().filter(|e| e.icon.is_some()).count(),"workingSetBytes":memory.WorkingSetSize,"peakWorkingSetBytes":memory.PeakWorkingSetSize,"metadataUnchanged":true})
    );
}
