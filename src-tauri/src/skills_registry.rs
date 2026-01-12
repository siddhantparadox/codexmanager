use std::io::Read;
use std::path::PathBuf;
use std::time::Duration;

use reqwest::blocking::Client;
use reqwest::StatusCode;
use serde_json::Value;
use zip::ZipArchive;

use crate::errors::{AppError, AppResult};
use crate::models::{RemoteSkillDetail, RemoteSkillPage, RemoteSkillSummary};

const API_V1: &str = "https://clawdhub.com/api/v1";
const API_LEGACY: &str = "https://clawdhub.com/api";
const SOURCE_BASE: &str = "https://clawdhub.com/skills";

fn build_client(timeout: Duration) -> AppResult<Client> {
  Client::builder()
    .timeout(timeout)
    .http1_only()
    .build()
    .map_err(|error| AppError::new("http_client", error.to_string()))
}

#[derive(Debug)]
pub struct RemoteZipEntry {
  pub path: PathBuf,
  pub bytes: Vec<u8>,
}

pub fn fetch_skill_detail(slug: &str) -> AppResult<RemoteSkillDetail> {
  let slug = slug.trim();
  if slug.is_empty() {
    return Err(AppError::new("skill_slug", "Skill slug cannot be empty"));
  }
  let latest_url = format!("{}/skills/{}", API_V1, urlencoding::encode(slug));
  let detail_url = format!(
    "{}/skill?slug={}",
    API_LEGACY,
    urlencoding::encode(slug)
  );

  let latest = fetch_json_optional(&latest_url, Duration::from_secs(20))?;
  let detail = fetch_json_optional(&detail_url, Duration::from_secs(20))?;
  if latest.is_none() && detail.is_none() {
    return Err(AppError::new(
      "http_status",
      "Skill not found in registry",
    ));
  }

  let mut sources = Vec::new();
  if let Some(value) = latest.as_ref() {
    sources.push(value);
  }
  if let Some(value) = detail.as_ref() {
    sources.push(value);
  }
  let version_detail =
    fetch_latest_version_detail(slug, latest.as_ref(), detail.as_ref())?;
  if let Some(value) = version_detail.as_ref() {
    sources.push(value);
  }

  let name = extract_from_sources(&sources, &[
    "name",
    "title",
    "display_name",
    "displayName",
  ])
  .unwrap_or_else(|| slug.to_string());
  let description = extract_from_sources(&sources, &["description", "summary"]);
  let tags = extract_tags_from_sources(&sources);
  let updated_at = extract_from_sources(&sources, &[
    "updated_at",
    "updatedAt",
    "published_at",
    "publishedAt",
  ]);
  let mut files = extract_file_paths_from_sources(&sources);
  let mut skill_md = extract_skill_md_from_sources(&sources);
  if skill_md.is_none() {
    let version = latest
      .as_ref()
      .and_then(|value| extract_version_token(value))
      .or_else(|| detail.as_ref().and_then(|value| extract_version_token(value)))
      .or_else(|| {
        version_detail
          .as_ref()
          .and_then(|value| extract_version_token(value))
      });
    skill_md = fetch_skill_file_text(slug, "SKILL.md", version.as_deref()).unwrap_or(None);
  }
  let download_url = latest
    .as_ref()
    .and_then(|value| extract_download_url(value));
  let source_url = Some(format!("{}/{}", SOURCE_BASE, slug));

  if files.is_empty() && skill_md.is_some() {
    files.push("SKILL.md".to_string());
  }
  if files.is_empty()
    || (files.len() == 1 && files[0].eq_ignore_ascii_case("skill.md"))
  {
    if let Ok(bytes) = download_latest_zip(slug) {
      if let Ok(zip_files) = list_zip_paths(&bytes) {
        for path in zip_files {
          if !files.iter().any(|existing| existing.eq_ignore_ascii_case(&path)) {
            files.push(path);
          }
        }
      }
    }
  }

  Ok(RemoteSkillDetail {
    slug: slug.to_string(),
    name,
    description,
    tags,
    updated_at,
    skill_md,
    files,
    download_url,
    source_url,
  })
}

