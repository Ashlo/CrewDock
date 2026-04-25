use std::{
    fs::OpenOptions,
    io::Write,
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};

use reqwest::blocking::Client;
use serde::Serialize;
use serde_json::{Map, Value};
use uuid::Uuid;

use crate::{RuntimeState, APP_VERSION};

pub(crate) const DEFAULT_POSTHOG_HOST: &str = "https://us.i.posthog.com";
const POSTHOG_CAPTURE_PATH: &str = "/capture/";
const POSTHOG_CAPTURE_TIMEOUT_SECS: u64 = 4;
const TELEMETRY_DEBUG_ENV: &str = "CREWDOCK_TELEMETRY_DEBUG";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TelemetrySettingsSnapshot {
    pub(crate) enabled: bool,
    pub(crate) host: String,
    #[serde(rename = "hasStoredPostHogProjectApiKey")]
    pub(crate) has_stored_posthog_project_api_key: bool,
    pub(crate) is_configured: bool,
}

#[derive(Debug, Clone)]
struct TelemetryDispatchConfig {
    host: String,
    project_api_key: String,
    install_id: String,
}

#[derive(Debug, Serialize)]
struct PostHogCapturePayload {
    api_key: String,
    event: String,
    distinct_id: String,
    properties: Map<String, Value>,
}

pub(crate) fn default_posthog_host() -> String {
    DEFAULT_POSTHOG_HOST.to_string()
}

pub(crate) fn generate_install_id() -> String {
    format!("crewdock-{}", Uuid::new_v4())
}

pub(crate) fn normalize_posthog_host(value: Option<String>) -> String {
    let trimmed = value
        .as_deref()
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .unwrap_or(DEFAULT_POSTHOG_HOST);
    let with_scheme = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };

    with_scheme.trim_end_matches('/').to_string()
}

pub(crate) fn normalize_optional_posthog_project_api_key(value: Option<String>) -> Option<String> {
    value.and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

pub(crate) fn normalize_telemetry_install_id(value: Option<String>) -> String {
    value.and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
    .unwrap_or_else(generate_install_id)
}

pub(crate) fn build_settings_snapshot(runtime: &RuntimeState) -> TelemetrySettingsSnapshot {
    let has_key = runtime.settings.posthog_project_api_key.is_some();
    TelemetrySettingsSnapshot {
        enabled: runtime.settings.telemetry_enabled,
        host: runtime.settings.telemetry_host.clone(),
        has_stored_posthog_project_api_key: has_key,
        is_configured: runtime.settings.telemetry_enabled && has_key,
    }
}

pub(crate) fn object(value: Value) -> Map<String, Value> {
    match value {
        Value::Object(map) => map,
        _ => Map::new(),
    }
}

pub(crate) fn queue_event(
    shared: &Arc<Mutex<RuntimeState>>,
    event: impl Into<String>,
    properties: Map<String, Value>,
) {
    let event = event.into();
    let config = {
        let Ok(runtime) = shared.lock() else {
            telemetry_debug("skipping event because runtime lock is poisoned");
            return;
        };
        dispatch_config(&runtime, &event)
    };

    let Some(config) = config else {
        return;
    };

    queue_event_with_config(config, event, properties);
}

fn dispatch_config(runtime: &RuntimeState, event: &str) -> Option<TelemetryDispatchConfig> {
    if !runtime.settings.telemetry_enabled {
        telemetry_debug(&format!("skipping event '{event}' because telemetry is disabled"));
        return None;
    }

    let Some(project_api_key) = runtime.settings.posthog_project_api_key.clone() else {
        telemetry_debug(&format!(
            "skipping event '{event}' because no PostHog project API key is configured"
        ));
        return None;
    };
    let install_id = runtime.settings.telemetry_install_id.trim();
    if install_id.is_empty() {
        telemetry_debug(&format!(
            "skipping event '{event}' because telemetry install ID is empty"
        ));
        return None;
    }

    Some(TelemetryDispatchConfig {
        host: normalize_posthog_host(Some(runtime.settings.telemetry_host.clone())),
        project_api_key,
        install_id: install_id.to_string(),
    })
}

fn queue_event_with_config(
    config: TelemetryDispatchConfig,
    event: String,
    mut properties: Map<String, Value>,
) {
    properties.insert("$lib".to_string(), Value::String("crewdock".to_string()));
    properties.insert("$lib_version".to_string(), Value::String(APP_VERSION.to_string()));
    properties.insert("app_version".to_string(), Value::String(APP_VERSION.to_string()));
    properties.insert("os".to_string(), Value::String(std::env::consts::OS.to_string()));
    properties.insert("arch".to_string(), Value::String(std::env::consts::ARCH.to_string()));
    properties.insert(
        "distinct_id".to_string(),
        Value::String(config.install_id.clone()),
    );

    let payload = PostHogCapturePayload {
        api_key: config.project_api_key,
        event,
        distinct_id: config.install_id,
        properties,
    };

    let event_name = payload.event.clone();
    telemetry_debug(&format!("queueing event '{event_name}'"));

    thread::spawn(move || {
        if let Err(error) = send_posthog_capture_blocking(config.host, payload) {
            telemetry_debug(&format!("failed to send event '{event_name}': {error}"));
        } else {
            telemetry_debug(&format!("sent event '{event_name}'"));
        }
    });
}

fn send_posthog_capture_blocking(
    host: String,
    payload: PostHogCapturePayload,
) -> Result<(), String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(POSTHOG_CAPTURE_TIMEOUT_SECS))
        .user_agent(format!("CrewDock/{APP_VERSION}"))
        .build()
        .map_err(|error| format!("failed to build PostHog client: {error}"))?;
    let url = format!("{}{}", host.trim_end_matches('/'), POSTHOG_CAPTURE_PATH);

    client
        .post(url)
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .map_err(|error| format!("failed to reach PostHog: {error}"))?
        .error_for_status()
        .map_err(|error| format!("PostHog rejected telemetry event: {error}"))?;

    Ok(())
}

fn telemetry_debug(message: &str) {
    if !telemetry_debug_enabled() {
        return;
    }
    eprintln!("[telemetry] {message}");
    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open("/tmp/crewdock-telemetry.log")
    {
        let _ = writeln!(file, "[telemetry] {message}");
    }
}

pub(crate) fn debug_log(message: &str) {
    telemetry_debug(message);
}

fn telemetry_debug_enabled() -> bool {
    let enabled = std::env::var_os(TELEMETRY_DEBUG_ENV)
        .map(|value| !value.is_empty())
        .unwrap_or(false);
    enabled
}
