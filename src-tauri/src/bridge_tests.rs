use super::*;
use std::fs;

static FIXTURE_ID: AtomicU64 = AtomicU64::new(1);
struct Fixture {
    bridge: Arc<Bridge>,
    profile: PathBuf,
}
impl Fixture {
    fn new(mode: &str, timeout: Duration, capacity: usize) -> Self {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let profile = std::env::temp_dir().join(format!(
            "pam-bridge-{}-{}",
            std::process::id(),
            FIXTURE_ID.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&profile).unwrap();
        fs::write(profile.join("mode"), mode).unwrap();
        let bridge = Bridge::with_limits(
            Config {
                node: root.join("binaries/pam-node-x86_64-pc-windows-msvc.exe"),
                script: root.join("../tests/fixtures/bridge-sidecar.cjs"),
                runtime: root.join("runtime"),
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
    }
    fn executions(&self) -> Vec<String> {
        fs::read_to_string(self.profile.join("executions"))
            .unwrap_or_default()
            .lines()
            .map(str::to_owned)
            .collect()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.bridge.shutdown();
        let deadline = Instant::now() + Duration::from_secs(5);
        while !self.bridge._actor.is_finished() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(5));
        }
        assert!(
            self.bridge._actor.is_finished(),
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
            runtime: root.join("runtime"),
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
    fixture.wait_for(|| bridge._actor.is_finished());
}

#[test]
fn injected_clock_expires_attempt_before_any_process_effect() {
    struct FixedClock(Instant);
    impl Clock for FixedClock {
        fn now(&self) -> Instant {
            self.0
        }
        fn sleep(&self, _: Duration) {
            panic!("bridge must not poll by sleeping");
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
            runtime: root.join("runtime"),
            profile: profile.clone(),
            catalogue: Arc::new(Catalogue::default()),
        },
        Duration::from_secs(5),
        4,
    )
    .unwrap();
    let fixture = Fixture {
        bridge: Arc::new(bridge),
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
