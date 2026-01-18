use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use reqwest::blocking::Client;
use reqwest::header::{HeaderMap, HeaderValue};
use serde::Deserialize;
use serde_json::{Map, Value};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use crate::errors::{AppError, AppResult};
use crate::fs as app_fs;
use crate::models::{CodexUsageSnapshot, UsageWindowView};

const TOKEN_ENDPOINT: &str = "https://auth.openai.com/oauth/token";
const DEFAULT_CODEX_CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const USAGE_ENDPOINT: &str = "https://chatgpt.com/backend-api/wham/usage";
const REFRESH_THRESHOLD_SECONDS: i64 = 300;

#[derive(Debug, Deserialize)]
struct TokenRefreshResponse {
  access_token: Option<String>,
  refresh_token: Option<String>,
  id_token: Option<String>,
}

#[tauri::command]
pub fn codex_get_usage_snapshot(codex_home: Option<String>) -> AppResult<CodexUsageSnapshot> {
  let (auth_path, token_source) = resolve_auth_path(codex_home.as_deref())?;
  let mut auth_json = read_auth_json(&auth_path)?;
  let login_method = detect_login_method(&auth_json);
  let mut auth_status = auth_status_for(&auth_json);
  let account_id = get_token_string(&auth_json, "account_id")
    .ok_or_else(|| AppError::new("auth_missing", "auth.json missing tokens.account_id"))?;
  let mut access_token = get_token_string(&auth_json, "access_token")
    .ok_or_else(|| AppError::new("auth_missing", "auth.json missing tokens.access_token"))?;
  let mut refreshed = false;

  if should_refresh(&access_token) {
    refresh_tokens(&mut auth_json)?;
    access_token = get_token_string(&auth_json, "access_token")
      .ok_or_else(|| AppError::new("auth_missing", "auth.json missing tokens.access_token"))?;
    write_auth_json(&auth_path, &auth_json)?;
    refreshed = true;
  }

  let usage_json = match fetch_usage(&access_token, &account_id) {
    Ok(value) => value,
    Err(err) if err.code == "auth_unauthorized" => {
      refresh_tokens(&mut auth_json)?;
      access_token = get_token_string(&auth_json, "access_token")
        .ok_or_else(|| AppError::new("auth_missing", "auth.json missing tokens.access_token"))?;
      write_auth_json(&auth_path, &auth_json)?;
      refreshed = true;
      fetch_usage(&access_token, &account_id)?
    }
    Err(err) => return Err(err),
  };

  if refreshed {
    auth_status = "Refreshed".to_string();
  }

  Ok(CodexUsageSnapshot {
    plan_type: usage_json
      .get("plan_type")
      .and_then(|v| v.as_str())
      .map(|s| s.to_string()),
    primary: usage_json
      .get("rate_limit")
      .and_then(|v| v.get("primary_window"))
      .and_then(parse_window),
    secondary: usage_json
      .get("rate_limit")
      .and_then(|v| v.get("secondary_window"))
      .and_then(parse_window),
    code_review: usage_json
      .get("code_review_rate_limit")
      .and_then(|v| v.get("primary_window"))
      .and_then(parse_window),
    limit_reached: usage_json
      .get("rate_limit")
      .and_then(|v| v.get("limit_reached"))
      .and_then(|v| v.as_bool()),
    extras: collect_extras(&usage_json),
    auth_path: auth_path.to_string_lossy().to_string(),
    auth_status,
    login_method,
    token_source,
    last_refresh: auth_json
      .get("last_refresh")
      .and_then(|v| v.as_str())
      .map(|s| s.to_string()),
  })
}

fn resolve_auth_path(codex_home: Option<&str>) -> AppResult<(PathBuf, String)> {
  for (path, label) in default_auth_paths(codex_home) {
    if path.exists() {
      return Ok((path, label.to_string()));
    }
  }
  Err(AppError::new(
    "auth_missing",
    "auth.json not found. Run `codex login` and ensure CODEX_HOME is set.",
  ))
}

fn default_auth_paths(codex_home: Option<&str>) -> Vec<(PathBuf, &'static str)> {
  let mut paths = Vec::new();
  if let Some(value) = codex_home.filter(|value| !value.trim().is_empty()) {
    paths.push((PathBuf::from(value).join("auth.json"), "CODEX_HOME setting"));
    return paths;
  }

  if let Ok(env_home) = std::env::var("CODEX_HOME") {
    if !env_home.trim().is_empty() {
      paths.push((PathBuf::from(env_home).join("auth.json"), "CODEX_HOME env"));
      return paths;
    }
  }

  if let Some(home) = dirs::home_dir() {
    paths.push((home.join(".codex").join("auth.json"), "~/.codex"));
    paths.push((home.join(".config").join("codex").join("auth.json"), "~/.config/codex"));
  }
  paths
}

