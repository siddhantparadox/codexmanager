use codex_manager::models::ScalarValue;
use codex_manager::toml_patch::{set_mcp_enabled, set_root_scalar, set_value_at_path};

#[test]
fn toggle_mcp_preserves_structure() {
  let input = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/config.toml"));
  let expected = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/fixtures/config_toggle_expected.toml"
  ));
  let output = set_mcp_enabled(input, "sample", false).expect("patch failed");
  assert_eq!(output, expected);
}

#[test]
fn set_root_scalar_updates_value() {
  let input = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/config.toml"));
  let output = set_root_scalar(input, "temperature", ScalarValue::Float(0.8))
    .expect("patch failed");
  assert!(output.contains("temperature = 0.8"));
}

#[test]
fn set_value_at_path_updates_nested_value() {
  let input = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/config.toml"));
  let path = vec![
    "mcp_servers".to_string(),
    "sample".to_string(),
    "enabled".to_string(),
  ];
  let output = set_value_at_path(input, &path, ScalarValue::Boolean(false))
    .expect("patch failed");
  assert!(output.contains("enabled = false"));
}