pub fn list_skills(limit: usize, cursor: Option<&str>) -> AppResult<RemoteSkillPage> {
  let mut url = format!("{}/skills?limit={}", API_V1, limit);
  if let Some(value) = cursor {
    if !value.trim().is_empty() {
      url.push_str("&cursor=");
      url.push_str(&urlencoding::encode(value));
    }
  }
  let value = fetch_json(&url, Duration::from_secs(20))?;
  build_skill_page(&value)
}

pub fn search_skills(
  query: &str,
  limit: usize,
  cursor: Option<&str>,
) -> AppResult<RemoteSkillPage> {
  let mut url = format!(
    "{}/search?q={}&limit={}",
    API_V1,
    urlencoding::encode(query.trim()),
    limit
  );
  if let Some(value) = cursor {
    if !value.trim().is_empty() {
      url.push_str("&cursor=");
      url.push_str(&urlencoding::encode(value));
    }
  }
  let value = fetch_json(&url, Duration::from_secs(20))?;
  build_skill_page(&value)
}

fn fetch_latest_version_detail(
  slug: &str,
  latest: Option<&Value>,
  detail: Option<&Value>,
) -> AppResult<Option<Value>> {
  if let Some(token) = latest.and_then(|value| extract_version_token(value)) {
    if let Some(detail) = fetch_version_detail(slug, &token)? {
      return Ok(Some(detail));
    }
  }
  if let Some(token) = detail.and_then(|value| extract_version_token(value)) {
    if let Some(detail) = fetch_version_detail(slug, &token)? {
      return Ok(Some(detail));
    }
  }
  let resolve_url = format!(
    "{}/resolve?slug={}&tag=latest",
    API_V1,
    urlencoding::encode(slug)
  );
  if let Some(resolved) = fetch_json_optional(&resolve_url, Duration::from_secs(20))? {
    if let Some(token) = extract_version_token(&resolved) {
      if let Some(detail) = fetch_version_detail(slug, &token)? {
        return Ok(Some(detail));
      }
    }
    return Ok(Some(resolved));
  }
  let versions_url = format!(
    "{}/skills/{}/versions",
    API_V1,
    urlencoding::encode(slug)
  );
  if let Some(list) = fetch_json_optional(&versions_url, Duration::from_secs(20))? {
    let versions = extract_version_list(&list);
    if let Some(first) = versions.first() {
      if let Some(token) = extract_version_token(first) {
        if let Some(detail) = fetch_version_detail(slug, &token)? {
          return Ok(Some(detail));
        }
      }
      return Ok(Some(first.clone()));
    }
  }
  Ok(None)
}

fn fetch_version_detail(slug: &str, version: &str) -> AppResult<Option<Value>> {
  let url = format!(
    "{}/skills/{}/versions/{}",
    API_V1,
    urlencoding::encode(slug),
    urlencoding::encode(version)
  );
  fetch_json_optional(&url, Duration::from_secs(20))
}

fn build_skill_page(value: &Value) -> AppResult<RemoteSkillPage> {
  let items = build_skill_summaries(value)?;
  let next_cursor = extract_next_cursor(value);
  Ok(RemoteSkillPage { items, next_cursor })
}

fn build_skill_summaries(value: &Value) -> AppResult<Vec<RemoteSkillSummary>> {
  let list = extract_skill_list(value);

  let mut results = Vec::new();
  for item in list {
    let slug = extract_string(&item, &["slug", "id"])
      .or_else(|| extract_string(&item, &["name"]))
      .unwrap_or_default();
    if slug.trim().is_empty() {
      continue;
    }
    let name = extract_string(&item, &["name", "title", "display_name", "displayName"])
      .unwrap_or_else(|| slug.clone());
    let description = extract_string(&item, &["description", "summary"]);
    let tags = extract_tags(&item);
    let updated_at = extract_string(&item, &[
      "updated_at",
      "updatedAt",
      "published_at",
      "publishedAt",
    ]);

    results.push(RemoteSkillSummary {
      slug,
      name,
      description,
      tags,
      updated_at,
    });
  }

  results.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
  Ok(results)
}

