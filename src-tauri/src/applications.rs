//! Windows' AppsFolder is the launch catalogue for both desktop and Store apps.
//! COM objects stay on the calling worker thread; only plain data leaves it.
use serde::Serialize;
use serde_json::Value;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledApplication {
    pub app_id: String,
    pub name: String,
    pub kind: String,
    pub icon: Option<String>,
    pub launch_argument: String,
}

#[derive(Default)]
pub struct Catalogue(pub std::sync::Mutex<Option<Vec<InstalledApplication>>>);

impl Catalogue {
    pub fn scan(&self) -> Result<Vec<InstalledApplication>, String> {
        let applications = discover()?;
        *self.0.lock().map_err(|_| "Catalogue indisponible.")? = Some(applications.clone());
        Ok(applications)
    }

    // Use the Windows catalogue as the authority, rather than accepting an app ID,
    // icon or executable invented by the webview. Existing registrations work
    // after restarting PAM, without first opening the picker.
    pub fn prepare(&self, payload: &mut Value) -> Result<(), String> {
        let Some(target) = payload.get("windowsApp").filter(|v| !v.is_null()) else {
            return Ok(());
        };
        let id = target
            .get("appId")
            .and_then(Value::as_str)
            .ok_or("Identifiant d’application Windows invalide.")?
            .to_owned();
        let mut catalogue = self.0.lock().map_err(|_| "Catalogue indisponible.")?;
        if catalogue.is_none() {
            *catalogue = Some(discover()?);
        }
        let entry = catalogue.as_ref().unwrap().iter().find(|entry| entry.app_id == id)
            .ok_or("Application absente du catalogue Windows. Actualisez la liste ou choisissez un exécutable.")?;
        payload["executable"] = Value::String(explorer()?);
        payload["arguments"] = serde_json::json!([entry.launch_argument]);
        payload["windowsApp"] = serde_json::json!({ "appId": entry.app_id, "kind": entry.kind, "icon": entry.icon, "launchArgument": entry.launch_argument });
        Ok(())
    }

    pub fn prepare_fresh(&self, payload: &mut Value) -> Result<(), String> {
        // Effect/registration paths must not trust a stale picker snapshot.
        // prepare() alone supports read-only batch checks on one scan.
        if !payload["windowsApp"].is_null() {
            self.scan()?;
        }
        self.prepare(payload)
    }

    pub fn prepare_request(
        &self,
        method: &str,
        payload: &mut Value,
        previous: Option<&Value>,
    ) -> Result<(), String> {
        // Only an existing disabled record can bypass target availability.
        // The sidecar still checks its ID and the full structural schema.
        if method == "save_application"
            && payload["enabled"] == false
            && previous.is_some_and(|app| {
                payload["id"].is_string()
                    && app["id"] == payload["id"]
                    && app["executable"] == payload["executable"]
                    && app["arguments"] == payload["arguments"]
                    && app["windowsApp"]["appId"] == payload["windowsApp"]["appId"]
            })
        {
            return Ok(());
        }
        self.prepare_fresh(payload)
    }

    pub fn annotate_status(&self, status: &mut Value) {
        let Some(applications) = status["config"]["applications"].as_array() else {
            return;
        };
        let applications = applications.clone();
        if !applications.iter().any(|app| !app["windowsApp"].is_null()) {
            return;
        }
        let catalogue = self.scan();
        for app in applications
            .iter()
            .filter(|app| !app["windowsApp"].is_null())
        {
            let Some(id) = app["id"].as_str() else {
                continue;
            };
            let entry = catalogue.as_ref().ok().and_then(|entries| {
                entries.iter().find(|entry| {
                    Some(entry.app_id.as_str()) == app["windowsApp"]["appId"].as_str()
                })
            });
            let available = entry.is_some_and(|entry| {
                app["arguments"] == serde_json::json!([entry.launch_argument])
            }) && status["applicationAvailability"][id]["available"] == true;
            status["applicationAvailability"][id] = if available {
                serde_json::json!({"available":true})
            } else {
                serde_json::json!({"available":false,"reason":catalogue.as_ref().err().cloned().unwrap_or_else(|| "Application indisponible dans le catalogue Windows. Réparez sa cible ou choisissez une autre application.".into())})
            };
        }
    }
}

