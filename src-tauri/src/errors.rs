use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct AppError {
  pub code: String,
  pub message: String,
}

pub type AppResult<T> = Result<T, AppError>;

impl AppError {
  pub fn new(code: &str, message: impl Into<String>) -> Self {
    Self {
      code: code.to_string(),
      message: message.into(),
    }
  }
}

impl From<std::io::Error> for AppError {
  fn from(error: std::io::Error) -> Self {
    Self::new("io_error", error.to_string())
  }
}

impl From<toml::de::Error> for AppError {
  fn from(error: toml::de::Error) -> Self {
    Self::new("toml_parse", error.to_string())
  }
}

impl From<toml_edit::TomlError> for AppError {
  fn from(error: toml_edit::TomlError) -> Self {
    Self::new("toml_edit", error.to_string())
  }
}

impl From<serde_json::Error> for AppError {
  fn from(error: serde_json::Error) -> Self {
    Self::new("serde_json", error.to_string())
  }
}