pub fn download_latest_zip(slug: &str) -> AppResult<Vec<u8>> {
  let url = format!(
    "{}/download?slug={}&version=latest",
    API_V1,
    urlencoding::encode(slug)
  );
  match fetch_bytes(&url, Duration::from_secs(40)) {
    Ok(bytes) => Ok(bytes),
    Err(_) => {
      let fallback = format!(
        "{}/download?slug={}&tag=latest",
        API_V1,
        urlencoding::encode(slug)
      );
      fetch_bytes(&fallback, Duration::from_secs(40))
    }
  }
}

pub fn extract_zip_entries(bytes: &[u8]) -> AppResult<Vec<RemoteZipEntry>> {
  let cursor = std::io::Cursor::new(bytes);
  let mut archive = ZipArchive::new(cursor)
    .map_err(|error| AppError::new("zip_open", error.to_string()))?;
  let mut entries = Vec::new();
  for index in 0..archive.len() {
    let mut file = archive
      .by_index(index)
      .map_err(|error| AppError::new("zip_entry", error.to_string()))?;
    if file.is_dir() {
      continue;
    }
    let name = file.name().to_string();
    let rel = sanitize_zip_path(&name)?;
    if rel
      .components()
      .next()
      .and_then(|comp| comp.as_os_str().to_str())
      .map(|segment| segment.eq_ignore_ascii_case("__macosx"))
      == Some(true)
    {
      continue;
    }
    if rel
      .file_name()
      .and_then(|name| name.to_str())
      .map(|name| name.eq_ignore_ascii_case(".ds_store"))
      == Some(true)
    {
      continue;
    }
    let mut buf = Vec::new();
    file
      .read_to_end(&mut buf)
      .map_err(|error| AppError::new("zip_read", error.to_string()))?;
    entries.push(RemoteZipEntry { path: rel, bytes: buf });
  }

  let stripped = strip_common_root(entries);
  Ok(stripped)
}

pub fn list_zip_paths(bytes: &[u8]) -> AppResult<Vec<String>> {
  let cursor = std::io::Cursor::new(bytes);
  let mut archive = ZipArchive::new(cursor)
    .map_err(|error| AppError::new("zip_open", error.to_string()))?;
  let mut paths: Vec<PathBuf> = Vec::new();
  for index in 0..archive.len() {
    let file = archive
      .by_index(index)
      .map_err(|error| AppError::new("zip_entry", error.to_string()))?;
    if file.is_dir() {
      continue;
    }
    let name = file.name().to_string();
    let rel = sanitize_zip_path(&name)?;
    if rel
      .components()
      .next()
      .and_then(|comp| comp.as_os_str().to_str())
      .map(|segment| segment.eq_ignore_ascii_case("__macosx"))
      == Some(true)
    {
      continue;
    }
    if rel
      .file_name()
      .and_then(|name| name.to_str())
      .map(|name| name.eq_ignore_ascii_case(".ds_store"))
      == Some(true)
    {
      continue;
    }
    paths.push(rel);
  }

  let stripped = strip_common_root_paths(paths);
  let mut results: Vec<String> = stripped
    .into_iter()
    .map(|path| path.to_string_lossy().replace('\\', "/"))
    .collect();
  results.sort();
  results.dedup();
  Ok(results)
}

fn sanitize_zip_path(name: &str) -> AppResult<PathBuf> {
  let path = PathBuf::from(name);
  let mut clean = PathBuf::new();
  for component in path.components() {
    match component {
      std::path::Component::Normal(segment) => clean.push(segment),
      std::path::Component::CurDir => {}
      _ => {
        return Err(AppError::new(
          "zip_path",
          format!("Unsafe path in archive: {}", name),
        ));
      }
    }
  }
  if clean.as_os_str().is_empty() {
    return Err(AppError::new("zip_path", "Archive entry has no path"));
  }
  Ok(clean)
}

