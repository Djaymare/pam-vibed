//! Read-only Windows catalogue. All Shell interfaces remain in one STA.

use super::{IconScope, InstalledApplication};
use crate::windows_resources::Apartment;
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{
    collections::HashSet,
    mem::size_of,
    path::{Path, PathBuf},
};
use windows::{
    core::{Interface, Result, HSTRING, PWSTR},
    Win32::{
        Foundation::{PROPERTYKEY, SIZE},
        Graphics::Gdi::{
            DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO,
            BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP, HDC, HGDIOBJ,
        },
        System::Com::CoTaskMemFree,
        UI::Shell::{
            BHID_EnumItems, FOLDERID_AppsFolder, FOLDERID_CommonPrograms, FOLDERID_Programs,
            IEnumShellItems, IShellItem, IShellItem2, IShellItemImageFactory,
            PropertiesSystem::PSGetPropertyKeyFromName, SHCreateItemFromParsingName,
            SHGetKnownFolderItem, SHGetKnownFolderPath, KF_FLAG_DEFAULT, SIGDN_NORMALDISPLAY,
            SIIGBF_ICONONLY,
        },
    },
};

// These wrappers are private to this STA module. They are never returned,
// shared, or transferred to another thread.
struct Bitmap(HBITMAP);
impl Drop for Bitmap {
    fn drop(&mut self) {
        // SAFETY: GetImage returns a caller-owned HBITMAP. This is its only
        // owner, and no DC selects it. DeleteObject is called exactly once.
        unsafe {
            let _ = DeleteObject(HGDIOBJ(self.0 .0));
        }
    }
}
struct ScreenDc(HDC);
impl Drop for ScreenDc {
    fn drop(&mut self) {
        // SAFETY: this non-null DC came from GetDC(None) on this thread;
        // ReleaseDC uses the matching window and runs exactly once.
        unsafe {
            let _ = ReleaseDC(None, self.0);
        }
    }
}
struct TaskString(PWSTR);
impl Drop for TaskString {
    fn drop(&mut self) {
        // SAFETY: take_string accepts only caller-owned CoTaskMem strings.
        // There is one guard per successful pointer, including decode errors.
        unsafe {
            CoTaskMemFree(Some(self.0 .0.cast()));
        }
    }
}
/// # Safety
/// A successful value must be a NUL-terminated UTF-16 allocation returned
/// by a Shell API using CoTaskMemAlloc, with unique caller ownership.
unsafe fn take_string(value: Result<PWSTR>) -> Option<String> {
    let pointer = value.ok()?;
    if pointer.is_null() {
        return None;
    }
    let owned = TaskString(pointer);
    // SAFETY: the caller's Shell allocation is live through conversion and
    // includes its terminating NUL. No alias frees it before the guard drops.
    unsafe { owned.0.to_string() }
        .ok()
        .filter(|text| !text.is_empty())
}
fn property(item: &IShellItem2, key: Option<&PROPERTYKEY>) -> Option<String> {
    let key = key?;
    // SAFETY: item and key are live in the current STA. GetString returns a
    // caller-owned CoTaskMem UTF-16 string; take_string always frees it.
    unsafe { take_string(item.GetString(key)) }
}
fn display_name(item: &IShellItem) -> Option<String> {
    // SAFETY: the live STA interface returns a caller-owned, terminated
    // CoTaskMem string for SIGDN_NORMALDISPLAY. No pointer escapes.
    unsafe { take_string(item.GetDisplayName(SIGDN_NORMALDISPLAY)) }
}
fn property_key(name: &str) -> Result<PROPERTYKEY> {
    let name = HSTRING::from(name);
    let mut key = PROPERTYKEY::default();
    // SAFETY: HSTRING supplies terminated UTF-16 for the call. key is an
    // initialized, aligned output of the exact type; no pointer is retained.
    unsafe { PSGetPropertyKeyFromName(&name, &mut key) }?;
    Ok(key)
}
fn icon(item: &IShellItem) -> Option<String> {
    let factory: IShellItemImageFactory = item.cast().ok()?;
    // SAFETY: factory is a live STA interface; a positive bounded SIZE and
    // valid flags request a caller-owned bitmap, immediately guarded.
    let bitmap =
        Bitmap(unsafe { factory.GetImage(SIZE { cx: 64, cy: 64 }, SIIGBF_ICONONLY) }.ok()?);
    encode_bitmap(&bitmap)
}
fn encode_bitmap(bitmap: &Bitmap) -> Option<String> {
    let mut object = BITMAP::default();
    // SAFETY: bitmap remains live. The output pointer is aligned, writable,
    // and exactly size_of::<BITMAP>() bytes. GetObjectW retains no pointer.
    if unsafe {
        GetObjectW(
            HGDIOBJ(bitmap.0 .0),
            size_of::<BITMAP>() as i32,
            Some((&mut object as *mut BITMAP).cast()),
        )
    } == 0
    {
        return None;
    }
    let (width, height) = (object.bmWidth, object.bmHeight.checked_abs()?);
    if !(1..=64).contains(&width) || !(1..=64).contains(&height) {
        return None;
    }
    let mut info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut rgba = vec![0u8; (width * height * 4) as usize];
    // SAFETY: null HWND requests this thread's screen DC. A null failure is
    // rejected before the owner is created; the matching ReleaseDC is RAII.
    let dc = unsafe { GetDC(None) };
    if dc.0.is_null() {
        return None;
    }
    let dc = ScreenDc(dc);
    // SAFETY: the bitmap is not selected in any DC; both handles remain live.
    // The initialized 32bpp BI_RGB header requires width*height*4 bytes (rows
    // are already DWORD-aligned), exactly the live buffer capacity above.
    // Height is 1..=64, the output pointers are writable and never retained.
    let rows = unsafe {
        GetDIBits(
            dc.0,
            bitmap.0,
            0,
            height as u32,
            Some(rgba.as_mut_ptr().cast()),
            &mut info,
            DIB_RGB_COLORS,
        )
    };
    if rows != height {
        return None;
    }
    let has_alpha = rgba.as_chunks::<4>().0.iter().any(|pixel| pixel[3] != 0);
    for pixel in rgba.as_chunks_mut::<4>().0 {
        pixel.swap(0, 2);
        if !has_alpha {
            pixel[3] = 255;
        } else if pixel[3] > 0 && pixel[3] < 255 {
            for channel in 0..3 {
                pixel[channel] = ((pixel[channel] as u32 * 255 / pixel[3] as u32).min(255)) as u8;
            }
        }
    }
    let mut bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut bytes, width as u32, height as u32);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        encoder.write_header().ok()?.write_image_data(&rgba).ok()?;
    }
    Some(format!("data:image/png;base64,{}", STANDARD.encode(bytes)))
}

