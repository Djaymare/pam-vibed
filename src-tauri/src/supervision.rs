//! Replaceable process, clock and transport boundaries; no pipe lock or IPC types.
use std::{
    io,
    process::{Child, Command, ExitStatus},
    time::{Duration, Instant},
};

pub(crate) trait Process: Send {
    fn try_wait(&mut self) -> io::Result<Option<ExitStatus>>;
    fn kill(&mut self) -> io::Result<()>;
}
impl Process for Child {
    fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
        Child::try_wait(self)
    }
    fn kill(&mut self) -> io::Result<()> {
        Child::kill(self)
    }
}
pub(crate) trait ProcessFactory: Send + Sync {
    fn spawn(&self, command: &mut Command) -> io::Result<Child>;
}
pub(crate) struct SystemProcess;
impl ProcessFactory for SystemProcess {
    fn spawn(&self, command: &mut Command) -> io::Result<Child> {
        command.spawn()
    }
}
pub(crate) trait Clock: Send + Sync {
    fn now(&self) -> Instant;
}
pub(crate) struct SystemClock;
impl Clock for SystemClock {
    fn now(&self) -> Instant {
        Instant::now()
    }
}
pub(crate) struct OwnedProcess<P: Process = Child> {
    pub inner: P,
    #[cfg(windows)]
    job: Option<crate::job::Job>,
}
impl OwnedProcess<Child> {
    pub fn supervise(child: Child) -> io::Result<Self> {
        // Own the child before fallible job setup, so assignment failure also
        // terminates/reaps it. Ownership is transferred to the actor only later.
        let mut owned = Self {
            inner: child,
            #[cfg(windows)]
            job: None,
        };
        #[cfg(windows)]
        {
            owned.job = Some(crate::job::Job::attach(&owned.inner)?);
        }
        Ok(owned)
    }
}
impl<P: Process> OwnedProcess<P> {
    pub fn terminate(&mut self) {
        #[cfg(windows)]
        if let Some(job) = &self.job {
            job.terminate();
        }
        let _ = self.inner.kill();
    }
    pub fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
        self.inner.try_wait()
    }
}
impl<P: Process> Drop for OwnedProcess<P> {
    fn drop(&mut self) {
        #[cfg(windows)]
        drop(self.job.take()); // release descendant pipe handles before joins
        let _ = self.inner.kill();
        // Never wait indefinitely for a misbehaving process implementation.
        let deadline = Instant::now() + Duration::from_millis(500);
        while matches!(self.inner.try_wait(), Ok(None)) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(5));
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Phase {
    Starting,
    Ready,
    Recovering,
    Stopping,
    Stopped,
}

/// Pure policy; the transport actor is the only process/monitor owner.
pub(crate) struct Lifecycle {
    pub phase: Phase,
    failures: u32,
    pub retry_at: Option<Instant>,
    healthy_since: Option<Instant>,
}
impl Default for Lifecycle {
    fn default() -> Self {
        Self {
            phase: Phase::Starting,
            failures: 0,
            retry_at: None,
            healthy_since: None,
        }
    }
}
impl Lifecycle {
    pub fn begin(&mut self, now: Instant) -> bool {
        if matches!(self.phase, Phase::Stopping | Phase::Stopped)
            || self.retry_at.is_some_and(|at| now < at)
        {
            return false;
        }
        self.phase = Phase::Starting;
        self.healthy_since = None;
        true
    }
    pub fn failed(&mut self, now: Instant) {
        if matches!(self.phase, Phase::Stopping | Phase::Stopped) {
            return;
        }
        self.failures = self.failures.saturating_add(1);
        let seconds = (1u64 << self.failures.saturating_sub(1).min(6)).min(60);
        self.retry_at = Some(now + Duration::from_secs(seconds));
        self.healthy_since = None;
        self.phase = Phase::Recovering;
    }
    pub fn healthy(&mut self, now: Instant) {
        if matches!(self.phase, Phase::Stopping | Phase::Stopped) {
            return;
        }
        let since = *self.healthy_since.get_or_insert(now);
        if now.saturating_duration_since(since) >= Duration::from_secs(60) {
            self.failures = 0;
        }
        self.retry_at = None;
        self.phase = Phase::Ready;
    }
    pub fn stop(&mut self) {
        if self.phase != Phase::Stopped {
            self.phase = Phase::Stopping;
        }
    }
    pub fn stopped(&mut self) {
        self.phase = Phase::Stopped;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    struct FakeProcess(Arc<Mutex<Vec<&'static str>>>);
    impl Process for FakeProcess {
        fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
            self.0.lock().unwrap().push("reap");
            Err(io::Error::other("fixture"))
        }
        fn kill(&mut self) -> io::Result<()> {
            self.0.lock().unwrap().push("kill");
            Err(io::Error::other("already exited"))
        }
    }
    #[test]
    fn early_error_reaps_even_when_kill_fails() {
        let calls = Arc::new(Mutex::new(Vec::new()));
        let attempt = || -> io::Result<()> {
            let _owned = OwnedProcess {
                inner: FakeProcess(calls.clone()),
                #[cfg(windows)]
                job: None,
            };
            Err(io::Error::other("pipe setup failed"))
        };
        assert!(attempt().is_err());
        assert_eq!(*calls.lock().unwrap(), ["kill", "reap"]);
    }
    #[test]
    fn repeated_failures_back_off_and_stable_health_resets_the_delay() {
        let mut now = Instant::now();
        let mut lifecycle = Lifecycle::default();
        for seconds in [1, 2, 4, 8, 16, 32, 60, 60, 60] {
            assert!(lifecycle.begin(now));
            lifecycle.failed(now);
            assert_eq!(lifecycle.phase, Phase::Recovering);
            assert!(!lifecycle.begin(now + Duration::from_millis(999)));
            now += Duration::from_secs(seconds);
            assert_eq!(lifecycle.retry_at, Some(now));
        }
        assert!(lifecycle.begin(now));
        lifecycle.healthy(now);
        lifecycle.healthy(now + Duration::from_secs(59));
        lifecycle.failed(now + Duration::from_secs(59));
        assert_eq!(lifecycle.failures, 10); // a brief success never resets it
        now += Duration::from_secs(119);
        assert!(lifecycle.begin(now));
        lifecycle.healthy(now);
        now += Duration::from_secs(60);
        lifecycle.healthy(now);
        lifecycle.failed(now);
        assert_eq!(lifecycle.retry_at, Some(now + Duration::from_secs(1)));
    }
    #[test]
    fn stopping_is_terminal_even_after_late_success_or_failure() {
        let now = Instant::now();
        let mut lifecycle = Lifecycle::default();
        lifecycle.stop();
        lifecycle.healthy(now);
        lifecycle.failed(now);
        assert_eq!(lifecycle.phase, Phase::Stopping);
        assert!(!lifecycle.begin(now + Duration::from_secs(600)));
        lifecycle.stopped();
        lifecycle.stop();
        assert_eq!(lifecycle.phase, Phase::Stopped);
        assert!(!lifecycle.begin(now + Duration::from_secs(600)));
    }
}
