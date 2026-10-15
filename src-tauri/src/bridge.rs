//! One transport actor serializes effects. Callers never own the pipe or its lock.
use crate::{applications::Catalogue, diagnostics, launch};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    fmt,
    io::{BufRead, BufReader, Read, Write},
    path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, AtomicU8, AtomicUsize, Ordering},
        mpsc::{self, Receiver, RecvTimeoutError, SyncSender, TrySendError},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const REQUEST_LIMIT: usize = 5_000_000;
const RESPONSE_LIMIT: u64 = 2_000_000;
const QUEUED: u8 = 0;
const STARTING: u8 = 1;
const WRITING: u8 = 2;
const RESPONSE: u8 = 3;
const HOST_EFFECT: u8 = 4;

#[derive(Debug)]
pub(crate) struct Error {
    pub code: &'static str,
    detail: String,
    diagnostic: Option<Box<diagnostics::Error>>,
}
impl Error {
    fn new(code: &'static str, detail: impl Into<String>) -> Self {
        Self {
            code,
            detail: detail.into(),
            diagnostic: None,
        }
    }
    pub fn envelope(&self) -> diagnostics::Error {
        self.diagnostic.as_deref().cloned().unwrap_or_else(|| {
            let code = if self.code.contains("timeout") {
                "request_timeout"
            } else if self.code == "bridge_queue_full" {
                "transport_busy"
            } else if self.code == "bridge_protocol" {
                "transport_protocol"
            } else {
                "transport_unavailable"
            };
            let stage = if self.code.contains("start") {
                "start"
            } else if self.code.contains("write") {
                "write"
            } else if self.code.contains("response") {
                "response"
            } else if self.code.contains("host") {
                "host"
            } else if self.code.contains("queue") {
                "queue"
            } else {
                "transport"
            };
            diagnostics::Error::new(code, "", stage)
        })
    }
}
impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{}] {}", self.code, self.detail)
    }
}

pub(crate) struct Config {
    pub node: PathBuf,
    pub script: PathBuf,
    pub runtime: PathBuf,
    pub profile: PathBuf,
    pub catalogue: Arc<Catalogue>,
}

struct Attempt {
    id: u64,
    request_id: String,
    deadline: Instant,
    stage: AtomicU8,
    cancelled: AtomicBool,
    progress: Mutex<Option<Value>>,
}
impl Attempt {
    fn partial(&self, error: &Error) -> Option<Value> {
        let mut turn = self
            .progress
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()?;
        turn["status"] = json!("partial");
        let safe = error.envelope();
        let diagnostic = diagnostics::Error::new(&safe.code, &self.request_id, &safe.stage);
        turn["message"] = json!(format!(
            "{} Vérifiez les actions dont le résultat est inconnu avant toute nouvelle demande.",
            diagnostic.message
        ));
        turn["error"] = json!(diagnostic);
        if let Some(results) = turn["results"].as_array_mut() {
            for result in results {
                if result["outcome"] == "unknown" {
                    result["success"] = json!(false);
                    result["message"] = json!("Résultat inconnu : la commande a pu être effectuée. Aucun rejeu automatique.");
                }
            }
        }
        Some(turn)
    }
    fn timeout(&self) -> Error {
        let (code, stage) = match self.stage.load(Ordering::Acquire) {
            STARTING => ("bridge_start_timeout", "démarrage"),
            WRITING => ("bridge_write_timeout", "écriture du pipe bloquée"),
            RESPONSE => ("bridge_response_timeout", "absence de réponse"),
            HOST_EFFECT => ("bridge_host_timeout", "effet natif, résultat incertain"),
            _ => ("bridge_queue_timeout", "attente dans la file"),
        };
        Error::new(code, format!("Délai de l’opération dépassé ({stage}). Aucune demande n’est rejouée automatiquement."))
    }
    fn check(&self, control: &Control) -> Result<(), Error> {
        if control.stopped.load(Ordering::Acquire) {
            Err(Error::new("bridge_stopped", "Le bridge est arrêté."))
        } else if Instant::now() >= self.deadline {
            Err(self.timeout())
        } else if self.cancelled.load(Ordering::Acquire) {
            Err(Error::new(
                "bridge_interrupted",
                "Demande interrompue ; aucun rejeu automatique.",
            ))
        } else {
            Ok(())
        }
    }
}
struct Operation {
    attempt: Arc<Attempt>,
    bytes: Vec<u8>,
    reply: SyncSender<Result<Value, Error>>,
}