fn strip_common_root(entries: Vec<RemoteZipEntry>) -> Vec<RemoteZipEntry> {
  if entries.is_empty() {
    return entries;
  }
  let mut root: Option<String> = None;
  for entry in &entries {
    let mut comps = entry.path.components();
    let Some(first) = comps.next() else {
      root = None;
      break;
    };
    if comps.next().is_none() {
      root = None;
      break;
    }
    let first = first.as_os_str().to_string_lossy().to_string();
    match &root {
      Some(existing) if existing != &first => {
        root = None;
        break;
      }
      None => root = Some(first),
      _ => {}
    }
  }
  let Some(root_name) = root else {
    return entries;
  };
  entries
    .into_iter()
    .filter_map(|entry| {
      let mut comps = entry.path.components();
      let first = comps.next()?;
      if first.as_os_str().to_string_lossy() != root_name {
        return Some(entry);
      }
      let mut stripped = PathBuf::new();
      for component in comps {
        stripped.push(component.as_os_str());
      }
      if stripped.as_os_str().is_empty() {
        None
      } else {
        Some(RemoteZipEntry {
          path: stripped,
          bytes: entry.bytes,
        })
      }
    })
    .collect()
}

fn strip_common_root_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
  if paths.is_empty() {
    return paths;
  }
  let mut root: Option<String> = None;
  for path in &paths {
    let mut comps = path.components();
    let Some(first) = comps.next() else {
      root = None;
      break;
    };
    if comps.next().is_none() {
      root = None;
      break;
    }
    let first = first.as_os_str().to_string_lossy().to_string();
    match &root {
      Some(existing) if existing != &first => {
        root = None;
        break;
      }
      None => root = Some(first),
      _ => {}
    }
  }
  let Some(root_name) = root else {
    return paths;
  };
  paths
    .into_iter()
    .filter_map(|path| {
      let mut comps = path.components();
      let first = comps.next()?;
      if first.as_os_str().to_string_lossy() != root_name {
        return Some(path);
      }
      let mut stripped = PathBuf::new();
      for component in comps {
        stripped.push(component.as_os_str());
      }
      if stripped.as_os_str().is_empty() {
        None
      } else {
        Some(stripped)
      }
    })
    .collect()
}

fn extract_string(value: &Value, keys: &[&str]) -> Option<String> {
  for key in keys {
    if let Some(value) = value.get(key).and_then(|val| val.as_str()) {
      return Some(value.to_string());
    }
    if let Some(skill) = value.get("skill") {
      if let Some(value) = skill.get(key).and_then(|val| val.as_str()) {
        return Some(value.to_string());
      }
    }
  }
  None
}

fn extract_tags(value: &Value) -> Vec<String> {
  let mut tags = Vec::new();
  let candidates = ["tags", "labels"]; 
  for key in candidates {
    if let Some(list) = value.get(key).and_then(|val| val.as_array()) {
      for tag in list {
        if let Some(text) = tag.as_str() {
          tags.push(text.to_string());
        }
      }
      if !tags.is_empty() {
        return tags;
      }
    }
    if let Some(skill) = value.get("skill") {
      if let Some(list) = skill.get(key).and_then(|val| val.as_array()) {
        for tag in list {
          if let Some(text) = tag.as_str() {
            tags.push(text.to_string());
          }
        }
        if !tags.is_empty() {
          return tags;
        }
      }
    }
  }
  tags
}

fn extract_skill_md(value: &Value) -> Option<String> {
  if let Some(text) = extract_string(value, &[
    "skill_md",
    "skill_md_content",
    "readme",
    "readme_md",
    "content",
  ]) {
    return Some(text);
  }
  if let Some(text) = extract_from_files(value.get("files")) {
    return Some(text);
  }
  if let Some(skill) = value.get("skill") {
    if let Some(text) = extract_from_files(skill.get("files")) {
      return Some(text);
    }
  }
  if let Some(latest) = value.get("latest") {
    if let Some(text) = extract_from_files(latest.get("files")) {
      return Some(text);
    }
  }
  None
}

