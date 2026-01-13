use toml_edit::{ArrayOfTables, DocumentMut, Item, Table, Value, value};

use crate::errors::{AppError, AppResult};
use crate::models::ScalarValue;

pub fn set_root_scalar(input: &str, key: &str, scalar: ScalarValue) -> AppResult<String> {
  let mut doc = parse_doc(input)?;
  match scalar {
    ScalarValue::String(inner) => {
      doc[key] = value(inner);
    }
    ScalarValue::Integer(inner) => {
      doc[key] = value(inner);
    }
    ScalarValue::Float(inner) => {
      doc[key] = value(inner);
    }
    ScalarValue::Boolean(inner) => {
      doc[key] = value(inner);
    }
  }
  Ok(render_doc(input, &doc))
}

pub fn set_value_at_path(
  input: &str,
  path: &[String],
  scalar: ScalarValue,
) -> AppResult<String> {
  if path.is_empty() {
    return Err(AppError::new("path", "Path cannot be empty"));
  }
  let mut doc = parse_doc(input)?;
  let mut current = doc.as_item_mut();
  for (index, segment) in path.iter().enumerate() {
    let is_last = index + 1 == path.len();
    match current {
      Item::Table(table) => {
        if is_last {
          let existing = table
            .get(segment)
            .ok_or_else(|| AppError::new("path_missing", "Config path not found"))?;
          if existing.is_table() || existing.is_array_of_tables() {
            return Err(AppError::new(
              "path_invalid",
              "Config path points to a table",
            ));
          }
          table[segment] = scalar_to_item(scalar);
          return Ok(render_doc(input, &doc));
        }
        let next = table
          .get_mut(segment)
          .ok_or_else(|| AppError::new("path_missing", "Config path not found"))?;
        if !next.is_table() {
          return Err(AppError::new("path_invalid", "Config path is not a table"));
        }
        current = next;
      }
      _ => {
        return Err(AppError::new("path_invalid", "Config path is not a table"));
      }
    }
  }
  Err(AppError::new("path", "Unable to update config path"))
}

pub fn set_mcp_enabled(input: &str, name: &str, enabled: bool) -> AppResult<String> {
  let mut doc = parse_doc(input)?;
  let servers = doc
    .get_mut("mcp_servers")
    .and_then(Item::as_table_mut)
    .ok_or_else(|| AppError::new("mcp_missing", "mcp_servers table not found"))?;

  let server = servers
    .get_mut(name)
    .ok_or_else(|| AppError::new("mcp_missing", "MCP server not found"))?;
  let server_table = server
    .as_table_mut()
    .ok_or_else(|| AppError::new("mcp_invalid", "MCP server is not a table"))?;
  server_table["enabled"] = value(enabled);
  Ok(render_doc(input, &doc))
}

pub fn upsert_mcp_server(input: &str, name: &str, table_toml: &str) -> AppResult<String> {
  let mut doc = parse_doc(input)?;
  let safe_name = name.replace('"', "\\\"");
  let snippet = if table_toml.trim().is_empty() {
    format!("[mcp_servers.\"{}\"]\n", safe_name)
  } else {
    format!("[mcp_servers.\"{}\"]\n{}", safe_name, table_toml)
  };
  let parsed = parse_doc(&snippet)?;
  let new_item = parsed
    .get("mcp_servers")
    .and_then(Item::as_table)
    .and_then(|table| table.get(name))
    .ok_or_else(|| AppError::new("mcp_invalid", "Unable to parse MCP table"))?
    .clone();

  let servers = doc["mcp_servers"].or_insert(Item::Table(Table::new()));
  let server_table = servers
    .as_table_mut()
    .ok_or_else(|| AppError::new("mcp_invalid", "mcp_servers is not a table"))?;
  server_table.insert(name, new_item);
  Ok(render_doc(input, &doc))
}

pub fn delete_mcp_server(input: &str, name: &str) -> AppResult<String> {
  let mut doc = parse_doc(input)?;
  if let Some(servers) = doc.get_mut("mcp_servers").and_then(Item::as_table_mut) {
    servers.remove(name);
  }
  Ok(render_doc(input, &doc))
}

