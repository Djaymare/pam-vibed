use super::*;
use std::fs;

static FIXTURE_ID: AtomicU64 = AtomicU64::new(1);
#[test]
fn supervisor_snapshot_detects_retired_child_before_the_next_probe() {
    let fixture = Fixture::new("echo", Duration::from_secs(3), 4);
    fixture.bridge.request("status", json!({})).unwrap();
    assert_eq!(fixture.bridge.supervisor_status()["phase"], "ready");
    fixture.bridge.control.interrupt();
    assert_eq!(fixture.bridge.supervisor_status()["phase"], "recovering");
    fixture.bridge.request("status", json!({})).unwrap();
    assert_eq!(fixture.bridge.supervisor_status()["phase"], "ready");
}
#[test]
fn supervisor_snapshot_is_nonblocking_during_start_recovery_and_stop() {
    let fixture = Fixture::new("silent", Duration::from_secs(2), 4);
    assert_eq!(fixture.bridge.supervisor_status()["phase"], "starting");
    let bridge = fixture.bridge.clone();
    let request = thread::spawn(move || bridge.request("status", json!({})));
    fixture.ready();
    let start = Instant::now();
    let snapshot = fixture.bridge.supervisor_status();
    assert!(start.elapsed() < Duration::from_millis(200));
    assert_eq!(snapshot["phase"], "starting");
    assert!(request.join().unwrap().is_err());
    fixture.wait_for(|| fixture.bridge.supervisor_status()["phase"] == "recovering");
    fixture.bridge.shutdown();
    assert_eq!(fixture.bridge.supervisor_status()["phase"], "stopped");
}
struct Fixture {
    bridge: Arc<Bridge>,
    profile: PathBuf,
    runtime: PathBuf,
}
impl Fixture {
    fn new(mode: &str, timeout: Duration, capacity: usize) -> Self {
        Self::create(mode, timeout, capacity, false)
    }
    fn create(mode: &str, timeout: Duration, capacity: usize, real_runtime: bool) -> Self {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let profile = std::env::temp_dir().join(format!(
            "pam-bridge-{}-{}",
            std::process::id(),
            FIXTURE_ID.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&profile).unwrap();
        fs::write(profile.join("mode"), mode).unwrap();
        let runtime = if real_runtime {
            root.join("runtime")
        } else {
            profile.join("runtime-not-installed")
        };
        let bridge = Bridge::with_limits(
            Config {
                node: root.join("binaries/pam-node-x86_64-pc-windows-msvc.exe"),
                script: root.join("../tests/fixtures/bridge-sidecar.cjs"),
                runtime: runtime.clone(),
                profile: profile.clone(),
                catalogue: Arc::new(Catalogue::default()),
            },
            timeout,
            capacity,
        )
        .unwrap();
        Self {
            bridge: Arc::new(bridge),
            profile,
            runtime,
        }
    }
    fn wait_for(&self, check: impl Fn() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while !check() {
            assert!(
                Instant::now() < deadline,
                "fixture did not reach expected stage"
            );
            thread::sleep(Duration::from_millis(5));
        }
    }
    fn ready(&self) {
        self.wait_for(|| self.profile.join("started.json").exists());
    }
    fn at_stage(&self, stage: u8) {
        self.wait_for(|| {
            self.bridge
                .control
                .state
                .lock()
                .unwrap()
                .active
                .as_ref()
                .is_some_and(|attempt| attempt.stage.load(Ordering::Acquire) == stage)
        });
    }
    fn mode(&self, mode: &str) {
        fs::write(self.profile.join("mode"), mode).unwrap();
        self.wait_for(|| {
            self.bridge
                .control
                .state
                .lock()
                .unwrap()
                .lifecycle
                .retry_at
                .is_none_or(|at| Instant::now() >= at)
        });
    }
    fn assert_dead(&self, pid: u64) {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        self.wait_for(|| {
            !Command::new(root.join("binaries/pam-node-x86_64-pc-windows-msvc.exe"))
                .args([
                    "-e",
                    "try { process.kill(Number(process.argv[1]), 0); } catch { process.exit(1); }",
                    &pid.to_string(),
                ])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .unwrap()
                .success()
        });
    }
    fn executions(&self) -> Vec<String> {
        fs::read_to_string(self.profile.join("executions"))
            .unwrap_or_default()
            .lines()
            .map(str::to_owned)
            .collect()
    }
}

struct ManualClock(Mutex<Instant>);
impl Clock for ManualClock {
    fn now(&self) -> Instant {
        *self.0.lock().unwrap()
    }
}
impl ManualClock {
    fn advance(&self, seconds: u64) {
        *self.0.lock().unwrap() += Duration::from_secs(seconds);
    }
}
fn controlled_bridge(
    fixture: &Fixture,
    clock: Arc<ManualClock>,
    factory: Arc<dyn ProcessFactory>,
) -> Bridge {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    Bridge::with_services(
        Config {
            node: root.join("binaries/pam-node-x86_64-pc-windows-msvc.exe"),
            script: root.join("../tests/fixtures/bridge-sidecar.cjs"),
            runtime: fixture.runtime.clone(),
            profile: fixture.profile.clone(),
            catalogue: Arc::new(Catalogue::default()),
        },
        Duration::from_secs(5),
        4,
        clock,
        factory,
    )
    .unwrap()
}

#[test]
fn persistent_spawn_failures_use_controlled_backoff_and_stop_permanently() {
    struct Failed(AtomicUsize);
    impl ProcessFactory for Failed {
        fn spawn(&self, _: &mut Command) -> std::io::Result<std::process::Child> {
            self.0.fetch_add(1, Ordering::Relaxed);
            Err(std::io::Error::other("injected startup fault"))
        }
    }
    let fixture = Fixture::new("echo", Duration::from_secs(5), 4);
    let clock = Arc::new(ManualClock(Mutex::new(Instant::now())));
    let factory = Arc::new(Failed(AtomicUsize::new(0)));
    let bridge = controlled_bridge(&fixture, clock.clone(), factory.clone());
    assert_eq!(
        bridge.request("status", json!({})).unwrap_err().code,
        "bridge_start"
    );
    for (index, delay) in [1, 2, 4, 8, 16, 32, 60, 60].into_iter().enumerate() {
        fixture.wait_for(|| bridge.control.pending.load(Ordering::Acquire) == 0);
        for _ in 0..8 {
            assert_eq!(
                bridge
                    .request("process_text", json!({"text":"must not execute"}))
                    .unwrap_err()
                    .code,
                "bridge_backoff"
            );
        }
        assert_eq!(factory.0.load(Ordering::Relaxed), index + 1);
        clock.advance(delay);
        fixture.wait_for(|| factory.0.load(Ordering::Relaxed) == index + 2);
    }
    let began = Instant::now();
    bridge.shutdown();
    assert!(began.elapsed() < Duration::from_millis(300));
    assert!(bridge.actor.lock().unwrap().is_none());
    assert!(bridge.watchdog.lock().unwrap().is_none());
    clock.advance(600);
    bridge.restart();
    assert_eq!(
        bridge.request("status", json!({})).unwrap_err().code,
        "bridge_stopped"
    );
    assert_eq!(factory.0.load(Ordering::Relaxed), 9);
    assert!(fixture.executions().is_empty());
}

#[test]
fn shutdown_budget_also_covers_a_stalled_native_spawn() {
    struct Stalled {
        entered: AtomicBool,
        release: (Mutex<bool>, std::sync::Condvar),
    }
    impl ProcessFactory for Stalled {
        fn spawn(&self, _: &mut Command) -> std::io::Result<std::process::Child> {
            self.entered.store(true, Ordering::Release);
            let (lock, changed) = &self.release;
            let _guard = changed
                .wait_while(lock.lock().unwrap(), |released| !*released)
                .unwrap();
            Err(std::io::Error::other("released native spawn fault"))
        }
    }
    let fixture = Fixture::new("echo", Duration::from_secs(10), 4);
    let factory = Arc::new(Stalled {
        entered: AtomicBool::new(false),
        release: (Mutex::new(false), std::sync::Condvar::new()),
    });
    let bridge = Arc::new(controlled_bridge(
        &fixture,
        Arc::new(ManualClock(Mutex::new(Instant::now()))),
        factory.clone(),
    ));
    let requesting = bridge.clone();
    let request = thread::spawn(move || requesting.request("status", json!({})));
    fixture.wait_for(|| factory.entered.load(Ordering::Acquire));
    let began = Instant::now();
    let joined = bridge.shutdown();
    let elapsed = began.elapsed();
    *factory.release.0.lock().unwrap() = true;
    factory.release.1.notify_all();
    assert!(!joined);
    assert!(elapsed < Duration::from_millis(2500));
    assert_eq!(request.join().unwrap().unwrap_err().code, "bridge_stopped");
    fixture.wait_for(|| {
        bridge
            .actor
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(|a| a.is_finished())
    });
    assert!(bridge.shutdown());
    assert!(bridge.control.state.lock().unwrap().child.is_none());
    assert_eq!(
        bridge.control.state.lock().unwrap().lifecycle.phase,
        Phase::Stopped
    );
    assert!(fixture.executions().is_empty());
}

#[test]
fn repeated_native_startup_crashes_leave_no_internal_pid() {
    let fixture = Fixture::new("startup-fail", Duration::from_secs(5), 4);
    let clock = Arc::new(ManualClock(Mutex::new(Instant::now())));
    let bridge = controlled_bridge(&fixture, clock.clone(), Arc::new(SystemProcess));
    assert_eq!(
        bridge.request("status", json!({})).unwrap_err().code,
        "bridge_eof"
    );
    for (index, delay) in [1, 2, 4].into_iter().enumerate() {
        fixture.wait_for(|| bridge.control.pending.load(Ordering::Acquire) == 0);
        let pids = fs::read_to_string(fixture.profile.join("failed-pids")).unwrap();
        assert_eq!(pids.lines().count(), index + 1);
        for record in pids.lines() {
            let record: Value = serde_json::from_str(record).unwrap();
            fixture.assert_dead(record["pid"].as_u64().unwrap());
            fixture.assert_dead(record["helper"].as_u64().unwrap());
        }
        clock.advance(delay);
        fixture.wait_for(|| {
            fs::read_to_string(fixture.profile.join("failed-pids"))
                .unwrap()
                .lines()
                .count()
                == index + 2
        });
    }
    bridge.shutdown();
    for record in fs::read_to_string(fixture.profile.join("failed-pids"))
        .unwrap()
        .lines()
    {
        let record: Value = serde_json::from_str(record).unwrap();
        fixture.assert_dead(record["pid"].as_u64().unwrap());
        fixture.assert_dead(record["helper"].as_u64().unwrap());
    }
    assert!(fixture.executions().is_empty());
}

#[test]
#[cfg(feature = "engine-integration")]
fn automatic_recovery_runs_real_cleanup_without_replaying_emitted_effect() {
    let fixture = Fixture::create("crash-temporary", Duration::from_secs(5), 4, true);
    let config = r#"{"version":2,"applications":[],"language":"fr","autoExecute":false,"confidenceThreshold":0.7}"#;
    fs::write(fixture.profile.join("applications.json"), config).unwrap();
    let clock = Arc::new(ManualClock(Mutex::new(Instant::now())));
    let bridge = controlled_bridge(&fixture, clock.clone(), Arc::new(SystemProcess));
    assert!(bridge
        .request("process_text", json!({"text":"emitted once"}))
        .is_err());
    fixture.wait_for(|| bridge.control.pending.load(Ordering::Acquire) == 0);
    let turns = || {
        fs::read_dir(&fixture.profile)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|e| e.file_name().to_string_lossy().starts_with("turn-"))
            .map(|e| e.path())
            .collect::<Vec<_>>()
    };
    assert_eq!(turns().len(), 1);
    assert!(turns()[0].join("clip.wav").is_file());
    assert!(turns()[0].join("keywords.txt").is_file());
    let started: Value =
        serde_json::from_slice(&fs::read(fixture.profile.join("started.json")).unwrap()).unwrap();
    fixture.assert_dead(started["pid"].as_u64().unwrap());
    fs::write(fixture.profile.join("mode"), "recovered-temporary").unwrap();
    clock.advance(1);
    fixture.wait_for(|| bridge.control.state.lock().unwrap().lifecycle.phase == Phase::Ready);
    assert!(turns().is_empty());
    assert_eq!(
        fs::read_to_string(fixture.profile.join("applications.json")).unwrap(),
        config
    );
    assert_eq!(
        fs::read_to_string(fixture.profile.join("effects")).unwrap(),
        "once\n"
    );
    assert!(fixture.executions().is_empty());
    bridge.shutdown();
    assert!(bridge.actor.lock().unwrap().is_none());
}

