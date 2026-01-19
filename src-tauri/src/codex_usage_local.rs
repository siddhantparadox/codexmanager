use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use serde_json::Value;
use time::format_description::well_known::Rfc3339;
use time::{Date, Duration, Month, OffsetDateTime, UtcOffset};
use walkdir::WalkDir;

use crate::errors::AppResult;
use crate::models::{
  CodexLocalUsageSummary, UsageBreakdown, UsageDailyPoint, UsageTotals,
};
use crate::paths::default_codex_home;

#[tauri::command]
pub fn codex_get_local_usage_summary(
  codex_home: Option<String>,
) -> AppResult<CodexLocalUsageSummary> {
  let codex_home = resolve_codex_home_arg(codex_home.as_deref())?;
  let sessions_dir = codex_home.join("sessions");
  let offset = current_local_offset();
  compute_local_usage_summary(&sessions_dir, offset)
}

fn resolve_codex_home_arg(codex_home: Option<&str>) -> AppResult<PathBuf> {
  if let Some(value) = codex_home.filter(|value| !value.trim().is_empty()) {
    return Ok(PathBuf::from(value));
  }
  default_codex_home()
}

fn current_local_offset() -> UtcOffset {
  UtcOffset::current_local_offset().unwrap_or(UtcOffset::UTC)
}

fn compute_local_usage_summary(
  sessions_dir: &Path,
  offset: UtcOffset,
) -> AppResult<CodexLocalUsageSummary> {
  let today = OffsetDateTime::now_utc().to_offset(offset).date();
  compute_local_usage_summary_inner(sessions_dir, offset, today)
}