pub fn redact_toml(input: &str) -> AppResult<String> {
  let mut doc = parse_doc(input)?;
  redact_item(doc.as_item_mut());
  Ok(render_doc(input, &doc))
}

pub fn merge_sensitive_values(current: &str, edited: &str) -> AppResult<String> {
  let current_doc = parse_doc(current)?;
  let mut edited_doc = parse_doc(edited)?;
  copy_sensitive_item(current_doc.as_item(), edited_doc.as_item_mut());
  Ok(render_doc(edited, &edited_doc))
}

pub fn contains_sensitive_keys(input: &str) -> bool {
  let doc = match parse_doc(input) {
    Ok(doc) => doc,
    Err(_) => return false,
  };
  contains_sensitive_item(doc.as_item())
}

fn parse_doc(input: &str) -> AppResult<DocumentMut> {
  Ok(input.parse::<DocumentMut>()?)
}

fn render_doc(input: &str, doc: &DocumentMut) -> String {
  let mut output = doc.to_string();
  if !input.ends_with('\n') {
    while output.ends_with('\n') {
      output.pop();
    }
  }
  output
}

fn scalar_to_item(scalar: ScalarValue) -> Item {
  match scalar {
    ScalarValue::String(inner) => value(inner),
    ScalarValue::Integer(inner) => value(inner),
    ScalarValue::Float(inner) => value(inner),
    ScalarValue::Boolean(inner) => value(inner),
  }
}

fn redact_item(item: &mut Item) {
  match item {
    Item::Table(table) => redact_table(table),
    Item::ArrayOfTables(array) => {
      for table in array.iter_mut() {
        redact_table(table);
      }
    }
    Item::Value(Value::InlineTable(table)) => {
      for (key, value) in table.iter_mut() {
        let key_name = key.to_string();
        if is_sensitive_key(&key_name) {
          *value = Value::from("<redacted>");
        }
      }
    }
    _ => {}
  }
}

fn redact_table(table: &mut Table) {
  for (key, item) in table.iter_mut() {
    let key_name = key.to_string();
    if is_sensitive_key(&key_name) {
      *item = value("<redacted>");
    } else {
      redact_item(item);
    }
  }
}

fn contains_sensitive_item(item: &Item) -> bool {
  match item {
    Item::Table(table) => contains_sensitive_table(table),
    Item::ArrayOfTables(array) => array.iter().any(contains_sensitive_table),
    Item::Value(Value::InlineTable(table)) => table.iter().any(|(key, _value)| {
      let key_name = key.to_string();
      is_sensitive_key(&key_name)
    }),
    _ => false,
  }
}

fn contains_sensitive_table(table: &Table) -> bool {
  for (key, value) in table.iter() {
    let key_name = key.to_string();
    if is_sensitive_key(&key_name) {
      return true;
    }
    if contains_sensitive_item(value) {
      return true;
    }
  }
  false
}

fn copy_sensitive_item(src: &Item, dest: &mut Item) {
  match (src, dest) {
    (Item::Table(src_table), Item::Table(dest_table)) => {
      copy_sensitive_table(src_table, dest_table)
    }
    (Item::ArrayOfTables(src_array), Item::ArrayOfTables(dest_array)) => {
      copy_sensitive_arrays(src_array, dest_array)
    }
    _ => {}
  }
}

fn copy_sensitive_table(src: &Table, dest: &mut Table) {
  for (key, value) in src.iter() {
    let key_name = key.to_string();
    if is_sensitive_key(&key_name) {
      dest.insert(key, value.clone());
      continue;
    }
    if let Some(dest_value) = dest.get_mut(key) {
      copy_sensitive_item(value, dest_value);
    }
  }
}

fn copy_sensitive_arrays(src: &ArrayOfTables, dest: &mut ArrayOfTables) {
  for (src_table, dest_table) in src.iter().zip(dest.iter_mut()) {
    copy_sensitive_table(src_table, dest_table);
  }
}

fn is_sensitive_key(key: &str) -> bool {
  let key = key.to_ascii_lowercase();
  key.contains("token")
    || key.contains("secret")
    || key.contains("api_key")
    || key.contains("apikey")
    || key.contains("password")
    || key.contains("bearer")
}