#[test]
fn automatic_status_probe_has_a_deadline_without_a_waiting_caller() {
    let fixture = Fixture::new("silent", Duration::from_secs(5), 4);
    let clock = Arc::new(ManualClock(Mutex::new(Instant::now())));
    let bridge = Arc::new(controlled_bridge(
        &fixture,
        clock.clone(),
        Arc::new(SystemProcess),
    ));
    let requesting = bridge.clone();
    let request = thread::spawn(move || requesting.request("status", json!({})));
    fixture.wait_for(|| {
        bridge
            .control
            .state
            .lock()
            .unwrap()
            .active
            .as_ref()
            .is_some_and(|a| a.stage.load(Ordering::Acquire) == RESPONSE)
    });
    fixture.wait_for(|| fixture.executions().len() == 1);
    clock.advance(5);
    assert_eq!(
        request.join().unwrap().unwrap_err().code,
        "bridge_response_timeout"
    );
    fixture.wait_for(|| bridge.control.pending.load(Ordering::Acquire) == 0);
    // No caller exists for the next status probe: the watchdog owns its deadline.
    clock.advance(1);
    fixture.wait_for(|| {
        bridge
            .control
            .state
            .lock()
            .unwrap()
            .active
            .as_ref()
            .is_some_and(|a| a.id > 1 && a.stage.load(Ordering::Acquire) == RESPONSE)
    });
    fixture.wait_for(|| fixture.executions().len() == 2);
    let pid = bridge
        .control
        .state
        .lock()
        .unwrap()
        .child
        .as_ref()
        .unwrap()
        .inner
        .id();
    clock.advance(50);
    fixture.wait_for(|| bridge.control.pending.load(Ordering::Acquire) == 0);
    fixture.assert_dead(pid.into());
    let state = bridge.control.state.lock().unwrap();
    assert_eq!(state.lifecycle.phase, Phase::Recovering);
    assert_eq!(
        state.lifecycle.retry_at,
        Some(clock.now() + Duration::from_secs(2))
    );
    drop(state);
    assert_eq!(fixture.executions(), ["status", "status"]);
    let events = bridge.export_diagnostics().unwrap();
    for event in ["supervisor_starting", "supervisor_recovering"] {
        assert!(events["events"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["event"] == event));
    }
    bridge.shutdown();
}