fn compute_local_usage_summary_inner(
  sessions_dir: &Path,
  offset: UtcOffset,
  today: Date,
) -> AppResult<CodexLocalUsageSummary> {
  let sessions_dir_exists = sessions_dir.is_dir();
  let sessions_path = sessions_dir.to_string_lossy().to_string();
  let year = today.year();
  let year_start = Date::from_calendar_date(year, Month::January, 1).ok();
  let max_window_days = year_start
    .and_then(|start| (today - start).whole_days().checked_add(1))
    .unwrap_or(365)
    .max(365);

  let mut daily: HashMap<Date, UsageTotals> = HashMap::new();
  let mut daily_by_model: HashMap<Date, HashMap<String, UsageTotals>> = HashMap::new();
  let mut daily_by_project: HashMap<Date, HashMap<String, UsageTotals>> =
    HashMap::new();

  let mut sessions_scanned = 0u64;
  let mut token_events_scanned = 0u64;
  let mut turn_events_scanned = 0u64;

  if sessions_dir_exists {
    for entry in WalkDir::new(sessions_dir)
      .follow_links(false)
      .into_iter()
      .filter_map(Result::ok)
    {
      if !entry.file_type().is_file() {
        continue;
      }
      let path = entry.path();
      let extension = path.extension().and_then(|value| value.to_str());
      if extension
        .map(|value| !value.eq_ignore_ascii_case("jsonl"))
        .unwrap_or(true)
      {
        continue;
      }

      sessions_scanned += 1;

      let file = File::open(&path)?;
      let reader = BufReader::new(file);

      let mut current_model: Option<String> = None;
      let mut current_cwd: Option<String> = None;
      let mut prev = TotalsState::default();

      for line in reader.lines() {
        let line = match line {
          Ok(value) => value,
          Err(_) => continue,
        };
        if line.trim().is_empty() {
          continue;
        }

        let parsed: Value = match serde_json::from_str(&line) {
          Ok(value) => value,
          Err(_) => continue,
        };

        let kind = parsed.get("type").and_then(|value| value.as_str());
        if kind == Some("turn_context") {
          turn_events_scanned += 1;
          if let Some(payload) = parsed.get("payload") {
            current_model = payload
              .get("model")
              .and_then(|value| value.as_str())
              .map(|value| value.to_string());
            current_cwd = payload
              .get("cwd")
              .and_then(|value| value.as_str())
              .map(|value| value.to_string());
          }
          continue;
        }

        if kind != Some("event_msg") {
          continue;
        }

        let payload = match parsed.get("payload") {
          Some(value) => value,
          None => continue,
        };
        let payload_type = payload.get("type").and_then(|value| value.as_str());
        if payload_type != Some("token_count") {
          continue;
        }

        token_events_scanned += 1;

        let timestamp = match parsed.get("timestamp").and_then(|value| value.as_str()) {
          Some(value) => value,
          None => continue,
        };
        let date = match parse_local_date(timestamp, offset) {
          Some(value) => value,
          None => continue,
        };

        let days_ago = (today - date).whole_days();
        if days_ago < 0 || days_ago >= max_window_days {
          continue;
        }

        let info = match payload.get("info") {
          Some(value) => value,
          None => continue,
        };
        let total_obj = match info.get("total_token_usage") {
          Some(value) => value,
          None => continue,
        };
        let next_total = match parse_totals(total_obj) {
          Some(value) => value,
          None => continue,
        };
        let last_usage = info
          .get("last_token_usage")
          .and_then(parse_totals);
        let delta = totals_delta(&prev, &next_total, last_usage);

        prev.total = next_total;
        prev.has_total = true;

        daily.entry(date).or_default().add_assign(&delta);
        if let Some(model) = current_model.clone() {
          daily_by_model
            .entry(date)
            .or_default()
            .entry(model)
            .or_default()
            .add_assign(&delta);
        }
        if let Some(cwd) = current_cwd.clone() {
          daily_by_project
            .entry(date)
            .or_default()
            .entry(cwd)
            .or_default()
            .add_assign(&delta);
        }
      }
    }
  }

  let today_totals = daily.get(&today).cloned().unwrap_or_default();
  let last7 = sum_range(&daily, today, 7);
  let last30 = sum_range(&daily, today, 30);
  let year_total = sum_year_to_date(&daily, year_start, today);
  let year_stats = compute_year_stats(&daily, year_start, today);
  let project_count_year = count_projects_year(&daily_by_project, year_start, today);
  let daily_last365 = build_daily_series(&daily, today);
  let by_model_last30 = build_breakdown(&daily_by_model, today, 30, None);
  let by_project_last30 = build_breakdown(&daily_by_project, today, 30, Some(20));
  let days_in_year = year_start
    .and_then(|start| (today - start).whole_days().checked_add(1))
    .unwrap_or(0);
  let by_model_year = if days_in_year > 0 {
    build_breakdown(&daily_by_model, today, days_in_year, Some(5))
  } else {
    Vec::new()
  };
  let by_project_year = if days_in_year > 0 {
    build_breakdown(&daily_by_project, today, days_in_year, Some(5))
  } else {
    Vec::new()
  };

  Ok(CodexLocalUsageSummary {
    year,
    year_total,
    started_on: year_stats.started_on.map(|date| date.to_string()),
    most_active_on: year_stats.most_active_on.map(|date| date.to_string()),
    most_active_total_tokens: year_stats.most_active_total_tokens,
    streak_days: year_stats.streak_days,
    active_days_year: year_stats.active_days_year,
    project_count_year,
    turn_events_scanned,
    today: today_totals,
    last7,
    last30,
    daily_last365,
    by_model_last30,
    by_project_last30,
    by_model_year,
    by_project_year,
    sessions_path,
    sessions_dir_exists,
    sessions_scanned,
    token_events_scanned,
  })
}

fn sum_range(daily: &HashMap<Date, UsageTotals>, today: Date, days: i64) -> UsageTotals {
  let mut out = UsageTotals::default();
  for i in 0..days {
    let date = today - Duration::days(i);
    if let Some(totals) = daily.get(&date) {
      out.add_assign(totals);
    }
  }
  out
}

fn build_daily_series(
  daily: &HashMap<Date, UsageTotals>,
  today: Date,
) -> Vec<UsageDailyPoint> {
  let mut series = Vec::with_capacity(365);
  for i in (0..365).rev() {
    let date = today - Duration::days(i as i64);
    let totals = daily.get(&date).cloned().unwrap_or_default();
    series.push(UsageDailyPoint {
      date: date.to_string(),
      total_tokens: totals.total_tokens,
      input_tokens: totals.input_tokens,
      cached_input_tokens: totals.cached_input_tokens,
      output_tokens: totals.output_tokens,
      reasoning_output_tokens: totals.reasoning_output_tokens,
    });
  }
  series
}