#[cfg(not(windows))]
pub fn discover() -> Result<Vec<InstalledApplication>, String> {
    Err("La découverte des applications est disponible sous Windows.".into())
}
#[cfg(not(windows))]
fn explorer() -> Result<String, String> {
    Err("Windows est requis.".into())
}

#[cfg(windows)]
fn explorer() -> Result<String, String> {
    let mut directory = [0u16; 32768];
    let length = unsafe {
        windows::Win32::System::SystemInformation::GetWindowsDirectoryW(Some(&mut directory))
    } as usize;
    if length == 0 || length >= directory.len() {
        return Err("Dossier Windows introuvable.".into());
    }
    Ok(format!(
        "{}\\explorer.exe",
        String::from_utf16_lossy(&directory[..length])
    ))
}

#[cfg(windows)]
pub fn discover() -> Result<Vec<InstalledApplication>, String> {
    native::discover()
        .map_err(|error| format!("Impossible de lire les applications Windows : {error}"))
}

#[cfg(windows)]
mod native {
    use super::InstalledApplication;
    use base64::{engine::general_purpose::STANDARD, Engine};
    use std::{
        collections::HashSet,
        mem::size_of,
        path::{Path, PathBuf},
    };
    use windows::{
        core::{w, Interface, Result, HSTRING, PCWSTR, PWSTR},
        Win32::{
            Foundation::{PROPERTYKEY, SIZE},
            Graphics::Gdi::{
                DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO,
                BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP, HGDIOBJ,
            },
            System::Com::{
                CoInitializeEx, CoTaskMemFree, CoUninitialize, COINIT_APARTMENTTHREADED,
            },
            UI::Shell::{
                BHID_EnumItems, FOLDERID_AppsFolder, FOLDERID_CommonPrograms, FOLDERID_Programs,
                IEnumShellItems, IShellItem, IShellItem2, IShellItemImageFactory,
                PropertiesSystem::PSGetPropertyKeyFromName, SHCreateItemFromParsingName,
                SHGetKnownFolderItem, SHGetKnownFolderPath, KF_FLAG_DEFAULT, SIGDN_NORMALDISPLAY,
                SIIGBF_ICONONLY,
            },
        },
    };

    struct Apartment;
    impl Drop for Apartment {
        fn drop(&mut self) {
            unsafe {
                CoUninitialize();
            }
        }
    }
    struct Bitmap(HBITMAP);
    impl Drop for Bitmap {
        fn drop(&mut self) {
            unsafe {
                let _ = DeleteObject(HGDIOBJ(self.0 .0));
            }
        }
    }

    unsafe fn take_string(value: Result<PWSTR>) -> Option<String> {
        let pointer = value.ok()?;
        if pointer.is_null() {
            return None;
        }
        let text = pointer.to_string().ok();
        CoTaskMemFree(Some(pointer.0.cast()));
        text.filter(|text| !text.is_empty())
    }

    unsafe fn property(item: &IShellItem2, key: Option<&PROPERTYKEY>) -> Option<String> {
        take_string(item.GetString(key?))
    }

    unsafe fn property_key(name: PCWSTR) -> Result<PROPERTYKEY> {
        let mut key = PROPERTYKEY::default();
        PSGetPropertyKeyFromName(name, &mut key)?;
        Ok(key)
    }