#[test]
fn shutdown_joins_monitor_during_warmup_inference_idle_and_blocked_write() {
    for (mode, method, stage) in [
        ("silent", "status", RESPONSE),
        ("silent", "process_audio", RESPONSE),
        ("never-read-child", "process_audio", WRITING),
    ] {
        let fixture = Fixture::new(mode, Duration::from_secs(5), 4);
        let bridge = fixture.bridge.clone();
        let active = thread::spawn(move || {
            bridge.request(
                method,
                if method == "process_audio" {
                    audio()
                } else {
                    json!({})
                },
            )
        });
        fixture.ready();
        fixture.at_stage(stage);
        if mode == "never-read-child" {
            fixture.wait_for(|| {
                fs::read(fixture.profile.join("started.json"))
                    .ok()
                    .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
                    .is_some_and(|v| v["helper"].is_number())
            });
        }
        let started: Value =
            serde_json::from_slice(&fs::read(fixture.profile.join("started.json")).unwrap())
                .unwrap();
        let bridge = fixture.bridge.clone();
        let queued = thread::spawn(move || bridge.request("status", json!({})));
        fixture.wait_for(|| fixture.bridge.control.pending.load(Ordering::Acquire) == 2);
        let began = Instant::now();
        fixture.bridge.shutdown();
        assert!(began.elapsed() < Duration::from_secs(2));
        assert_eq!(active.join().unwrap().unwrap_err().code, "bridge_stopped");
        assert_eq!(queued.join().unwrap().unwrap_err().code, "bridge_stopped");
        assert!(fixture.bridge.actor.lock().unwrap().is_none());
        assert!(fixture.bridge.watchdog.lock().unwrap().is_none());
        assert_eq!(
            fixture.bridge.control.state.lock().unwrap().lifecycle.phase,
            Phase::Stopped
        );
        fixture.assert_dead(started["pid"].as_u64().unwrap());
        if let Some(pid) = started["helper"].as_u64() {
            fixture.assert_dead(pid);
        }
        let count = fixture.executions().len();
        fixture.bridge.restart();
        assert_eq!(
            fixture
                .bridge
                .request("status", json!({}))
                .unwrap_err()
                .code,
            "bridge_stopped"
        );
        assert_eq!(fixture.executions().len(), count);
    }
    let fixture = Fixture::new("echo", Duration::from_secs(5), 4);
    fixture.bridge.request("status", json!({})).unwrap();
    let started: Value =
        serde_json::from_slice(&fs::read(fixture.profile.join("started.json")).unwrap()).unwrap();
    let began = Instant::now();
    fixture.bridge.shutdown();
    assert!(began.elapsed() < Duration::from_millis(300));
    assert!(fixture.bridge.actor.lock().unwrap().is_none());
    fixture.assert_dead(started["pid"].as_u64().unwrap());
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.bridge.shutdown();
        let deadline = Instant::now() + Duration::from_secs(5);
        while self
            .bridge
            .actor
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(|a| !a.is_finished())
            && Instant::now() < deadline
        {
            thread::sleep(Duration::from_millis(5));
        }
        assert!(
            self.bridge
                .actor
                .lock()
                .unwrap()
                .as_ref()
                .is_none_or(|a| a.is_finished()),
            "actor/reader must terminate before removing fixture"
        );
        assert!(
            self.bridge.control.state.lock().unwrap().child.is_none(),
            "fixture child must be reaped"
        );
        fs::remove_dir_all(&self.profile).unwrap();
    }
}
fn audio() -> Value {
    json!({"audio": vec![255;1_100_000]})
}