fn allowed_name(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower != "pam" && !lower.contains("uninstall") && !lower.contains("désinstall")
}

fn desktop_target(target: &str) -> bool {
    let lower = target.to_lowercase();
    lower.ends_with(".exe")
        && ![
            "cmd.exe",
            "powershell.exe",
            "pwsh.exe",
            "msiexec.exe",
            "rundll32.exe",
        ]
        .iter()
        .any(|exe| lower.ends_with(&format!("\\{exe}")))
}

fn shortcuts(directory: &Path, depth: usize, files: &mut Vec<PathBuf>) {
    if depth > 8 || files.len() >= 4096 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_symlink() {
            continue;
        }
        if kind.is_dir() {
            shortcuts(&entry.path(), depth + 1, files);
        } else if entry
            .path()
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("lnk"))
        {
            files.push(entry.path());
            if files.len() >= 4096 {
                break;
            }
        }
    }
}

pub(super) fn discover(icons: IconScope<'_>) -> Result<Vec<InstalledApplication>> {
    let _apartment = Apartment::sta()?;
    // SAFETY: constant folder GUID, valid flags, no borrowed token; the current
    // STA guard outlives the returned owned interface.
    let folder: IShellItem =
        unsafe { SHGetKnownFolderItem(&FOLDERID_AppsFolder, KF_FLAG_DEFAULT, None) }?;
    // SAFETY: folder is a live STA interface and the handler GUID is valid.
    // The returned interface is released before the apartment guard.
    let items: IEnumShellItems = unsafe { folder.BindToHandler(None, &BHID_EnumItems) }?;
    let id_key = property_key("System.AppUserModel.ID")?;
    let target_key = property_key("System.Link.TargetParsingPath").ok();
    let package_key = property_key("System.AppUserModel.PackageInstallPath").ok();
    let mut applications = Vec::new();
    let mut seen = HashSet::new();
    let mut seen_targets = HashSet::new();
    loop {
        let mut next = [None];
        // SAFETY: a live enumerator writes into one initialized Option;
        // the binding passes its length. No output pointer is retained.
        unsafe { items.Next(&mut next, None) }?;
        let Some(item) = next[0].take() else {
            break;
        };
        let Ok(properties) = item.cast::<IShellItem2>() else {
            continue;
        };
        let Some(id) = property(&properties, Some(&id_key)) else {
            continue;
        };
        let Some(name) = display_name(&item) else {
            continue;
        };
        let target = property(&properties, target_key.as_ref()).unwrap_or_default();
        let store = property(&properties, package_key.as_ref()).is_some() || id.contains('!');
        // AppsFolder also lists manuals, websites and uninstall shortcuts.
        if (!store && !desktop_target(&target))
            || id.len() > 1024
            || id.contains("{input}")
            || id.chars().any(char::is_control)
            || !allowed_name(&name)
            || !seen.insert(id.to_lowercase())
        {
            continue;
        }
        if !target.is_empty() {
            seen_targets.insert(target.to_lowercase());
        }
        let image = icons.includes(&id).then(|| icon(&item)).flatten();
        applications.push(InstalledApplication {
            launch_argument: format!("shell:AppsFolder\\{id}"),
            app_id: id,
            name,
            kind: if store { "store" } else { "desktop" }.into(),
            icon: image,
        });
    }
    // AppsFolder can lag behind a fresh Start Menu shortcut. Read only
    // these two known application directories, without following links.
    let mut links = Vec::new();
    for folder_id in [&FOLDERID_Programs, &FOLDERID_CommonPrograms] {
        if let Some(directory) =
            // SAFETY: folder_id is a live known GUID and the successful
            // API result is uniquely owned CoTaskMem UTF-16, freed here.
            unsafe { take_string(SHGetKnownFolderPath(folder_id, KF_FLAG_DEFAULT, None)) }
        {
            shortcuts(Path::new(&directory), 0, &mut links);
        }
    }
    for link in links {
        let launch_argument = link.to_string_lossy().into_owned();
        if launch_argument.len() > 1000 || launch_argument.contains("{input}") {
            continue;
        }
        // SAFETY: HSTRING owns the terminated parsing name for the
        // synchronous call; the returned interface stays in this STA.
        let Ok(item) = (unsafe {
            SHCreateItemFromParsingName::<_, _, IShellItem2>(&HSTRING::from(&launch_argument), None)
        }) else {
            continue;
        };
        let target = property(&item, target_key.as_ref()).unwrap_or_default();
        let Some(name) = display_name(&item) else {
            continue;
        };
        if !desktop_target(&target)
            || !allowed_name(&name)
            || seen_targets.contains(&target.to_lowercase())
        {
            continue;
        }
        seen_targets.insert(target.to_lowercase());
        let app_id = format!("shortcut:{launch_argument}");
        let image = icons.includes(&app_id).then(|| icon(&item)).flatten();
        applications.push(InstalledApplication {
            app_id,
            name,
            kind: "desktop".into(),
            icon: image,
            launch_argument,
        });
    }
    applications.sort_by_cached_key(|entry| entry.name.to_lowercase());
    Ok(applications)
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::{Graphics::Gdi::CreateBitmap, System::Com::CoTaskMemAlloc};
    #[test]
    fn native_bitmaps_respect_bounds_and_encode_valid_pixels() {
        for (width, expected) in [(2, true), (65, false)] {
            let pixels = vec![0xffu8; width * 2 * 4];
            // SAFETY: the initialized pixel array contains exactly width*2*4
            // bytes for the requested 32bpp bitmap. Windows copies it; the
            // returned owned handle is immediately wrapped and never selected.
            let raw = unsafe { CreateBitmap(width as i32, 2, 1, 32, Some(pixels.as_ptr().cast())) };
            assert!(!raw.0.is_null());
            let bitmap = Bitmap(raw);
            let encoded = encode_bitmap(&bitmap);
            assert_eq!(encoded.is_some(), expected);
            if let Some(encoded) = encoded {
                let bytes = STANDARD
                    .decode(encoded.strip_prefix("data:image/png;base64,").unwrap())
                    .unwrap();
                let decoder = png::Decoder::new(std::io::Cursor::new(bytes));
                let reader = decoder.read_info().unwrap();
                assert_eq!((reader.info().width, reader.info().height), (2, 2));
            }
            let handle = bitmap.0;
            drop(bitmap);
            let mut object = BITMAP::default();
            // SAFETY: GetObjectW validates the stale numeric GDI handle without
            // dereferencing it; the output is aligned and exactly BITMAP-sized.
            // GDI handle uniqueness bits prevent another live bitmap aliasing it.
            let remaining = unsafe {
                GetObjectW(
                    HGDIOBJ(handle.0),
                    size_of::<BITMAP>() as i32,
                    Some((&mut object as *mut BITMAP).cast()),
                )
            };
            assert_eq!(remaining, 0);
        }
    }
    #[test]
    fn shell_string_owner_handles_empty_and_invalid_utf16_results() {
        for (words, expected) in [
            (&[0u16][..], None),
            (&[0xd800u16, 0][..], None),
            (&[65u16, 0][..], Some("A")),
        ] {
            // SAFETY: allocate the exact initialized UTF-16 array including NUL,
            // copy nonoverlapping bytes, then transfer unique CoTaskMem ownership
            // to take_string. No pointer is dereferenced after that transfer.
            let result = unsafe {
                let raw = CoTaskMemAlloc(std::mem::size_of_val(words)).cast::<u16>();
                assert!(!raw.is_null());
                raw.copy_from_nonoverlapping(words.as_ptr(), words.len());
                take_string(Ok(PWSTR(raw)))
            };
            assert_eq!(result.as_deref(), expected);
        }
        // SAFETY: failure contains no allocated pointer; no ownership is taken.
        assert!(unsafe {
            take_string(Err(windows::core::Error::from_hresult(
                windows::core::HRESULT(0x80004005u32 as i32),
            )))
        }
        .is_none());
    }
}