    fn icon(item: &IShellItem) -> Option<String> {
        unsafe {
            let factory: IShellItemImageFactory = item.cast().ok()?;
            let bitmap = Bitmap(
                factory
                    .GetImage(SIZE { cx: 64, cy: 64 }, SIIGBF_ICONONLY)
                    .ok()?,
            );
            let mut object = BITMAP::default();
            if GetObjectW(
                HGDIOBJ(bitmap.0 .0),
                size_of::<BITMAP>() as i32,
                Some((&mut object as *mut BITMAP).cast()),
            ) == 0
            {
                return None;
            }
            let (width, height) = (object.bmWidth, object.bmHeight.abs());
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
            let dc = GetDC(None);
            if dc.0.is_null() {
                return None;
            }
            let rows = GetDIBits(
                dc,
                bitmap.0,
                0,
                height as u32,
                Some(rgba.as_mut_ptr().cast()),
                &mut info,
                DIB_RGB_COLORS,
            );
            let _ = ReleaseDC(None, dc);
            if rows != height {
                return None;
            }
            let has_alpha = rgba.as_chunks::<4>().0.iter().any(|pixel| pixel[3] != 0);
            for pixel in rgba.as_chunks_mut::<4>().0 {
                pixel.swap(0, 2); // Windows BGRA -> PNG RGBA.
                if !has_alpha {
                    pixel[3] = 255;
                } else if pixel[3] > 0 && pixel[3] < 255 {
                    for channel in 0..3 {
                        pixel[channel] =
                            ((pixel[channel] as u32 * 255 / pixel[3] as u32).min(255)) as u8;
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

    pub fn discover() -> Result<Vec<InstalledApplication>> {
        unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()?;
            let _apartment = Apartment;
            let folder: IShellItem =
                SHGetKnownFolderItem(&FOLDERID_AppsFolder, KF_FLAG_DEFAULT, None)?;
            let items: IEnumShellItems = folder.BindToHandler(None, &BHID_EnumItems)?;
            let id_key = property_key(w!("System.AppUserModel.ID"))?;
            let target_key = property_key(w!("System.Link.TargetParsingPath")).ok();
            let package_key = property_key(w!("System.AppUserModel.PackageInstallPath")).ok();
            let mut applications = Vec::new();
            let mut seen = HashSet::new();
            let mut seen_targets = HashSet::new();
            loop {
                let mut next = [None];
                items.Next(&mut next, None)?;
                let Some(item) = next[0].take() else {
                    break;
                };
                let Ok(properties) = item.cast::<IShellItem2>() else {
                    continue;
                };
                let Some(id) = property(&properties, Some(&id_key)) else {
                    continue;
                };
                let Some(name) = take_string(item.GetDisplayName(SIGDN_NORMALDISPLAY)) else {
                    continue;
                };
                let target = property(&properties, target_key.as_ref()).unwrap_or_default();
                let store =
                    property(&properties, package_key.as_ref()).is_some() || id.contains('!');
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
                applications.push(InstalledApplication {
                    launch_argument: format!("shell:AppsFolder\\{id}"),
                    app_id: id,
                    name,
                    kind: if store { "store" } else { "desktop" }.into(),
                    icon: icon(&item),
                });
            }
            // AppsFolder can lag behind a fresh Start Menu shortcut. Read only
            // these two known application directories, without following links.
            let mut links = Vec::new();
            for folder_id in [&FOLDERID_Programs, &FOLDERID_CommonPrograms] {
                if let Some(directory) =
                    take_string(SHGetKnownFolderPath(folder_id, KF_FLAG_DEFAULT, None))
                {
                    shortcuts(Path::new(&directory), 0, &mut links);
                }
            }
            for link in links {
                let launch_argument = link.to_string_lossy().into_owned();
                if launch_argument.len() > 1000 || launch_argument.contains("{input}") {
                    continue;
                }
                let Ok(item) = SHCreateItemFromParsingName::<_, _, IShellItem2>(
                    &HSTRING::from(&launch_argument),
                    None,
                ) else {
                    continue;
                };
                let target = property(&item, target_key.as_ref()).unwrap_or_default();
                let Some(name) = take_string(item.GetDisplayName(SIGDN_NORMALDISPLAY)) else {
                    continue;
                };
                if !desktop_target(&target)
                    || !allowed_name(&name)
                    || seen_targets.contains(&target.to_lowercase())
                {
                    continue;
                }
                seen_targets.insert(target.to_lowercase());
                applications.push(InstalledApplication {
                    app_id: format!("shortcut:{launch_argument}"),
                    name,
                    kind: "desktop".into(),
                    icon: icon(&item),
                    launch_argument,
                });
            }
            applications.sort_by_cached_key(|entry| entry.name.to_lowercase());
            Ok(applications)
        }
    }
}