#[derive(Default)]
struct ProcessState {
    child: Option<Child>,
    invalidated: bool,
    active: Option<Arc<Attempt>>,
    #[cfg(windows)]
    job: Option<ProcessJob>,
}
impl ProcessState {
    fn kill(&mut self) {
        self.invalidated = true;
        // Internal children may also hold the unread pipe open. Terminate the
        // entire sidecar job through the independent control path.
        #[cfg(windows)]
        if let Some(job) = &self.job {
            unsafe {
                windows_sys::Win32::System::JobObjects::TerminateJobObject(job.0, 70);
            }
        }
        if let Some(child) = self.child.as_mut() {
            let _ = child.kill();
        }
    }
}
#[derive(Default)]
struct Control {
    // Held only for process bookkeeping/kill, never for pipe I/O or effects.
    state: Mutex<ProcessState>,
    stopped: AtomicBool,
    started: AtomicBool,
    pending: AtomicUsize,
    journal: Mutex<Option<Arc<diagnostics::Journal>>>,
}
impl Control {
    fn cancel(&self, attempt: &Attempt) {
        attempt.cancelled.store(true, Ordering::Release);
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        // An expired queued caller must not kill another caller's sidecar.
        if state
            .active
            .as_ref()
            .is_some_and(|active| active.id == attempt.id)
        {
            state.kill();
        }
    }
    fn interrupt(&self) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(attempt) = &state.active {
            attempt.cancelled.store(true, Ordering::Release);
        }
        state.kill();
    }
}

