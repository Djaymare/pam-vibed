//! Replaceable process, clock and transport boundaries; no pipe lock or IPC types.
use std::{
    io,
    process::{Child, Command, ExitStatus},
    time::{Duration, Instant},
};

pub(crate) trait Process: Send {
    fn try_wait(&mut self) -> io::Result<Option<ExitStatus>>;
    fn kill(&mut self) -> io::Result<()>;
    fn wait(&mut self) -> io::Result<ExitStatus>;
}
impl Process for Child {
    fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
        Child::try_wait(self)
    }
    fn kill(&mut self) -> io::Result<()> {
        Child::kill(self)
    }
    fn wait(&mut self) -> io::Result<ExitStatus> {
        Child::wait(self)
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
    fn sleep(&self, duration: Duration);
}
pub(crate) struct SystemClock;
impl Clock for SystemClock {
    fn now(&self) -> Instant {
        Instant::now()
    }
    fn sleep(&self, duration: Duration) {
        std::thread::sleep(duration);
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
        let _ = self.inner.wait();
    }
}

pub(crate) trait Transport {
    fn stopped(&self) -> bool;
    fn idle(&self) -> bool;
    fn started(&self) -> bool;
    fn probe(&self);
}
pub(crate) fn monitor_tick(transport: &impl Transport) -> bool {
    if transport.stopped() {
        return false;
    }
    if transport.idle() && transport.started() {
        transport.probe();
    }
    true
}
pub(crate) fn monitor(clock: &dyn Clock, mut tick: impl FnMut() -> bool) {
    loop {
        clock.sleep(Duration::from_secs(15));
        if !tick() {
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    };
    struct FakeProcess(Arc<Mutex<Vec<&'static str>>>);
    impl Process for FakeProcess {
        fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
            Ok(None)
        }
        fn kill(&mut self) -> io::Result<()> {
            self.0.lock().unwrap().push("kill");
            Err(io::Error::other("already exited"))
        }
        fn wait(&mut self) -> io::Result<ExitStatus> {
            self.0.lock().unwrap().push("wait");
            Err(io::Error::other("fixture"))
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
        assert_eq!(*calls.lock().unwrap(), ["kill", "wait"]);
    }
    struct FakeTransport {
        stopped: bool,
        idle: bool,
        started: bool,
        probes: AtomicUsize,
    }
    impl Transport for FakeTransport {
        fn stopped(&self) -> bool {
            self.stopped
        }
        fn idle(&self) -> bool {
            self.idle
        }
        fn started(&self) -> bool {
            self.started
        }
        fn probe(&self) {
            self.probes.fetch_add(1, Ordering::Relaxed);
        }
    }
    #[test]
    fn supervisor_probes_only_started_idle_transport_and_stops() {
        for stopped in [false, true] {
            for idle in [false, true] {
                for started in [false, true] {
                    let t = FakeTransport {
                        stopped,
                        idle,
                        started,
                        probes: AtomicUsize::new(0),
                    };
                    assert_eq!(monitor_tick(&t), !stopped);
                    assert_eq!(
                        t.probes.load(Ordering::Relaxed),
                        usize::from(!stopped && idle && started)
                    );
                }
            }
        }
    }
    struct FakeClock(AtomicUsize);
    impl Clock for FakeClock {
        fn now(&self) -> Instant {
            Instant::now()
        }
        fn sleep(&self, duration: Duration) {
            assert_eq!(duration, Duration::from_secs(15));
            self.0.fetch_add(1, Ordering::Relaxed);
        }
    }
    #[test]
    fn monitor_uses_injected_clock_without_waiting() {
        let clock = FakeClock(AtomicUsize::new(0));
        let mut ticks = 0;
        monitor(&clock, || {
            ticks += 1;
            ticks < 3
        });
        assert_eq!(ticks, 3);
        assert_eq!(clock.0.load(Ordering::Relaxed), 3);
    }
}