fn extract_from_files(files: Option<&Value>) -> Option<String> {
  let list = files?.as_array()?;
  for file in list {
    let path = file
      .get("path")
      .or_else(|| file.get("name"))
      .or_else(|| file.get("file"))
      .and_then(|val| val.as_str())?;
    if path.to_lowercase().ends_with("skill.md") {
      let content = file
        .get("content")
        .or_else(|| file.get("text"))
        .or_else(|| file.get("body"))
        .and_then(|val| val.as_str());
      if let Some(text) = content {
        return Some(text.to_string());
      }
    }
  }
  None
}

fn extract_file_paths(value: &Value) -> Vec<String> {
  let mut results = Vec::new();
  let candidates = ["files", "file_tree", "fileTree", "tree", "entries", "items"];
  for key in candidates {
    if let Some(list) = value.get(key) {
      collect_file_paths(list, &mut results);
    }
    if let Some(skill) = value.get("skill") {
      if let Some(list) = skill.get(key) {
        collect_file_paths(list, &mut results);
      }
    }
    if let Some(latest) = value.get("latest") {
      if let Some(list) = latest.get(key) {
        collect_file_paths(list, &mut results);
      }
    }
  }
  results.retain(|path| !path.trim().is_empty());
  results.sort();
  results.dedup();
  results
}

fn collect_file_paths(value: &Value, results: &mut Vec<String>) {
  if let Some(list) = value.as_array() {
    for item in list {
      collect_file_paths(item, results);
    }
    return;
  }
  if let Some(path) = value.as_str() {
    results.push(path.to_string());
    return;
  }
  let Some(obj) = value.as_object() else {
    return;
  };

  let kind = obj
    .get("type")
    .or_else(|| obj.get("kind"))
    .and_then(|val| val.as_str())
    .map(|val| val.to_lowercase());
  let is_dir = matches!(
    kind.as_deref(),
    Some("dir") | Some("directory") | Some("folder")
  );

  if let Some(path) = obj
    .get("path")
    .or_else(|| obj.get("name"))
    .or_else(|| obj.get("file"))
    .and_then(|val| val.as_str())
  {
    if !is_dir {
      results.push(path.to_string());
    }
  }

  if let Some(children) = obj.get("children") {
    collect_file_paths(children, results);
  }
  if let Some(items) = obj.get("items") {
    collect_file_paths(items, results);
  }
  if let Some(files) = obj.get("files") {
    collect_file_paths(files, results);
  }
}

fn extract_download_url(value: &Value) -> Option<String> {
  for key in [
    "download_url",
    "downloadUrl",
    "zip_url",
    "zipUrl",
    "archive_url",
    "archiveUrl",
  ] {
    if let Some(url) = value.get(key).and_then(|val| val.as_str()) {
      return Some(url.to_string());
    }
  }
  if let Some(skill) = value.get("skill") {
    if let Some(url) = extract_download_url(skill) {
      return Some(url);
    }
  }
  if let Some(latest) = value.get("latest") {
    if let Some(url) = extract_download_url(latest) {
      return Some(url);
    }
  }
  if let Some(version) = value.get("version") {
    if let Some(url) = extract_download_url(version) {
      return Some(url);
    }
  }
  if let Some(versions) = value.get("versions").and_then(|val| val.as_array()) {
    for version in versions {
      if let Some(url) = extract_download_url(version) {
        return Some(url);
      }
    }
  }
  None
}

fn extract_skill_md_from_sources(sources: &[&Value]) -> Option<String> {
  for source in sources {
    if let Some(text) = extract_skill_md(source) {
      return Some(text);
    }
  }
  None
}