fn build_breakdown(
  daily: &HashMap<Date, HashMap<String, UsageTotals>>,
  today: Date,
  days: i64,
  limit: Option<usize>,
) -> Vec<UsageBreakdown> {
  let mut map: HashMap<String, UsageTotals> = HashMap::new();
  for i in 0..days {
    let date = today - Duration::days(i);
    if let Some(entries) = daily.get(&date) {
      for (key, totals) in entries {
        map.entry(key.clone()).or_default().add_assign(totals);
      }
    }
  }

  let mut items: Vec<UsageBreakdown> = map
    .into_iter()
    .map(|(key, totals)| UsageBreakdown { key, totals })
    .collect();
  items.sort_by(|a, b| b.totals.total_tokens.cmp(&a.totals.total_tokens));
  if let Some(limit) = limit {
    items.truncate(limit);
  }
  items
}

fn sum_year_to_date(
  daily: &HashMap<Date, UsageTotals>,
  year_start: Option<Date>,
  today: Date,
) -> UsageTotals {
  let mut out = UsageTotals::default();
  let Some(start) = year_start else {
    return out;
  };
  let days = (today - start).whole_days();
  if days < 0 {
    return out;
  }
  for i in 0..=days {
    let date = start + Duration::days(i);
    if let Some(totals) = daily.get(&date) {
      out.add_assign(totals);
    }
  }
  out
}

struct YearStats {
  started_on: Option<Date>,
  most_active_on: Option<Date>,
  most_active_total_tokens: u64,
  streak_days: u64,
  active_days_year: u64,
}

fn compute_year_stats(
  daily: &HashMap<Date, UsageTotals>,
  year_start: Option<Date>,
  today: Date,
) -> YearStats {
  let mut started_on = None;
  let mut most_active_on = None;
  let mut most_active_total_tokens = 0u64;
  let mut active_days_year = 0u64;

  if let Some(start) = year_start {
    let days = (today - start).whole_days();
    if days >= 0 {
      for i in 0..=days {
        let date = start + Duration::days(i);
        let total = daily
          .get(&date)
          .map(|totals| totals.total_tokens)
          .unwrap_or(0);
        if total > 0 {
          active_days_year += 1;
          if started_on.is_none() {
            started_on = Some(date);
          }
          if total > most_active_total_tokens {
            most_active_total_tokens = total;
            most_active_on = Some(date);
          }
        }
      }
    }
  }

  let streak_days = compute_streak(daily, year_start, today);

  YearStats {
    started_on,
    most_active_on,
    most_active_total_tokens,
    streak_days,
    active_days_year,
  }
}

fn compute_streak(
  daily: &HashMap<Date, UsageTotals>,
  year_start: Option<Date>,
  today: Date,
) -> u64 {
  let mut streak = 0u64;
  let mut offset = 0i64;
  loop {
    let date = match today.checked_sub(Duration::days(offset)) {
      Some(value) => value,
      None => break,
    };
    if let Some(start) = year_start {
      if date < start {
        break;
      }
    }
    let total = daily
      .get(&date)
      .map(|totals| totals.total_tokens)
      .unwrap_or(0);
    if total == 0 {
      break;
    }
    streak += 1;
    offset += 1;
  }
  streak
}

fn count_projects_year(
  daily_by_project: &HashMap<Date, HashMap<String, UsageTotals>>,
  year_start: Option<Date>,
  today: Date,
) -> u64 {
  let Some(start) = year_start else {
    return 0;
  };
  let mut projects: HashSet<String> = HashSet::new();
  for (date, map) in daily_by_project {
    if *date < start || *date > today {
      continue;
    }
    for key in map.keys() {
      projects.insert(key.clone());
    }
  }
  projects.len() as u64
}

#[derive(Debug, Clone, Default)]
struct TotalsState {
  total: UsageTotals,
  has_total: bool,
}

