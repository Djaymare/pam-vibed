//! Own the sidecar job only. User applications are launched outside this job.
use std::{
    io,
    os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle},
    process::Child,
};
use windows_sys::Win32::System::JobObjects::*;

pub(crate) struct Job(OwnedHandle);
impl Job {
    pub fn attach(child: &Child) -> io::Result<Self> {
        // SAFETY: null security attributes/name request a new unnamed job. The
        // returned non-null handle is owned by this call, never borrowed.
        let raw = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if raw.is_null() {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: CreateJobObjectW succeeded; exactly one OwnedHandle takes
        // ownership. It closes on every error below and is Send/Sync by std.
        let job = Self(unsafe { OwnedHandle::from_raw_handle(raw) });
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        // SAFETY: the job and child are live owners throughout these synchronous
        // calls. info is initialized, correctly aligned, with its exact size;
        // Windows copies it and retains neither the pointer nor the child borrow.
        let configured = unsafe {
            SetInformationJobObject(
                job.0.as_raw_handle(),
                JobObjectExtendedLimitInformation,
                (&info as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                std::mem::size_of_val(&info) as u32,
            )
        };
        if configured == 0 {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: both handles remain owned and live for this call. Assignment
        // does not transfer ownership of either handle.
        if unsafe { AssignProcessToJobObject(job.0.as_raw_handle(), child.as_raw_handle()) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(job)
    }
    pub fn terminate(&self) {
        // SAFETY: self owns a valid job handle until the call completes. The
        // operation terminates only assigned internal processes, no raw memory.
        unsafe {
            TerminateJobObject(self.0.as_raw_handle(), 70);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        process::{Command, Stdio},
        time::{Duration, Instant},
    };
    #[test]
    fn early_return_closes_job_and_terminates_its_fixture_child() {
        let node = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("binaries/pam-node-x86_64-pc-windows-msvc.exe");
        use std::os::windows::process::CommandExt;
        let mut child = Command::new(node)
            .args(["-e", "setInterval(()=>{},1000)"])
            .creation_flags(0x08000000)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let outcome = (|| -> io::Result<()> {
            let _job = Job::attach(&child)?;
            Err(io::Error::other(
                "fixture setup failed after job assignment",
            ))
        })();
        assert!(outcome.is_err());
        let deadline = Instant::now() + Duration::from_secs(5);
        let terminated = loop {
            if child.try_wait().unwrap().is_some() {
                break true;
            }
            if Instant::now() >= deadline {
                break false;
            }
            std::thread::sleep(Duration::from_millis(5));
        };
        // Always reap the disposable child, even when the assertion fails.
        let _ = child.kill();
        let _ = child.wait();
        assert!(
            terminated,
            "closing the job on an error must kill its internal child"
        );
    }
}
