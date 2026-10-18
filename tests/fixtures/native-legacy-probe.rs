// Included after the bridge extracted verbatim from the audited Git revision.
fn main() {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    let mode = args[0].to_string_lossy().into_owned();
    let node = PathBuf::from(&args[1]);
    let profile = PathBuf::from(&args[3]);
    let bridge = Arc::new(AssistantBridge {
        node: node.clone(),
        script: args[2].clone().into(),
        runtime: profile.clone(),
        config: profile.clone(),
        worker: Arc::new(Mutex::new(None)),
        shortcut_error: String::new(),
        started: AtomicBool::new(false),
        stopped: AtomicBool::new(false),
    });
    let passed = if mode == "pipe" {
        let request = bridge.clone();
        let (send, receive) = mpsc::channel();
        let thread = std::thread::spawn(move || {
            let _ =
                send.send(request.request("process_audio", json!({"audio":vec![255;1_100_000]})));
        });
        let timely = receive.recv_timeout(Duration::from_millis(800)).is_ok();
        if !timely {
            let started: Value =
                serde_json::from_slice(&std::fs::read(profile.join("started.json")).unwrap())
                    .unwrap();
            kill(&node, started["pid"].as_u64().unwrap());
        }
        thread.join().unwrap();
        timely
    } else {
        let marker = profile.join("user.txt");
        let response = bridge.request("test_application",json!({"name":"Fixture","description":"Disposable fixture","executable":PathBuf::from(&args[4]),"arguments":[marker],"aliases":[],"enabled":true})).unwrap();
        assert_eq!(
            response["success"], true,
            "legacy setup must actually launch the fixture"
        );
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while !marker.exists() && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        let pid: u64 = std::fs::read_to_string(marker)
            .unwrap()
            .lines()
            .next()
            .unwrap()
            .parse()
            .unwrap();
        drop(bridge); // Original Worker/Job drop terminates inherited user process.
        std::thread::sleep(Duration::from_millis(200));
        let survived = alive(&node, pid);
        if survived {
            kill(&node, pid);
        }
        survived
    };
    println!(
        "{{\"regression\":\"{}\",\"passed\":{passed}}}",
        if mode == "pipe" { "PAM-04" } else { "PAM-01" }
    );
    if !passed {
        std::process::exit(1);
    }
}
fn alive(node: &std::path::Path, pid: u64) -> bool {
    use std::os::windows::process::CommandExt;
    Command::new(node)
        .args([
            "-e",
            "try{process.kill(Number(process.argv[1]),0)}catch{process.exit(1)}",
            &pid.to_string(),
        ])
        .creation_flags(0x08000000)
        .status()
        .unwrap()
        .success()
}
fn kill(node: &std::path::Path, pid: u64) {
    use std::os::windows::process::CommandExt;
    let _ = Command::new(node)
        .args([
            "-e",
            "try{process.kill(Number(process.argv[1]))}catch{}",
            &pid.to_string(),
        ])
        .creation_flags(0x08000000)
        .status();
}