fn extract_file_paths_from_sources(sources: &[&Value]) -> Vec<String> {
  let mut paths = Vec::new();
  for source in sources {
    let source_paths = extract_file_paths(source);
    for path in source_paths {
      if !paths.contains(&path) {
        paths.push(path);
      }
    }
  }
  paths
}

fn extract_from_sources(sources: &[&Value], keys: &[&str]) -> Option<String> {
  for source in sources {
    if let Some(value) = extract_string(source, keys) {
      return Some(value);
    }
  }
  None
}

fn extract_tags_from_sources(sources: &[&Value]) -> Vec<String> {
  let mut tags = Vec::new();
  for source in sources {
    let source_tags = extract_tags(source);
    for tag in source_tags {
      if !tags.contains(&tag) {
        tags.push(tag);
      }
    }
  }
  tags
}

fn extract_skill_list(value: &Value) -> Vec<Value> {
  if let Some(items) = value.as_array() {
    return items.clone();
  }
  if let Some(items) = value.get("skills").and_then(|val| val.as_array()) {
    return items.clone();
  }
  if let Some(items) = value
    .get("skills")
    .and_then(|val| val.get("items"))
    .and_then(|val| val.as_array())
  {
    return items.clone();
  }
  if let Some(items) = value.get("data").and_then(|val| val.as_array()) {
    return items.clone();
  }
  if let Some(items) = value
    .get("data")
    .and_then(|val| val.get("items"))
    .and_then(|val| val.as_array())
  {
    return items.clone();
  }
  if let Some(items) = value
    .get("data")
    .and_then(|val| val.get("skills"))
    .and_then(|val| val.as_array())
  {
    return items.clone();
  }
  if let Some(items) = value.get("items").and_then(|val| val.as_array()) {
    return items.clone();
  }
  if let Some(items) = value.get("results").and_then(|val| val.as_array()) {
    return items.clone();
  }
  Vec::new()
}

fn extract_version_list(value: &Value) -> Vec<Value> {
  if let Some(items) = value.as_array() {
    return items.clone();
  }
  if let Some(items) = value.get("versions").and_then(|val| val.as_array()) {
    return items.clone();
  }
  if let Some(items) = value
    .get("data")
    .and_then(|val| val.get("versions"))
    .and_then(|val| val.as_array())
  {
    return items.clone();
  }
  if let Some(items) = value.get("data").and_then(|val| val.as_array()) {
    return items.clone();
  }
  if let Some(items) = value.get("items").and_then(|val| val.as_array()) {
    return items.clone();
  }
  if let Some(items) = value.get("results").and_then(|val| val.as_array()) {
    return items.clone();
  }
  Vec::new()
}
fn extract_next_cursor(value: &Value) -> Option<String> {
  let direct_keys = ["next_cursor", "nextCursor", "next", "cursor"]; 
  for key in direct_keys {
    if let Some(value) = value.get(key).and_then(|val| val.as_str()) {
      if !value.trim().is_empty() {
        return Some(value.to_string());
      }
    }
  }
  if let Some(pagination) = value.get("pagination") {
    for key in ["next_cursor", "nextCursor", "cursor", "next"] {
      if let Some(value) = pagination.get(key).and_then(|val| val.as_str()) {
        if !value.trim().is_empty() {
          return Some(value.to_string());
        }
      }
    }
  }
  if let Some(meta) = value.get("meta") {
    for key in ["next_cursor", "nextCursor", "cursor", "next"] {
      if let Some(value) = meta.get(key).and_then(|val| val.as_str()) {
        if !value.trim().is_empty() {
          return Some(value.to_string());
        }
      }
    }
  }
  None
}

