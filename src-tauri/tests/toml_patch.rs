use codex_manager::models::{ConfigPathChange, ScalarValue};
use codex_manager::toml_patch::{
  set_mcp_enabled, set_root_scalar, set_value_at_path, set_values_at_paths,
};

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

#[test]
fn set_values_at_paths_creates_tables_and_orders_root_keys() {
  let input = "alpha = 1\n\n[table]\nvalue = 2\n";
  let changes = vec![
    ConfigPathChange {
      path: vec!["beta".to_string()],
      value: ScalarValue::String("ok".to_string()),
    },
    ConfigPathChange {
      path: vec![
        "shell_environment_policy".to_string(),
        "include_only".to_string(),
      ],
      value: ScalarValue::StringList(vec!["PATH".to_string(), "HOME".to_string()]),
    },
  ];
  let output = set_values_at_paths(input, &changes).expect("patch failed");
  let table_index = output.find("[table]").expect("table header");
  let beta_index = output.find("beta =").expect("beta entry");
  assert!(beta_index < table_index);
  assert!(output.contains("[shell_environment_policy]"));
  assert!(output.contains("include_only"));
  assert!(output.contains("PATH"));
  assert!(output.contains("HOME"));
}

#[test]
fn set_values_at_paths_accepts_empty_input() {
  let input = "";
  let changes = vec![ConfigPathChange {
    path: vec!["model".to_string()],
    value: ScalarValue::String("gpt-5.2-codex".to_string()),
  }];
  let output = set_values_at_paths(input, &changes).expect("patch failed");
  assert!(output.contains("model = \"gpt-5.2-codex\""));
}
