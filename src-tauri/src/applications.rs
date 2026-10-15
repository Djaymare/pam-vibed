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
    // SAFETY: Windows receives a live writable UTF-16 array; the binding passes
    // its actual capacity. The returned length is checked before slicing.
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
#[path = "applications/native.rs"]
mod native;