fn parse_totals(obj: &Value) -> Option<UsageTotals> {
  let input_tokens = obj.get("input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
  let cached_input_tokens = obj
    .get("cached_input_tokens")
    .and_then(|v| v.as_u64())
    .unwrap_or(0);
  let output_tokens = obj.get("output_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
  let reasoning_output_tokens = obj
    .get("reasoning_output_tokens")
    .and_then(|v| v.as_u64())
    .unwrap_or(0);
  let total_tokens = obj
    .get("total_tokens")
    .and_then(|v| v.as_u64())
    .unwrap_or_else(|| {
      input_tokens
        .saturating_add(cached_input_tokens)
        .saturating_add(output_tokens)
        .saturating_add(reasoning_output_tokens)
    });
  Some(UsageTotals {
    input_tokens,
    cached_input_tokens,
    output_tokens,
    reasoning_output_tokens,
    total_tokens,
  })
}

fn totals_delta(
  prev: &TotalsState,
  next_total: &UsageTotals,
  last_usage_fallback: Option<UsageTotals>,
) -> UsageTotals {
  if prev.has_total {
    let safe_sub = |current: u64, prior: u64| {
      if current >= prior {
        current - prior
      } else {
        current
      }
    };
    UsageTotals {
      input_tokens: safe_sub(next_total.input_tokens, prev.total.input_tokens),
      cached_input_tokens: safe_sub(
        next_total.cached_input_tokens,
        prev.total.cached_input_tokens,
      ),
      output_tokens: safe_sub(next_total.output_tokens, prev.total.output_tokens),
      reasoning_output_tokens: safe_sub(
        next_total.reasoning_output_tokens,
        prev.total.reasoning_output_tokens,
      ),
      total_tokens: safe_sub(next_total.total_tokens, prev.total.total_tokens),
    }
  } else {
    last_usage_fallback.unwrap_or_else(|| next_total.clone())
  }
}

fn parse_local_date(timestamp: &str, offset: UtcOffset) -> Option<Date> {
  let parsed = OffsetDateTime::parse(timestamp, &Rfc3339).ok()?;
  Some(parsed.to_offset(offset).date())
}

impl UsageTotals {
  fn add_assign(&mut self, other: &UsageTotals) {
    self.input_tokens = self.input_tokens.saturating_add(other.input_tokens);
    self.cached_input_tokens = self
      .cached_input_tokens
      .saturating_add(other.cached_input_tokens);
    self.output_tokens = self.output_tokens.saturating_add(other.output_tokens);
    self.reasoning_output_tokens = self
      .reasoning_output_tokens
      .saturating_add(other.reasoning_output_tokens);
    self.total_tokens = self.total_tokens.saturating_add(other.total_tokens);
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use time::Month;

  #[test]
  fn aggregates_token_deltas_with_context() {
    let fixtures = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
      .join("tests")
      .join("fixtures")
      .join("usage");
    let today = Date::from_calendar_date(2025, Month::September, 19).unwrap();
    let summary =
      compute_local_usage_summary_inner(&fixtures, UtcOffset::UTC, today).unwrap();

    assert!(summary.sessions_dir_exists);
    assert_eq!(summary.sessions_scanned, 1);
    assert_eq!(summary.token_events_scanned, 2);
    assert_eq!(summary.turn_events_scanned, 1);
    assert_eq!(summary.year, 2025);
    assert_eq!(summary.year_total.total_tokens, 230);
    assert_eq!(summary.started_on.as_deref(), Some("2025-09-19"));
    assert_eq!(summary.most_active_on.as_deref(), Some("2025-09-19"));
    assert_eq!(summary.most_active_total_tokens, 230);
    assert_eq!(summary.streak_days, 1);
    assert_eq!(summary.active_days_year, 1);
    assert_eq!(summary.project_count_year, 1);
    assert_eq!(summary.today.total_tokens, 230);
    assert_eq!(summary.last30.total_tokens, 230);
    assert_eq!(summary.by_model_last30.len(), 1);
    assert_eq!(summary.by_model_last30[0].key, "gpt-5-codex");
    assert_eq!(summary.by_model_last30[0].totals.total_tokens, 230);
    assert_eq!(summary.by_project_last30.len(), 1);
    assert_eq!(summary.by_project_last30[0].key, "/repo-one");
  }
}