#[test]
fn injected_spawn_failure_is_correlated_without_start_or_replay() {
    struct FailingFactory(AtomicUsize);
    impl ProcessFactory for FailingFactory {
        fn spawn(&self, command: &mut Command) -> std::io::Result<std::process::Child> {
            self.0.fetch_add(1, Ordering::Relaxed);
            assert!(command.get_program().to_string_lossy().ends_with(".exe"));
            assert_eq!(command.get_args().count(), 3);
            Err(std::io::Error::other("injected spawn failure"))
        }
    }
    let fixture = Fixture::new("echo", Duration::from_secs(2), 2);
    let factory = Arc::new(FailingFactory(AtomicUsize::new(0)));
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let bridge = Bridge::with_services(
        Config {
            node: root.join("binaries/pam-node-x86_64-pc-windows-msvc.exe"),
            script: root.join("../tests/fixtures/bridge-sidecar.cjs"),
            runtime: fixture.runtime.clone(),
            profile: fixture.profile.clone(),
            catalogue: Arc::new(Catalogue::default()),
        },
        Duration::from_secs(2),
        2,
        Arc::new(SystemClock),
        factory.clone(),
    )
    .unwrap();
    let error = bridge
        .request_correlated("status", json!({}), "11111111-1111-4111-8111-111111111111")
        .unwrap_err();
    assert_eq!(
        error.envelope().request_id,
        "11111111-1111-4111-8111-111111111111"
    );
    assert_eq!(factory.0.load(Ordering::Relaxed), 1);
    assert!(!bridge.has_started());
    assert!(!fixture.profile.join("started.json").exists());
    assert!(fixture.executions().is_empty());
    bridge.shutdown();
    fixture.wait_for(|| {
        bridge
            .actor
            .lock()
            .unwrap()
            .as_ref()
            .is_none_or(|a| a.is_finished())
    });
}