fn read_auth_json(path: &Path) -> AppResult<Value> {
  let raw = fs::read_to_string(path)?;
  let value: Value = serde_json::from_str(&raw)?;
  if !value.is_object() {
    return Err(AppError::new("auth_format", "auth.json root must be an object"));
  }
  Ok(value)
}

fn write_auth_json(path: &Path, auth: &Value) -> AppResult<()> {
  let raw = serde_json::to_string_pretty(auth)?;
  app_fs::write_atomic(path, &raw)
}

fn tokens_map(auth: &Value) -> Option<&Map<String, Value>> {
  auth.get("tokens")?.as_object()
}

fn tokens_map_mut(auth: &mut Value) -> AppResult<&mut Map<String, Value>> {
  let root = auth
    .as_object_mut()
    .ok_or_else(|| AppError::new("auth_format", "auth.json root must be an object"))?;
  let tokens = root
    .entry("tokens")
    .or_insert_with(|| Value::Object(Map::new()));
  tokens
    .as_object_mut()
    .ok_or_else(|| AppError::new("auth_format", "auth.json tokens must be an object"))
}

fn get_token_string(auth: &Value, key: &str) -> Option<String> {
  tokens_map(auth)?
    .get(key)
    .and_then(|v| v.as_str())
    .map(|s| s.to_string())
}

fn set_token_string(auth: &mut Value, key: &str, value: String) -> AppResult<()> {
  let tokens = tokens_map_mut(auth)?;
  tokens.insert(key.to_string(), Value::String(value));
  Ok(())
}

fn now_unix() -> i64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|d| d.as_secs() as i64)
    .unwrap_or(0)
}

fn jwt_exp_seconds(token: &str) -> Option<i64> {
  let parts: Vec<&str> = token.split('.').collect();
  if parts.len() < 2 {
    return None;
  }
  let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
    .decode(parts[1])
    .ok()?;
  let payload_json: Value = serde_json::from_slice(&payload).ok()?;
  payload_json.get("exp")?.as_i64()
}

fn should_refresh(token: &str) -> bool {
  let exp = match jwt_exp_seconds(token) {
    Some(value) => value,
    None => return false,
  };
  (exp - now_unix()) <= REFRESH_THRESHOLD_SECONDS
}

fn detect_login_method(auth: &Value) -> String {
  if auth.get("OPENAI_API_KEY").and_then(|v| v.as_str()).is_some() {
    return "API key".to_string();
  }
  if tokens_map(auth).is_some() {
    return "ChatGPT OAuth".to_string();
  }
  "Unknown".to_string()
}

fn auth_status_for(auth: &Value) -> String {
  let tokens = match tokens_map(auth) {
    Some(map) => map,
    None => return "Missing tokens".to_string(),
  };
  if tokens.get("account_id").and_then(|v| v.as_str()).is_none() {
    return "Missing account id".to_string();
  }
  let Some(access) = tokens.get("access_token").and_then(|v| v.as_str()) else {
    return "Missing access token".to_string();
  };
  if tokens.get("refresh_token").and_then(|v| v.as_str()).is_none() {
    return "Missing refresh token".to_string();
  }
  if should_refresh(access) {
    return "Refresh soon".to_string();
  }
  "OK".to_string()
}

fn refresh_tokens(auth: &mut Value) -> AppResult<()> {
  let refresh_token = get_token_string(auth, "refresh_token")
    .ok_or_else(|| AppError::new("auth_missing", "auth.json missing tokens.refresh_token"))?;
  let response = refresh_access_token(&refresh_token)?;
  let access_token = response
    .access_token
    .ok_or_else(|| AppError::new("auth_refresh", "Token refresh missing access_token"))?;
  set_token_string(auth, "access_token", access_token.trim().to_string())?;
  if let Some(value) = response.refresh_token {
    set_token_string(auth, "refresh_token", value.trim().to_string())?;
  }
  if let Some(value) = response.id_token {
    set_token_string(auth, "id_token", value.trim().to_string())?;
  }
  let timestamp = OffsetDateTime::now_utc()
    .format(&Rfc3339)
    .unwrap_or_else(|_| OffsetDateTime::now_utc().to_string());
  if let Some(obj) = auth.as_object_mut() {
    obj.insert("last_refresh".to_string(), Value::String(timestamp));
  }
  Ok(())
}

