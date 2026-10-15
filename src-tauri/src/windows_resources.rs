//! Thread-bound COM/WinRT initialization. Guards must outlive all interfaces.
use std::{marker::PhantomData, rc::Rc};
use windows::Win32::System::{
    Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED},
    WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED},
};

enum Kind {
    Com,
    Winrt,
}
pub(crate) struct Apartment {
    kind: Kind,
    // COM initialization is per OS thread; moving this guard would uninitialize
    // the wrong thread. Rc's marker makes the guard neither Send nor Sync.
    _thread: PhantomData<Rc<()>>,
}
impl Apartment {
    pub fn sta() -> windows::core::Result<Self> {
        // SAFETY: no reserved pointer is provided. Both S_OK and S_FALSE acquire
        // one initialization count on this thread; failure creates no guard.
        unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.ok()?;
        Ok(Self {
            kind: Kind::Com,
            _thread: PhantomData,
        })
    }
    pub fn mta() -> windows::core::Result<Self> {
        // SAFETY: initialize WinRT on the calling thread. Successful nested
        // initialization also needs exactly one matching RoUninitialize.
        unsafe { RoInitialize(RO_INIT_MULTITHREADED) }?;
        Ok(Self {
            kind: Kind::Winrt,
            _thread: PhantomData,
        })
    }
}
impl Drop for Apartment {
    fn drop(&mut self) {
        // SAFETY: construction succeeded once, the !Send/!Sync guard remains on
        // that same thread, and drop executes once, after locally held interfaces.
        unsafe {
            match self.kind {
                Kind::Com => CoUninitialize(),
                Kind::Winrt => RoUninitialize(),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn early_errors_and_nested_initialization_balance_apartments() {
        std::thread::spawn(|| {
            let failure = || -> windows::core::Result<()> {
                let _outer = Apartment::sta()?;
                let _nested = Apartment::sta()?;
                Err(windows::core::Error::from_hresult(windows::core::HRESULT(
                    0x80004005u32 as i32,
                )))
            };
            assert!(failure().is_err());
            // Switching to MTA succeeds only after BOTH STA counts were released.
            let _mta = Apartment::mta().unwrap();
            assert!(Apartment::sta().is_err()); // failure must not uninitialize MTA
            let _nested = Apartment::mta().unwrap();
        })
        .join()
        .unwrap();
    }
}