#[test]
fn injected_clock_expires_attempt_before_any_process_effect() {
    struct FixedClock(Instant);
    impl Clock for FixedClock {
        fn now(&self) -> Instant {
            self.0
        }
    }
    let clock = Arc::new(FixedClock(Instant::now() + Duration::from_secs(60)));
    let control = Control {
        clock: clock.clone(),
        ..Control::default()
    };
    let attempt = Attempt {
        id: 1,
        request_id: "clock-fixture".into(),
        deadline: clock.now(),
        stage: AtomicU8::new(QUEUED),
        cancelled: AtomicBool::new(false),
        progress: Mutex::new(None),
    };
    assert_eq!(
        attempt.check(&control).unwrap_err().code,
        "bridge_queue_timeout"
    );
    assert!(control.state.lock().unwrap().child.is_none());
}

#[test]
fn diagnostics_correlate_node_rust_and_stderr_without_personal_content() {
    let fixture = Fixture::new("diagnostic", Duration::from_secs(3), 4);
    let error = fixture
        .bridge
        .request("process_audio", json!({"audio":[83,69,78,84,73,78,69,76]}))
        .unwrap_err()
        .envelope();
    assert_eq!(error.code, "model_failure");
    assert_eq!(error.stage, "transcription");
    fixture.wait_for(|| {
        fixture.bridge.export_diagnostics().unwrap()["events"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v["event"] == "stderr")
    });
    let export = fixture.bridge.export_diagnostics().unwrap();
    let events = export["events"].as_array().unwrap();
    for source in ["rust", "node"] {
        assert!(events.iter().any(|v| v["source"] == source
            && v["error"]["requestId"] == error.request_id
            && v["error"]["code"] == "model_failure"));
    }
    let text = export.to_string();
    assert!(!text.contains("SENTINEL"));
    assert!(!text.contains("Private"));
    assert!(!text.contains("Users"));
}

#[test]
fn real_node_main_propagates_corrupt_profile_without_voice_content() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let profile = std::env::temp_dir().join(diagnostics::request_id());
    fs::create_dir(&profile).unwrap();
    fs::write(
        profile.join("applications.json"),
        "SENTINEL_PRIVATE_PROFILE",
    )
    .unwrap();
    let bridge = Bridge::with_limits(
        Config {
            node: root.join("binaries/pam-node-x86_64-pc-windows-msvc.exe"),
            script: root.join("../sidecar/main.cjs"),
            runtime: profile.join("runtime-not-installed"),
            profile: profile.clone(),
            catalogue: Arc::new(Catalogue::default()),
        },
        Duration::from_secs(5),
        4,
    )
    .unwrap();
    let fixture = Fixture {
        bridge: Arc::new(bridge),
        runtime: profile.join("runtime-not-installed"),
        profile,
    };
    let error = fixture
        .bridge
        .request("process_text", json!({"text":"SENTINEL_PRIVATE_VOICE"}))
        .unwrap_err()
        .envelope();
    assert_eq!(error.code, "invalid_profile");
    assert_eq!(error.stage, "profile");
    let exported = fixture.bridge.export_diagnostics().unwrap();
    for source in ["rust", "node"] {
        assert!(exported["events"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v["source"] == source && v["error"]["requestId"] == error.request_id));
    }
    for entry in fs::read_dir(fixture.profile.join("diagnostics")).unwrap() {
        let bytes = fs::read_to_string(entry.unwrap().path()).unwrap();
        assert!(!bytes.contains("SENTINEL"));
    }
    assert!(!exported.to_string().contains("SENTINEL"));
}

