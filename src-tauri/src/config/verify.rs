use serde::{Deserialize, Serialize};
use crate::config::AuthScheme;
use tauri::command;
use async_trait::async_trait;
use reqwest::Client;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VerificationResult {
    pub success: bool,
    pub message: String,
    pub available_models: Vec<String>,
}

#[async_trait]
pub trait LlmProviderVerifier: Send + Sync {
    async fn verify(
        &self,
        client: &Client,
        base_url: &str,
        auth: &AuthScheme,
    ) -> Result<VerificationResult, String>;
}

pub struct OpenAiVerifier;
#[async_trait]
impl LlmProviderVerifier for OpenAiVerifier {
    async fn verify(
        &self,
        client: &Client,
        base_url: &str,
        auth: &AuthScheme,
    ) -> Result<VerificationResult, String> {
        let models_url = format!("{}/models", base_url.trim_end_matches('/'));
        let mut request = client.get(&models_url);

        if let AuthScheme::ApiKey(config) = auth {
             request = request.header("Authorization", format!("Bearer {}", config.api_key));
        }

        let response = request.send().await.map_err(|e| e.to_string())?;
        if response.status().is_success() {
            let body: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
            let mut models = Vec::new();
            if let Some(data) = body.get("data").and_then(|d| d.as_array()) {
                for m in data {
                    if let Some(id) = m.get("id").and_then(|i| i.as_str()) {
                        models.push(id.to_string());
                    }
                }
            }
            Ok(VerificationResult {
                success: true,
                message: "OpenAI connection verified".to_string(),
                available_models: models,
            })
        } else {
            Ok(VerificationResult {
                success: false,
                message: format!("HTTP {}: {}", response.status(), response.text().await.unwrap_or_default()),
                available_models: vec![],
            })
        }
    }
}

pub struct AnthropicVerifier;
#[async_trait]
impl LlmProviderVerifier for AnthropicVerifier {
    async fn verify(
        &self,
        client: &Client,
        _base_url: &str,
        auth: &AuthScheme,
    ) -> Result<VerificationResult, String> {
        // Anthropic models list: https://docs.anthropic.com/en/api/models-list
        let url = "https://api.anthropic.com/v1/models";
        let mut request = client.get(url)
            .header("anthropic-version", "2023-06-01");

        if let AuthScheme::ApiKey(config) = auth {
            request = request.header("x-api-key", config.api_key.clone());
        }

        let response = request.send().await.map_err(|e| e.to_string())?;
        if response.status().is_success() {
            let body: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
            let mut models = Vec::new();
            if let Some(data) = body.get("data").and_then(|d| d.as_array()) {
                for m in data {
                    if let Some(id) = m.get("id").and_then(|i| i.as_str()) {
                        models.push(id.to_string());
                    }
                }
            }
            Ok(VerificationResult {
                success: true,
                message: "Anthropic connection verified".to_string(),
                available_models: models,
            })
        } else {
            Ok(VerificationResult {
                success: false,
                message: format!("HTTP {}: {}", response.status(), response.text().await.unwrap_or_default()),
                available_models: vec![],
            })
        }
    }
}

#[command]
pub async fn verify_llm_connection(
    provider_id: String,
    base_url: Option<String>,
    auth: AuthScheme,
) -> Result<VerificationResult, String> {
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let verifier: Box<dyn LlmProviderVerifier> = match provider_id.as_str() {
        "anthropic" => Box::new(AnthropicVerifier),
        "openai" | "deepseek" | "groq" | "mistral" => Box::new(OpenAiVerifier),
        _ => Box::new(OpenAiVerifier), // Fallback to OpenAI-compatible
    };

    let resolved_url = match provider_id.as_str() {
        "openai" => base_url.unwrap_or_else(|| "https://api.openai.com/v1".to_string()),
        "anthropic" => "https://api.anthropic.com/v1".to_string(),
        "deepseek" => base_url.unwrap_or_else(|| "https://api.deepseek.com/v1".to_string()),
        _ => base_url.unwrap_or_default(),
    };

    verifier.verify(&client, &resolved_url, &auth).await
}
