use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    io::{Read, Write},
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};

const LIMIT: u64 = 64 * 1024;
const RETENTION: u64 = 7 * 24 * 60 * 60;
static SERIAL: AtomicU64 = AtomicU64::new(1);
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
pub fn request_id() -> String {
    format!(
        "pam-{}-{}-{}",
        now(),
        std::process::id(),
        SERIAL.fetch_add(1, Ordering::Relaxed)
    )
}
fn catalog() -> Value {
    serde_json::from_str(include_str!("../../sidecar/error-catalog.json"))
        .expect("static error catalog")
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Error {
    pub code: String,
    pub stage: String,
    pub request_id: String,
    pub retryable: bool,
    pub message: String,
    pub technical: Box<Value>,
}
impl Error {
    pub fn new(code: &str, id: &str, stage: &str) -> Self {
        let catalog = catalog();
        let code = if catalog[code].is_object() {
            code
        } else {
            "invalid_request"
        };
        let entry = &catalog[code];
        let stage = if matches!(
            stage,
            "inference"
                | "transcription"
                | "microphone"
                | "target"
                | "transport"
                | "queue"
                | "profile"
                | "validation"
                | "sidecar"
                | "diagnostics"
                | "start"
                | "write"
                | "response"
                | "host"
        ) {
            stage
        } else {
            entry["stage"].as_str().unwrap()
        };
        let parts: Vec<_> = id.split('-').collect();
        let valid_id = (parts.len() == 4
            && parts[0] == "pam"
            && parts[1..]
                .iter()
                .all(|p| !p.is_empty() && p.len() <= 20 && p.bytes().all(|b| b.is_ascii_digit())))
            || (parts.iter().map(|p| p.len()).collect::<Vec<_>>() == [8, 4, 4, 4, 12]
                && id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-'));
        let id = if valid_id {
            id.to_owned()
        } else {
            request_id()
        };
        Self {
            code: code.into(),
            stage: stage.into(),
            request_id: id,
            retryable: entry["retryable"].as_bool().unwrap(),
            message: entry["message"].as_str().unwrap().into(),
            technical: Box::new(json!({"category":code})),
        }
    }
    pub fn from_value(value: &Value, id: &str) -> Self {
        Self::new(
            value["code"].as_str().unwrap_or("invalid_request"),
            id,
            value["stage"].as_str().unwrap_or(""),
        )
    }
}

// One in-process lock covers rotation, writing and export. Fixed names and a
// closed schema keep personal paths and arbitrary stderr out of every file.
pub struct Journal {
    directory: PathBuf,
    lock: Mutex<()>,
}
impl Journal {
    pub fn new(profile: PathBuf) -> Self {
        Self {
            directory: profile.join("diagnostics"),
            lock: Mutex::new(()),
        }
    }
    fn file(&self, index: usize) -> PathBuf {
        self.directory.join(format!("events-{index}.jsonl"))
    }
    fn prepare(&self) -> std::io::Result<()> {
        fs::create_dir_all(&self.directory)?;
        if fs::symlink_metadata(&self.directory)?
            .file_type()
            .is_symlink()
        {
            return Err(std::io::Error::other("diagnostic directory link"));
        }
        for index in 0..3 {
            let path = self.file(index);
            match fs::symlink_metadata(&path) {
                Ok(meta) => {
                    if !meta.is_file() || meta.file_type().is_symlink() {
                        return Err(std::io::Error::other("diagnostic file link"));
                    }
                    let mut prefix = String::new();
                    use std::io::BufRead;
                    std::io::BufReader::new(fs::File::open(&path)?.take(2048))
                        .read_line(&mut prefix)?;
                    let oldest = serde_json::from_str::<Value>(&prefix)
                        .ok()
                        .and_then(|v| v["time"].as_u64())
                        .unwrap_or(0);
                    if meta.len() > LIMIT
                        || (meta.len() > 0 && now().saturating_sub(oldest) > RETENTION)
                        || now().saturating_sub(
                            meta.modified()?
                                .duration_since(UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_secs(),
                        ) > RETENTION
                    {
                        fs::remove_file(path)?;
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(e),
            }
        }
        Ok(())
    }
    pub fn record(&self, error: &Error, source: &str, event: &str) -> std::io::Result<()> {
        let _lock = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        self.prepare()?;
        let safe = Error::new(&error.code, &error.request_id, &error.stage);
        let source = if matches!(source, "rust" | "node" | "webview") {
            source
        } else {
            "rust"
        };
        let event = if matches!(event, "failure" | "stderr" | "request" | "complete") {
            event
        } else {
            "failure"
        };
        let line = format!(
            "{}\n",
            json!({"time":now(),"source":source,"event":event,"error":safe})
        );
        if fs::metadata(self.file(0)).map(|m| m.len()).unwrap_or(0) + line.len() as u64 > LIMIT {
            if self.file(2).exists() {
                fs::remove_file(self.file(2))?;
            }
            for index in (0..2).rev() {
                if self.file(index).exists() {
                    fs::rename(self.file(index), self.file(index + 1))?;
                }
            }
        }
        fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.file(0))?
            .write_all(line.as_bytes())
    }
    pub fn export(&self) -> std::io::Result<Value> {
        let _lock = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        self.prepare()?;
        let mut events = Vec::new();
        for index in (0..3).rev() {
            if !self.file(index).exists() {
                continue;
            }
            let mut content = String::new();
            fs::File::open(self.file(index))?
                .take(LIMIT)
                .read_to_string(&mut content)?;
            for line in content.lines() {
                if let Ok(value) = serde_json::from_str::<Value>(line) {
                    // Reconstruct, even if an old/tampered file contains extra keys.
                    let error = Error::from_value(
                        &value["error"],
                        value["error"]["requestId"].as_str().unwrap_or(""),
                    );
                    let source = value["source"]
                        .as_str()
                        .filter(|s| matches!(*s, "rust" | "node" | "webview"))
                        .unwrap_or("rust");
                    let event = value["event"]
                        .as_str()
                        .filter(|s| matches!(*s, "failure" | "stderr" | "request" | "complete"))
                        .unwrap_or("failure");
                    events.push(json!({"time":value["time"].as_u64().unwrap_or(0),"source":source,"event":event,"error":error}));
                }
            }
        }
        Ok(json!({"format":1,"retentionDays":7,"maxLocalBytes":3*LIMIT,"events":events}))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_rotation_and_export_remove_sensitive_sentinels() {
        let profile = std::env::temp_dir().join(request_id());
        fs::create_dir(&profile).unwrap();
        let journal = Journal::new(profile.clone());
        let secret = "SENTINEL_AUDIO_TRANSCRIPT_ARGUMENT_C:\\Users\\Private";
        let bad = json!({"code":"model_failure","stage":secret,"message":secret,"technical":secret,"audio":secret});
        let error = Error::from_value(&bad, "pam-test-1");
        for _ in 0..1200 {
            journal.record(&error, secret, secret).unwrap();
        }
        assert!(journal.file(2).exists());
        for index in 0..3 {
            let content = fs::read_to_string(journal.file(index)).unwrap();
            assert!(content.len() as u64 <= LIMIT);
            assert!(!content.contains(secret));
        }
        let tampered = json!({"time":now(),"source":secret,"event":secret,"error":{ "requestId":secret, "code":"model_failure", "message":secret },"transcript":secret});
        fs::write(journal.file(0), format!("{tampered}\n")).unwrap();
        let exported = journal.export().unwrap().to_string();
        assert!(!exported.contains(secret));
        assert!(exported.contains("model_failure"));
        fs::write(
            journal.file(0),
            format!(
                "{}\n",
                json!({"time":now()-RETENTION-1,"error":{"code":"model_failure"}})
            ),
        )
        .unwrap();
        journal.export().unwrap();
        assert!(!journal.file(0).exists());
        fs::write(journal.file(0), vec![b'x'; LIMIT as usize + 1]).unwrap();
        journal.export().unwrap();
        assert!(!journal.file(0).exists());
        fs::remove_dir_all(profile).unwrap();
    }
    #[test]
    fn families_have_actionable_separate_messages() {
        for code in [
            "model_failure",
            "microphone_denied",
            "target_missing",
            "request_timeout",
            "invalid_profile",
        ] {
            let error = Error::new(code, "pam-test", "");
            assert_eq!(error.code, code);
            assert!(!error.message.is_empty());
            assert_eq!(*error.technical, json!({"category":code}));
        }
    }
}