#[test]
fn missing_host_target_has_a_safe_stable_error() {
    let fixture = Fixture::new("host-missing", Duration::from_secs(3), 4);
    let error = fixture
        .bridge
        .request("process_text", json!({"text":"host missing"}))
        .unwrap_err()
        .envelope();
    assert_eq!(error.code, "target_missing");
    assert_eq!(error.stage, "host");
    let export = fixture.bridge.export_diagnostics().unwrap().to_string();
    assert!(!export.contains("SENTINEL"));
    assert!(!export.contains(".exe"));
}

#[test]
fn unread_audio_pipe_has_a_deadline_and_recovers() {
    let fixture = Fixture::new("never-read", Duration::from_millis(600), 4);
    let start = Instant::now();
    let error = fixture
        .bridge
        .request("process_audio", audio())
        .unwrap_err();
    assert_eq!(error.code, "bridge_write_timeout", "{error}");
    assert!(start.elapsed() < Duration::from_secs(2));
    fixture.ready();
    fixture.wait_for(|| fixture.bridge.is_idle());
    fixture.mode("echo");
    let result = fixture
        .bridge
        .request("process_text", json!({"text":"recovered"}))
        .unwrap();
    assert_eq!(result["transcript"], "recovered");
    assert_eq!(fixture.executions(), ["recovered"]);
}

#[test]
fn shutdown_during_write_does_not_wait_for_pipe_lock() {
    let fixture = Fixture::new("never-read", Duration::from_secs(5), 4);
    let bridge = fixture.bridge.clone();
    let request = thread::spawn(move || bridge.request("process_audio", audio()));
    fixture.ready();
    fixture.at_stage(WRITING);
    let start = Instant::now();
    fixture.bridge.shutdown();
    assert!(start.elapsed() < Duration::from_millis(300));
    assert_eq!(request.join().unwrap().unwrap_err().code, "bridge_stopped");
    assert!(start.elapsed() < Duration::from_secs(2));
    assert_eq!(
        fixture
            .bridge
            .request("status", json!({}))
            .unwrap_err()
            .code,
        "bridge_stopped"
    );
}