fn fetch_skill_file_text(
  slug: &str,
  path: &str,
  version: Option<&str>,
) -> AppResult<Option<String>> {
  let mut attempts = Vec::new();
  if let Some(value) = version {
    if !value.trim().is_empty() {
      attempts.push(format!(
        "{}/skills/{}/file?path={}&version={}",
        API_V1,
        urlencoding::encode(slug),
        urlencoding::encode(path),
        urlencoding::encode(value)
      ));
    }
  }
  attempts.push(format!(
    "{}/skills/{}/file?path={}&tag=latest",
    API_V1,
    urlencoding::encode(slug),
    urlencoding::encode(path)
  ));
  attempts.push(format!(
    "{}/skills/{}/file?path={}",
    API_V1,
    urlencoding::encode(slug),
    urlencoding::encode(path)
  ));

  for url in attempts {
    let client = build_client(Duration::from_secs(20))?;
    let response = client
      .get(url)
      .send()
      .map_err(|error| AppError::new("http_request", error.to_string()))?;
    if response.status().is_client_error() || response.status().is_server_error() {
      continue;
    }
    let body = response
      .text()
      .map_err(|error| AppError::new("http_text", error.to_string()))?;
    let trimmed = body.trim_start();
    if trimmed.starts_with('{') {
      if let Ok(value) = serde_json::from_str::<Value>(&body) {
        if let Some(content) = value
          .get("content")
          .or_else(|| value.get("text"))
          .or_else(|| value.get("body"))
          .or_else(|| value.get("data").and_then(|data| data.get("content")))
          .and_then(|val| val.as_str())
        {
          return Ok(Some(content.to_string()));
        }
      }
    }
    if !body.trim().is_empty() {
      return Ok(Some(body));
    }
  }
  Ok(None)
}

fn extract_version_token(value: &Value) -> Option<String> {
  if let Some(value) = extract_string_number(value, &[
    "version",
    "version_id",
    "versionId",
    "latest_version",
    "latestVersion",
    "latest_version_id",
    "latestVersionId",
  ]) {
    return Some(value);
  }
  for key in ["latest", "version", "latest_version", "latestVersion"] {
    if let Some(nested) = value.get(key) {
      if let Some(value) = extract_string_number(nested, &["id", "version", "version_id"]) {
        return Some(value);
      }
    }
  }
  None
}

fn extract_string_number(value: &Value, keys: &[&str]) -> Option<String> {
  for key in keys {
    if let Some(value) = value.get(key) {
      if let Some(text) = value.as_str() {
        if !text.trim().is_empty() {
          return Some(text.to_string());
        }
      }
      if let Some(number) = value.as_i64() {
        return Some(number.to_string());
      }
      if let Some(number) = value.as_u64() {
        return Some(number.to_string());
      }
    }
  }
  None
}

fn fetch_json(url: &str, timeout: Duration) -> AppResult<Value> {
  let client = build_client(timeout)?;
  let response = client
    .get(url)
    .send()
    .map_err(|error| AppError::new("http_request", error.to_string()))?
    .error_for_status()
    .map_err(|error| AppError::new("http_status", error.to_string()))?;
  response
    .json()
    .map_err(|error| AppError::new("http_parse", error.to_string()))
}

fn fetch_json_optional(url: &str, timeout: Duration) -> AppResult<Option<Value>> {
  let client = build_client(timeout)?;
  let response = client
    .get(url)
    .send()
    .map_err(|error| AppError::new("http_request", error.to_string()))?;
  if response.status() == StatusCode::NOT_FOUND {
    return Ok(None);
  }
  if !response.status().is_success() {
    return Err(AppError::new(
      "http_status",
      format!("Request failed ({})", response.status()),
    ));
  }
  let value = response
    .json()
    .map_err(|error| AppError::new("http_parse", error.to_string()))?;
  Ok(Some(value))
}

fn fetch_bytes(url: &str, timeout: Duration) -> AppResult<Vec<u8>> {
  let client = build_client(timeout)?;
  let response = client
    .get(url)
    .send()
    .map_err(|error| AppError::new("http_request", error.to_string()))?
    .error_for_status()
    .map_err(|error| AppError::new("http_status", error.to_string()))?;
  let bytes = response
    .bytes()
    .map_err(|error| AppError::new("http_bytes", error.to_string()))?;
  Ok(bytes.to_vec())
}



