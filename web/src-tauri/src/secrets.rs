use std::collections::HashMap;

const SERVICE: &str = "app.intx.desktop";
const ACCOUNT: &str = "channel-api-keys";

#[tauri::command]
pub fn load_channel_secrets() -> Result<HashMap<String, String>, String> {
    let entry = keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(raw) => serde_json::from_str(&raw).map_err(|e| e.to_string()),
        Err(keyring::Error::NoEntry) => Ok(HashMap::new()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn save_channel_secrets(secrets: HashMap<String, String>) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())?;
    if secrets.is_empty() {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    } else {
        let raw = serde_json::to_string(&secrets).map_err(|e| e.to_string())?;
        entry.set_password(&raw).map_err(|e| e.to_string())
    }
}