#[test]
fn deadline_kills_internal_children_that_inherit_the_pipe() {
    let fixture = Fixture::new("never-read-child", Duration::from_millis(800), 4);
    let error = fixture
        .bridge
        .request("process_audio", audio())
        .unwrap_err();
    assert_eq!(error.code, "bridge_write_timeout");
    fixture.wait_for(|| fixture.bridge.is_idle());
    let started: Value =
        serde_json::from_slice(&fs::read(fixture.profile.join("started.json")).unwrap()).unwrap();
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    for pid in [
        started["pid"].as_u64().unwrap(),
        started["helper"].as_u64().unwrap(),
    ] {
        let alive = Command::new(root.join("binaries/pam-node-x86_64-pc-windows-msvc.exe"))
            .args([
                "-e",
                "try { process.kill(Number(process.argv[1]), 0); } catch { process.exit(1); }",
                &pid.to_string(),
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .unwrap();
        assert!(
            !alive.success(),
            "internal fixture process {pid} must be dead"
        );
    }
    fixture.mode("echo");
    assert!(fixture.bridge.request("status", json!({})).is_ok());
}

#[test]
fn restart_during_write_is_accessible_and_does_not_replay() {
    let fixture = Fixture::new("never-read", Duration::from_secs(5), 4);
    let bridge = fixture.bridge.clone();
    let request = thread::spawn(move || bridge.request("process_audio", audio()));
    fixture.ready();
    fixture.at_stage(WRITING);
    fixture.mode("echo");
    let start = Instant::now();
    fixture.bridge.restart();
    assert!(start.elapsed() < Duration::from_millis(300));
    assert_eq!(
        request.join().unwrap().unwrap_err().code,
        "bridge_interrupted"
    );
    assert!(start.elapsed() < Duration::from_secs(2));
    assert_eq!(
        fixture
            .bridge
            .request("process_text", json!({"text":"after restart"}))
            .unwrap()["transcript"],
        "after restart"
    );
    assert_eq!(fixture.executions(), ["after restart"]);
}

#[test]
fn idle_restart_retires_the_stream_before_the_next_request() {
    let fixture = Fixture::new("echo", Duration::from_secs(2), 4);
    let first = fixture
        .bridge
        .request("process_text", json!({"text":"before"}))
        .unwrap();
    fixture.bridge.restart();
    let second = fixture
        .bridge
        .request("process_text", json!({"text":"after"}))
        .unwrap();
    assert_ne!(first["reasoning"], second["reasoning"]);
    assert_eq!(fixture.executions(), ["before", "after"]);
}

#[test]
fn eof_is_distinct_from_a_missing_response() {
    let fixture = Fixture::new("eof", Duration::from_secs(2), 4);
    assert_eq!(
        fixture
            .bridge
            .request("status", json!({}))
            .unwrap_err()
            .code,
        "bridge_eof"
    );
    fixture.mode("silent");
    let start = Instant::now();
    assert_eq!(
        fixture
            .bridge
            .request_until("status", json!({}), start + Duration::from_millis(600))
            .unwrap_err()
            .code,
        "bridge_response_timeout"
    );
    assert!(start.elapsed() < Duration::from_secs(2));
}

#[test]
fn full_queue_and_expired_queued_request_never_execute() {
    let fixture = Fixture::new("late", Duration::from_secs(4), 1);
    let bridge = fixture.bridge.clone();
    let active = thread::spawn(move || bridge.request("process_text", json!({"text":"active"})));
    fixture.ready();
    fixture.at_stage(RESPONSE);
    let bridge = fixture.bridge.clone();
    let queued = thread::spawn(move || {
        bridge.request_until(
            "process_text",
            json!({"text":"expired"}),
            Instant::now() + Duration::from_millis(300),
        )
    });
    fixture.wait_for(|| fixture.bridge.control.pending.load(Ordering::Acquire) == 2);
    assert_eq!(
        fixture
            .bridge
            .request("process_text", json!({"text":"saturated"}))
            .unwrap_err()
            .code,
        "bridge_queue_full"
    );
    assert_eq!(
        queued.join().unwrap().unwrap_err().code,
        "bridge_queue_timeout"
    );
    // A queued timeout must not kill the active process or cancel its effect.
    assert_eq!(active.join().unwrap().unwrap()["transcript"], "active");
    fixture.wait_for(|| fixture.bridge.is_idle());
    assert_eq!(fixture.executions(), ["active"]);
}

#[test]
fn late_reply_cannot_satisfy_another_request_or_replay_an_effect() {
    let fixture = Fixture::new("late", Duration::from_millis(600), 4);
    assert_eq!(
        fixture
            .bridge
            .request("process_text", json!({"text":"once"}))
            .unwrap_err()
            .code,
        "bridge_response_timeout"
    );
    fixture.wait_for(|| fixture.bridge.is_idle());
    fixture.mode("echo");
    assert_eq!(
        fixture
            .bridge
            .request("process_text", json!({"text":"new"}))
            .unwrap()["transcript"],
        "new"
    );
    assert_eq!(fixture.executions(), ["once", "new"]);
}

#[test]
fn requests_keep_effect_order_and_size_limits() {
    let fixture = Fixture::new("echo", Duration::from_secs(2), 4);
    for label in ["first", "second", "third"] {
        assert_eq!(
            fixture
                .bridge
                .request("process_text", json!({"text":label}))
                .unwrap()["transcript"],
            label
        );
    }
    assert_eq!(fixture.executions(), ["first", "second", "third"]);
    assert_eq!(
        fixture
            .bridge
            .request("process_audio", json!({"audio":vec![255;1_300_000]}))
            .unwrap_err()
            .code,
        "bridge_request_size"
    );
    assert_eq!(fixture.executions(), ["first", "second", "third"]);
}

#[test]
fn concurrent_requests_execute_in_queue_order() {
    let fixture = Fixture::new("late", Duration::from_secs(6), 4);
    let bridge = fixture.bridge.clone();
    let first = thread::spawn(move || bridge.request("process_text", json!({"text":"first"})));
    fixture.ready();
    fixture.at_stage(RESPONSE);
    let bridge = fixture.bridge.clone();
    let second = thread::spawn(move || bridge.request("process_text", json!({"text":"second"})));
    fixture.wait_for(|| fixture.bridge.control.pending.load(Ordering::Acquire) == 2);
    let bridge = fixture.bridge.clone();
    let third = thread::spawn(move || bridge.request("process_text", json!({"text":"third"})));
    fixture.wait_for(|| fixture.bridge.control.pending.load(Ordering::Acquire) == 3);
    for (request, label) in [(first, "first"), (second, "second"), (third, "third")] {
        assert_eq!(request.join().unwrap().unwrap()["transcript"], label);
    }
    assert_eq!(fixture.executions(), ["first", "second", "third"]);
}

#[test]
fn interruption_preserves_per_action_outcomes_and_restart_does_not_replay() {
    for mode in ["partial-timeout", "partial-eof"] {
        let fixture = Fixture::new(mode, Duration::from_millis(600), 4);
        let start = Instant::now();
        let turn = fixture
            .bridge
            .request("process_text", json!({"text":"emitted"}))
            .unwrap();
        assert!(start.elapsed() < Duration::from_secs(2));
        assert_eq!(turn["status"], "partial");
        assert_eq!(turn["results"][0]["outcome"], "performed");
        assert_eq!(turn["results"][1]["outcome"], "unknown");
        assert_eq!(turn["results"][2]["outcome"], "not_started");
        fixture.wait_for(|| fixture.bridge.is_idle());
        fixture.mode("echo");
        fixture.bridge.restart();
        assert_eq!(
            fixture
                .bridge
                .request("process_text", json!({"text":"recovered"}))
                .unwrap()["transcript"],
            "recovered"
        );
        assert_eq!(fixture.executions(), ["emitted", "recovered"]);
    }
}

#[test]
fn sidecar_receives_budget_after_queueing_and_startup() {
    let fixture = Fixture::new("late", Duration::from_secs(4), 4);
    let bridge = fixture.bridge.clone();
    let first = thread::spawn(move || bridge.request("process_text", json!({"text":"first"})));
    fixture.ready();
    fixture.at_stage(RESPONSE);
    fixture
        .bridge
        .request("process_text", json!({"text":"second"}))
        .unwrap();
    first.join().unwrap().unwrap();
    let budgets: Vec<u64> = fs::read_to_string(fixture.profile.join("budgets"))
        .unwrap()
        .lines()
        .map(|line| line.parse().unwrap())
        .collect();
    assert_eq!(budgets.len(), 2);
    assert!(budgets[0] <= 3_500);
    assert!(budgets[1] < budgets[0].saturating_sub(1_000));
}

#[test]
fn unrelated_progress_cannot_supply_a_partial_result() {
    let fixture = Fixture::new("invalid-progress", Duration::from_secs(2), 4);
    assert_eq!(
        fixture
            .bridge
            .request("process_text", json!({"text":"invalid progress"}))
            .unwrap_err()
            .code,
        "bridge_protocol"
    );
}

#[test]
fn stale_response_is_ignored_without_replaying_the_request() {
    let fixture = Fixture::new("stale-response", Duration::from_secs(2), 4);
    let result = fixture
        .bridge
        .request("process_text", json!({"text":"once"}))
        .unwrap();
    assert_eq!(result["transcript"], "once");
    assert_eq!(fixture.executions(), ["once"]);
}

#[test]
fn malformed_or_incompatible_frames_fail_before_host_effect() {
    for mode in [
        "wrong-version",
        "invalid-result",
        "invalid-error",
        "invalid-host",
    ] {
        let fixture = Fixture::new(mode, Duration::from_secs(2), 4);
        assert_eq!(
            fixture
                .bridge
                .request("process_text", json!({"text":"once"}))
                .unwrap_err()
                .code,
            "bridge_protocol",
            "{mode}"
        );
        assert_eq!(fixture.executions(), ["once"]);
        assert!(!fixture.profile.join("forbidden-effect").exists());
    }
}

#[test]
fn invalid_oversized_truncated_and_dead_child_retire_the_entire_stream() {
    for (mode, expected) in [
        ("invalid-json", "bridge_protocol"),
        ("oversized-response", "bridge_protocol"),
        ("truncated-response", "bridge_protocol"),
        ("dead-child", "bridge_eof"),
    ] {
        let fixture = Fixture::new(mode, Duration::from_secs(3), 4);
        let start = Instant::now();
        assert_eq!(
            fixture
                .bridge
                .request("process_text", json!({"text":"once"}))
                .unwrap_err()
                .code,
            expected,
            "{mode}"
        );
        assert!(start.elapsed() < Duration::from_secs(3));
        let started: Value =
            serde_json::from_slice(&fs::read(fixture.profile.join("started.json")).unwrap())
                .unwrap();
        fixture.wait_for(|| fixture.bridge.is_idle());
        fixture.assert_dead(started["pid"].as_u64().unwrap());
        fixture.mode("echo");
        assert_eq!(
            fixture
                .bridge
                .request("process_text", json!({"text":"recovered"}))
                .unwrap()["transcript"],
            "recovered"
        );
        assert_eq!(fixture.executions(), ["once", "recovered"]);
        assert!(
            !fixture.runtime.exists(),
            "fault tests must not need model assets"
        );
    }
}