fn refresh_access_token(refresh_token: &str) -> AppResult<TokenRefreshResponse> {
  let client_id = std::env::var("CODEX_CLIENT_ID")
    .ok()
    .filter(|v| !v.trim().is_empty())
    .unwrap_or_else(|| DEFAULT_CODEX_CLIENT_ID.to_string());
  let body = format!(
    "grant_type=refresh_token&refresh_token={}&client_id={}",
    urlencoding::encode(refresh_token),
    urlencoding::encode(&client_id)
  );
  let client = Client::new();
  let response = client
    .post(TOKEN_ENDPOINT)
    .header("Content-Type", "application/x-www-form-urlencoded")
    .body(body)
    .send()
    .map_err(|err| AppError::new("auth_refresh", format!("Token refresh failed: {}", err)))?;

  if !response.status().is_success() {
    return Err(AppError::new(
      "auth_refresh",
      format!("Token refresh failed: HTTP {}", response.status()),
    ));
  }

  response
    .json::<TokenRefreshResponse>()
    .map_err(|err| AppError::new("auth_refresh", format!("Token refresh parse failed: {}", err)))
}

fn fetch_usage(access_token: &str, account_id: &str) -> AppResult<Value> {
  let mut headers = HeaderMap::new();
  headers.insert(
    "Authorization",
    HeaderValue::from_str(&format!("Bearer {}", access_token))
      .map_err(|_| AppError::new("auth_format", "Invalid access token header"))?,
  );
  headers.insert(
    "chatgpt-account-id",
    HeaderValue::from_str(account_id)
      .map_err(|_| AppError::new("auth_format", "Invalid account id header"))?,
  );
  headers.insert("User-Agent", HeaderValue::from_static("codexmanager"));

  let client = Client::new();
  let response = client
    .get(USAGE_ENDPOINT)
    .headers(headers)
    .send()
    .map_err(|err| AppError::new("usage_fetch", format!("Usage request failed: {}", err)))?;

  if response.status() == reqwest::StatusCode::UNAUTHORIZED {
    return Err(AppError::new("auth_unauthorized", "Unauthorized"));
  }

  if !response.status().is_success() {
    return Err(AppError::new(
      "usage_fetch",
      format!("Usage request failed: HTTP {}", response.status()),
    ));
  }

  response
    .json::<Value>()
    .map_err(|err| AppError::new("usage_fetch", format!("Usage parse failed: {}", err)))
}

fn parse_window(value: &Value) -> Option<UsageWindowView> {
  let used = value.get("used_percent")?.as_f64().unwrap_or(0.0);
  let used = used.clamp(0.0, 100.0);
  let remaining = (100.0 - used).clamp(0.0, 100.0);
  let window_seconds = value
    .get("limit_window_seconds")
    .and_then(|v| v.as_u64());
  let resets_in_seconds = value
    .get("reset_after_seconds")
    .and_then(|v| v.as_u64());
  Some(UsageWindowView {
    used_percent: used,
    remaining_percent: remaining,
    window_seconds,
    resets_in_seconds,
    resets_in_human: resets_in_seconds.map(format_seconds),
  })
}

fn format_seconds(secs: u64) -> String {
  if secs >= 86400 {
    let days = secs / 86400;
    let hours = (secs % 86400) / 3600;
    return format!("{}d {}h", days, hours);
  }
  if secs >= 3600 {
    let hours = secs / 3600;
    let minutes = (secs % 3600) / 60;
    return format!("{}h {}m", hours, minutes);
  }
  let minutes = secs / 60;
  format!("{}m", minutes)
}

fn collect_extras(root: &Value) -> Vec<(String, String)> {
  let mut extras = Vec::new();
  let Some(obj) = root.as_object() else {
    return extras;
  };
  for (key, value) in obj {
    let key_lower = key.to_lowercase();
    if !(key_lower.contains("credit") || key_lower.contains("balance")) {
      continue;
    }
    let value_string = match value {
      Value::Number(n) => n.to_string(),
      Value::String(s) => s.clone(),
      Value::Bool(b) => b.to_string(),
      _ => continue,
    };
    extras.push((key.clone(), value_string));
  }
  extras
}