pub(crate) struct Bridge {
    sender: SyncSender<Operation>,
    control: Arc<Control>,
    next_id: AtomicU64,
    timeout: Duration,
    _actor: JoinHandle<()>,
}
impl Bridge {
    pub fn new(config: Config) -> Result<Self, String> {
        Self::with_limits(config, Duration::from_secs(50), 4)
    }
    fn with_limits(config: Config, timeout: Duration, capacity: usize) -> Result<Self, String> {
        let (sender, receiver) = mpsc::sync_channel(capacity);
        let control = Arc::new(Control::default());
        *control.journal.lock().unwrap() =
            Some(Arc::new(diagnostics::Journal::new(config.profile.clone())));
        let actor_control = control.clone();
        let actor = thread::Builder::new()
            .name("pam-bridge".into())
            .spawn(move || run_actor(config, receiver, actor_control))
            .map_err(|e| e.to_string())?;
        Ok(Self {
            sender,
            control,
            next_id: AtomicU64::new(1),
            timeout,
            _actor: actor,
        })
    }
    pub fn request(&self, method: &str, payload: Value) -> Result<Value, Error> {
        self.request_until(method, payload, Instant::now() + self.timeout)
    }
    pub fn export_diagnostics(&self) -> Result<Value, diagnostics::Error> {
        self.control
            .journal
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .export()
            .map_err(|_| diagnostics::Error::new("diagnostic_io", "", "diagnostics"))
    }
    pub fn record_diagnostic(&self, error: &diagnostics::Error, source: &str) {
        if let Some(journal) = self.control.journal.lock().unwrap().as_ref() {
            let _ = journal.record(error, source, "failure");
        }
    }
    fn request_until(
        &self,
        method: &str,
        payload: Value,
        deadline: Instant,
    ) -> Result<Value, Error> {
        let request_id = diagnostics::request_id();
        self.request_inner(method, payload, deadline, &request_id)
            .map(|mut result| {
                if result["error"].is_object() {
                    let diagnostic = diagnostics::Error::from_value(&result["error"], &request_id);
                    self.record_diagnostic(&diagnostic, "rust");
                    result["error"] = json!(diagnostic);
                }
                result
            })
            .map_err(|mut error| {
                let stage = if error.code.contains("start") {
                    "start"
                } else if error.code.contains("write") {
                    "write"
                } else if error.code.contains("response") {
                    "response"
                } else if error.code.contains("host") {
                    "host"
                } else if error.code.contains("queue") {
                    "queue"
                } else {
                    "transport"
                };
                let safe = error.envelope();
                let diagnostic = diagnostics::Error::new(
                    &safe.code,
                    &request_id,
                    if error.diagnostic.is_some() {
                        &safe.stage
                    } else {
                        stage
                    },
                );
                self.record_diagnostic(&diagnostic, "rust");
                error.diagnostic = Some(Box::new(diagnostic));
                error
            })
    }
    fn request_inner(
        &self,
        method: &str,
        payload: Value,
        deadline: Instant,
        request_id: &str,
    ) -> Result<Value, Error> {
        let attempt = Arc::new(Attempt {
            id: self.next_id.fetch_add(1, Ordering::Relaxed),
            request_id: request_id.into(),
            deadline,
            stage: AtomicU8::new(QUEUED),
            cancelled: AtomicBool::new(false),
            progress: Mutex::new(None),
        });
        attempt.check(&self.control)?;
        let mut bytes =
            serde_json::to_vec(&json!({"id": attempt.id, "requestId":request_id, "method": method, "payload": payload}))
                .map_err(|e| Error::new("bridge_protocol", e.to_string()))?;
        if bytes.len() > REQUEST_LIMIT {
            return Err(Error::new(
                "bridge_request_size",
                "Demande trop volumineuse.",
            ));
        }
        bytes.push(b'\n');
        attempt.check(&self.control)?;
        let (reply, response) = mpsc::sync_channel(1);
        self.control.pending.fetch_add(1, Ordering::AcqRel);
        if let Err(error) = self.sender.try_send(Operation {
            attempt: attempt.clone(),
            bytes,
            reply,
        }) {
            self.control.pending.fetch_sub(1, Ordering::AcqRel);
            return Err(match error {
                TrySendError::Full(_) => Error::new(
                    "bridge_queue_full",
                    "File du bridge pleine. La demande n’a pas été exécutée.",
                ),
                TrySendError::Disconnected(_) => {
                    Error::new("bridge_stopped", "Le bridge est indisponible.")
                }
            });
        }
        match response.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
            Ok(result) if Instant::now() < deadline => result,
            Ok(_) | Err(RecvTimeoutError::Timeout) => {
                self.control.cancel(&attempt);
                let error = attempt.timeout();
                attempt.partial(&error).ok_or(error)
            }
            Err(RecvTimeoutError::Disconnected) => {
                Err(Error::new("bridge_stopped", "Le bridge est indisponible."))
            }
        }
    }
    pub fn restart(&self) {
        self.control.interrupt();
    }
    pub fn shutdown(&self) {
        self.control.stopped.store(true, Ordering::Release);
        self.control.interrupt();
    }
    pub fn is_stopped(&self) -> bool {
        self.control.stopped.load(Ordering::Acquire)
    }
    pub fn is_idle(&self) -> bool {
        self.control.pending.load(Ordering::Acquire) == 0
    }
    pub fn has_started(&self) -> bool {
        self.control.started.load(Ordering::Acquire)
    }
}
impl Drop for Bridge {
    fn drop(&mut self) {
        // Exit never joins an actor that might be inside a native effect.
        self.shutdown();
    }
}

fn run_actor(config: Config, receiver: Receiver<Operation>, control: Arc<Control>) {
    let mut worker: Option<Worker> = None;
    loop {
        if control.stopped.load(Ordering::Acquire) {
            while let Ok(operation) = receiver.try_recv() {
                let _ = operation
                    .reply
                    .send(Err(Error::new("bridge_stopped", "Le bridge est arrêté.")));
                control.pending.fetch_sub(1, Ordering::AcqRel);
            }
            break;
        }
        let operation = match receiver.recv_timeout(Duration::from_millis(100)) {
            Ok(operation) => operation,
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => break,
        };
        let attempt = &operation.attempt;
        let result = (|| {
            // Registration and cancellation agree under one short lock.
            {
                let mut state = control.state.lock().unwrap_or_else(|e| e.into_inner());
                attempt.check(&control)?;
                state.active = Some(attempt.clone());
            }
            if worker.is_some() {
                let mut state = control.state.lock().unwrap_or_else(|e| e.into_inner());
                let alive = !state.invalidated
                    && state
                        .child
                        .as_mut()
                        .is_some_and(|child| matches!(child.try_wait(), Ok(None)));
                drop(state);
                if !alive {
                    worker = None;
                }
            }
            if worker.is_none() {
                attempt.stage.store(STARTING, Ordering::Release);
                worker = Some(Worker::start(&config, control.clone(), attempt)?);
                control.started.store(true, Ordering::Release);
            }
            worker
                .as_mut()
                .unwrap()
                .execute(&operation, &config.catalogue)
        })();
        // Retire the entire stream on any transport fault. A late reply can
        // never satisfy a later request. A sidecar application error is final.
        if result
            .as_ref()
            .is_err_and(|error| error.code != "sidecar_error")
            && !matches!(attempt.stage.load(Ordering::Acquire), QUEUED)
        {
            worker = None;
        }
        control
            .state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .active = None;
        let result = match result {
            Err(error) => attempt.partial(&error).ok_or(error),
            result => result,
        };
        let _ = operation.reply.send(result);
        control.pending.fetch_sub(1, Ordering::AcqRel);
    }
    drop(worker);
}

