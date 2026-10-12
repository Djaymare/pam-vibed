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
    json!({"audio": "A".repeat(4_000_000)})
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
        .request("status", json!({"label":"recovered"}))
        .unwrap();
    assert_eq!(result["label"], "recovered");
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
            .request("status", json!({"label":"after restart"}))
            .unwrap()["label"],
        "after restart"
    );
    assert_eq!(fixture.executions(), ["after restart"]);
}

#[test]
fn idle_restart_retires_the_stream_before_the_next_request() {
    let fixture = Fixture::new("echo", Duration::from_secs(2), 4);
    let first = fixture
        .bridge
        .request("status", json!({"label":"before"}))
        .unwrap();
    fixture.bridge.restart();
    let second = fixture
        .bridge
        .request("status", json!({"label":"after"}))
        .unwrap();
    assert_ne!(first["pid"], second["pid"]);
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
    let active = thread::spawn(move || bridge.request("confirm", json!({"label":"active"})));
    fixture.ready();
    fixture.at_stage(RESPONSE);
    let bridge = fixture.bridge.clone();
    let queued = thread::spawn(move || {
        bridge.request_until(
            "confirm",
            json!({"label":"expired"}),
            Instant::now() + Duration::from_millis(300),
        )
    });
    fixture.wait_for(|| fixture.bridge.control.pending.load(Ordering::Acquire) == 2);
    assert_eq!(
        fixture
            .bridge
            .request("confirm", json!({"label":"saturated"}))
            .unwrap_err()
            .code,
        "bridge_queue_full"
    );
    assert_eq!(
        queued.join().unwrap().unwrap_err().code,
        "bridge_queue_timeout"
    );
    // A queued timeout must not kill the active process or cancel its effect.
    assert_eq!(active.join().unwrap().unwrap()["label"], "active");
    fixture.wait_for(|| fixture.bridge.is_idle());
    assert_eq!(fixture.executions(), ["active"]);
}

#[test]
fn late_reply_cannot_satisfy_another_request_or_replay_an_effect() {
    let fixture = Fixture::new("late", Duration::from_millis(600), 4);
    assert_eq!(
        fixture
            .bridge
            .request("confirm", json!({"label":"once"}))
            .unwrap_err()
            .code,
        "bridge_response_timeout"
    );
    fixture.wait_for(|| fixture.bridge.is_idle());
    fixture.mode("echo");
    assert_eq!(
        fixture
            .bridge
            .request("status", json!({"label":"new"}))
            .unwrap()["label"],
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
                .request("confirm", json!({"label":label}))
                .unwrap()["label"],
            label
        );
    }
    assert_eq!(fixture.executions(), ["first", "second", "third"]);
    assert_eq!(
        fixture
            .bridge
            .request("process_audio", json!({"audio":"A".repeat(5_000_000)}))
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
    let first = thread::spawn(move || bridge.request("confirm", json!({"label":"first"})));
    fixture.ready();
    fixture.at_stage(RESPONSE);
    let bridge = fixture.bridge.clone();
    let second = thread::spawn(move || bridge.request("confirm", json!({"label":"second"})));
    fixture.wait_for(|| fixture.bridge.control.pending.load(Ordering::Acquire) == 2);
    let bridge = fixture.bridge.clone();
    let third = thread::spawn(move || bridge.request("confirm", json!({"label":"third"})));
    fixture.wait_for(|| fixture.bridge.control.pending.load(Ordering::Acquire) == 3);
    for (request, label) in [(first, "first"), (second, "second"), (third, "third")] {
        assert_eq!(request.join().unwrap().unwrap()["label"], label);
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
            .request("confirm", json!({"label":"emitted"}))
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
                .request("status", json!({"label":"recovered"}))
                .unwrap()["label"],
            "recovered"
        );
        assert_eq!(fixture.executions(), ["emitted", "recovered"]);
    }
}

#[test]
fn sidecar_receives_budget_after_queueing_and_startup() {
    let fixture = Fixture::new("late", Duration::from_secs(4), 4);
    let bridge = fixture.bridge.clone();
    let first = thread::spawn(move || bridge.request("confirm", json!({"label":"first"})));
    fixture.ready();
    fixture.at_stage(RESPONSE);
    fixture
        .bridge
        .request("confirm", json!({"label":"second"}))
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
            .request("confirm", json!({}))
            .unwrap_err()
            .code,
        "bridge_protocol"
    );
}