#[cfg(windows)]
struct ProcessJob(windows_sys::Win32::Foundation::HANDLE);
#[cfg(windows)]
unsafe impl Send for ProcessJob {}
#[cfg(windows)]
impl Drop for ProcessJob {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.0);
        }
    }
}
#[cfg(windows)]
fn supervise(child: &Child) -> Result<ProcessJob, Error> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::System::JobObjects::*;
    unsafe {
        let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if handle.is_null() {
            return Err(Error::new(
                "bridge_start",
                "Impossible de superviser le sidecar.",
            ));
        }
        let job = ProcessJob(handle);
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if SetInformationJobObject(
            handle,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const _,
            std::mem::size_of_val(&info) as u32,
        ) == 0
            || AssignProcessToJobObject(handle, child.as_raw_handle()) == 0
        {
            return Err(Error::new(
                "bridge_start",
                "Impossible de superviser le sidecar.",
            ));
        }
        Ok(job)
    }
}

struct Worker {
    stdin: ChildStdin,
    replies: Option<Receiver<Result<Value, Error>>>,
    reader: Option<JoinHandle<()>>,
    stderr_reader: Option<JoinHandle<()>>,
    control: Arc<Control>,
}
impl Worker {
    fn start(config: &Config, control: Arc<Control>, attempt: &Attempt) -> Result<Self, Error> {
        attempt.check(&control)?;
        if !config.node.is_file() || !config.script.is_file() {
            return Err(Error::new(
                "bridge_start",
                "Le runtime embarqué est absent. Préparez les ressources avant de compiler PAM.",
            ));
        }
        std::fs::create_dir_all(&config.profile)
            .map_err(|e| Error::new("bridge_start", e.to_string()))?;
        let mut command = Command::new(&config.node);
        command
            .arg(&config.script)
            .arg(&config.runtime)
            .arg(&config.profile)
            .env_remove("NODE_OPTIONS")
            .env_remove("NODE_PATH")
            .env("NEEDLE_TELEMETRY", "0")
            .env("DO_NOT_TRACK", "1")
            .env("PAM_LAUNCH_HOST", "1")
            .env(
                "PAM_NATIVE_EXE",
                std::env::current_exe().map_err(|e| Error::new("bridge_start", e.to_string()))?,
            )
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut child = command.spawn().map_err(|e| {
            Error::new(
                "bridge_start",
                format!("Impossible de démarrer Node embarqué : {e}"),
            )
        })?;
        #[cfg(windows)]
        let job = match supervise(&child) {
            Ok(job) => job,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
        };
        // Command's piped handles exist; guard even unexpected handle failure.
        let (Some(stdin), Some(stdout)) = (child.stdin.take(), child.stdout.take()) else {
            let _ = child.kill();
            let _ = child.wait();
            return Err(Error::new("bridge_start", "Pipes du sidecar absents."));
        };
        let stderr_reader = if let Some(mut stderr) = child.stderr.take() {
            let stderr_control = control.clone();
            Some(thread::spawn(move || {
                let mut bytes = [0u8; 4096];
                while let Ok(count) = stderr.read(&mut bytes) {
                    if count == 0 {
                        break;
                    }
                    let id = stderr_control
                        .state
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .active
                        .as_ref()
                        .map(|a| a.request_id.clone())
                        .unwrap_or_default();
                    if let Some(journal) = stderr_control
                        .journal
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .as_ref()
                    {
                        let _ = journal.record(
                            &diagnostics::Error::new("sidecar_stderr", &id, "sidecar"),
                            "node",
                            "stderr",
                        );
                    }
                    // Raw bytes are intentionally discarded, without decoding.
                }
            }))
        } else {
            None
        };
        {
            let mut state = control.state.lock().unwrap_or_else(|e| e.into_inner());
            if let Err(error) = attempt.check(&control) {
                drop(state);
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
            state.child = Some(child);
            state.invalidated = false;
            #[cfg(windows)]
            {
                state.job = Some(job);
            }
        }
        let (sender, replies) = mpsc::sync_channel(1);
        let mut worker = Self {
            stdin,
            replies: Some(replies),
            reader: None,
            stderr_reader,
            control,
        };
        worker.reader = Some(
            thread::Builder::new()
                .name("pam-bridge-stdout".into())
                .spawn(move || {
                    let mut reader = BufReader::new(stdout);
                    loop {
                        let mut line = String::new();
                        let response = match reader
                            .by_ref()
                            .take(RESPONSE_LIMIT + 1)
                            .read_line(&mut line)
                        {
                            Ok(0) => Err(Error::new(
                                "bridge_eof",
                                "Le sidecar a fermé sa sortie (EOF).",
                            )),
                            Ok(_)
                                if line.len() as u64 <= RESPONSE_LIMIT && line.ends_with('\n') =>
                            {
                                serde_json::from_str(&line).map_err(|_| {
                                    Error::new("bridge_protocol", "Réponse du sidecar invalide.")
                                })
                            }
                            _ => Err(Error::new(
                                "bridge_protocol",
                                "Lecture interrompue ou réponse trop volumineuse.",
                            )),
                        };
                        let failed = response.is_err();
                        if sender.send(response).is_err() || failed {
                            break;
                        }
                    }
                })
                .map_err(|e| Error::new("bridge_start", e.to_string()))?,
        );
        Ok(worker)
    }
    fn write(&mut self, bytes: &[u8], attempt: &Attempt) -> Result<(), Error> {
        attempt.stage.store(WRITING, Ordering::Release);
        attempt.check(&self.control)?;
        if let Err(error) = self.stdin.write_all(bytes) {
            attempt.check(&self.control)?;
            return Err(Error::new(
                "bridge_pipe",
                format!("Écriture du sidecar interrompue : {error}"),
            ));
        }
        attempt.check(&self.control)
    }
    fn execute(&mut self, operation: &Operation, catalogue: &Catalogue) -> Result<Value, Error> {
        let attempt = &operation.attempt;
        // Queueing/startup already consumed part of the admission deadline.
        // Send the current remainder, with room for the final report.
        let remaining = attempt
            .deadline
            .saturating_duration_since(Instant::now())
            .as_millis() as u64;
        let mut request: Value = serde_json::from_slice(&operation.bytes)
            .map_err(|e| Error::new("bridge_protocol", e.to_string()))?;
        let remaining = remaining.saturating_sub(remaining.min(1_000) / 2);
        request["remainingMs"] = json!(remaining);
        request["deadlineUnixMs"] = json!(
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|e| Error::new("bridge_protocol", e.to_string()))?
                .as_millis()
                + remaining as u128
        );
        let mut bytes = serde_json::to_vec(&request)
            .map_err(|e| Error::new("bridge_protocol", e.to_string()))?;
        bytes.push(b'\n');
        self.write(&bytes, attempt)?;
        let mut executed = HashSet::new();
        loop {
            attempt.stage.store(RESPONSE, Ordering::Release);
            attempt.check(&self.control)?;
            let response = match self
                .replies
                .as_ref()
                .unwrap()
                .recv_timeout(attempt.deadline.saturating_duration_since(Instant::now()))
            {
                Ok(response) => {
                    attempt.check(&self.control)?;
                    response?
                }
                Err(RecvTimeoutError::Timeout) => return Err(attempt.timeout()),
                Err(RecvTimeoutError::Disconnected) => {
                    return Err(Error::new(
                        "bridge_eof",
                        "La sortie du sidecar est fermée (EOF).",
                    ))
                }
            };
            if response["type"] == "diagnostic" {
                if response["id"] != attempt.id {
                    return Err(Error::new(
                        "bridge_protocol",
                        "Diagnostic d’une autre demande.",
                    ));
                }
                let error = diagnostics::Error::from_value(&response["error"], &attempt.request_id);
                if let Some(journal) = self.control.journal.lock().unwrap().as_ref() {
                    let _ = journal.record(&error, "node", "failure");
                }
                continue;
            }
            if response["type"] == "turn_progress" {
                if response["id"] != attempt.id || !valid_progress(&response["turn"]) {
                    return Err(Error::new(
                        "bridge_protocol",
                        "Progression d’exécution invalide.",
                    ));
                }
                *attempt.progress.lock().unwrap_or_else(|e| e.into_inner()) =
                    Some(response["turn"].clone());
                continue;
            }
            if response["type"] != "host_request" {
                if response["id"] != attempt.id {
                    return Err(Error::new(
                        "bridge_protocol",
                        "Réponse d’une autre demande.",
                    ));
                }
                return if response["ok"] == true {
                    Ok(response["result"].clone())
                } else {
                    let diagnostic =
                        diagnostics::Error::from_value(&response["error"], &attempt.request_id);
                    let mut error = Error::new("sidecar_error", diagnostic.message.clone());
                    error.diagnostic = Some(Box::new(diagnostic));
                    Err(error)
                };
            }
            let id = response["id"]
                .as_str()
                .ok_or_else(|| Error::new("bridge_protocol", "Identifiant de lancement absent."))?;
            if id.len() != 36
                || !id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
                || executed.len() >= 32
                || !executed.insert(id.to_owned())
            {
                return Err(Error::new(
                    "bridge_protocol",
                    "Demande de lancement dupliquée ou invalide.",
                ));
            }
            attempt.stage.store(HOST_EFFECT, Ordering::Release);
            attempt.check(&self.control)?;
            if response["remainingMs"].as_u64() == Some(0) {
                return Err(Error::new(
                    "bridge_host_timeout",
                    "Budget épuisé avant effet natif.",
                ));
            }
            let result = launch::handle(
                response["method"].as_str().unwrap_or(""),
                &response["payload"],
                catalogue,
            );
            attempt.check(&self.control)?;
            let reply = match result {
                Ok(result) => json!({"type":"host_response","id":id,"ok":true,"result":result}),
                Err(text) => {
                    let missing = response["payload"]["executable"]
                        .as_str()
                        .is_some_and(|p| !std::path::Path::new(p).is_file())
                        || text.contains("absente du catalogue");
                    let error = diagnostics::Error::new(
                        if missing {
                            "target_missing"
                        } else {
                            "action_failure"
                        },
                        &attempt.request_id,
                        "host",
                    );
                    if let Some(journal) = self.control.journal.lock().unwrap().as_ref() {
                        let _ = journal.record(&error, "rust", "failure");
                    }
                    json!({"type":"host_response","id":id,"ok":false,"error":error})
                }
            };
            let mut bytes = serde_json::to_vec(&reply)
                .map_err(|e| Error::new("bridge_protocol", e.to_string()))?;
            bytes.push(b'\n');
            self.write(&bytes, attempt)?;
        }
    }
}
fn valid_progress(turn: &Value) -> bool {
    turn["id"]
        .as_str()
        .is_some_and(|id| id.len() == 36 && id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-'))
        && turn["calls"]
            .as_array()
            .is_some_and(|calls| !calls.is_empty() && calls.len() <= 8)
        && turn["results"].as_array().is_some_and(|results| {
            results.len() == turn["calls"].as_array().unwrap().len()
                && results.iter().all(|result| {
                    matches!(
                        result["outcome"].as_str(),
                        Some("not_started" | "performed" | "failed" | "unknown")
                    )
                })
        })
}
impl Drop for Worker {
    fn drop(&mut self) {
        let mut state = self.control.state.lock().unwrap_or_else(|e| e.into_inner());
        let child = state.child.take();
        #[cfg(windows)]
        let job = state.job.take();
        drop(state);
        #[cfg(windows)]
        drop(job); // Close inherited pipes in internal children before joining.
        if let Some(mut child) = child {
            let _ = child.kill();
            let _ = child.wait();
        }
        drop(self.replies.take()); // Unblock a bounded stdout sender before joining.
        if let Some(reader) = self.reader.take() {
            let _ = reader.join();
        }
        if let Some(reader) = self.stderr_reader.take() {
            let _ = reader.join();
        }
    }
}

#[cfg(all(test, windows))]
#[path = "bridge_tests.rs"]
mod tests;
