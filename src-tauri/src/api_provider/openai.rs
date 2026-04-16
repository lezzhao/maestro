use crate::core::events::StringStream;
use crate::tools::ToolDefinition;
use crate::api_provider::{ApiProvider, ApiProviderError, ApiProviderMessage, normalize_base_url, normalize_messages};
use reqwest::Client;
use serde_json::json;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use tokio_util::sync::CancellationToken;
use super::sse;

pub struct OpenAiProvider;

impl ApiProvider for OpenAiProvider {
    fn id(&self) -> &str {
        "openai"
    }

    fn stream_chat<'a>(
        &'a self,
        client: &'a Client,
        base_url: &'a str,
        api_key: &'a str,
        model: &'a str,
        messages: &'a [ApiProviderMessage],
        tools: Option<&'a [ToolDefinition]>,
        system_prompt: Option<String>,
        cancel_token: CancellationToken,
        on_data: &'a Arc<dyn StringStream>,
    ) -> Pin<Box<dyn Future<Output = Result<(), ApiProviderError>> + Send + 'a>> {
        Box::pin(async move {
            stream_openai_compatible(
                client,
                base_url,
                api_key,
                model,
                messages,
                tools,
                system_prompt,
                cancel_token,
                on_data,
            ).await
        })
    }

    fn transcribe<'a>(
        &'a self,
        client: &'a Client,
        base_url: &'a str,
        api_key: &'a str,
        model: &'a str,
        audio_data: Vec<u8>,
        filename: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<String, ApiProviderError>> + Send + 'a>> {
        Box::pin(async move {
            let endpoint = format!("{}/audio/transcriptions", normalize_base_url(base_url));
            let form = reqwest::multipart::Form::new()
                .text("model", model.to_string())
                .part("file", reqwest::multipart::Part::bytes(audio_data).file_name(filename.to_string()));

            let response = client
                .post(endpoint)
                .header("Authorization", format!("Bearer {api_key}"))
                .multipart(form)
                .send()
                .await
                .map_err(|e| ApiProviderError::Execution(format!("音轨传输失败: {e}")))?;

            let status = response.status();
            if !status.is_success() {
                let text = response.text().await.unwrap_or_default();
                return Err(ApiProviderError::Execution(format!("STT 错误 {}: {}", status.as_u16(), text)));
            }

            let result: serde_json::Value = response.json().await.map_err(|e| ApiProviderError::Execution(format!("解析响应失败: {e}")))?;
            Ok(result["text"].as_str().unwrap_or_default().to_string())
        })
    }

    fn speech<'a>(
        &'a self,
        client: &'a Client,
        base_url: &'a str,
        api_key: &'a str,
        model: &'a str,
        input: &'a str,
        voice: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<u8>, ApiProviderError>> + Send + 'a>> {
        Box::pin(async move {
            let endpoint = format!("{}/audio/speech", normalize_base_url(base_url));
            let body = json!({
                "model": model,
                "input": input,
                "voice": voice,
            });

            let response = client
                .post(endpoint)
                .header("Authorization", format!("Bearer {api_key}"))
                .json(&body)
                .send()
                .await
                .map_err(|e| ApiProviderError::Execution(format!("语音合成请求失败: {e}")))?;

            let status = response.status();
            if !status.is_success() {
                let text = response.text().await.unwrap_or_default();
                return Err(ApiProviderError::Execution(format!("TTS 错误 {}: {}", status.as_u16(), text)));
            }

            let bytes = response.bytes().await.map_err(|e| ApiProviderError::Execution(format!("读取语音流失败: {e}")))?;
            Ok(bytes.to_vec())
        })
    }
}

pub async fn stream_openai_compatible(
    client: &Client,
    base_url: &str,
    api_key: &str,
    model: &str,
    messages: &[ApiProviderMessage],
    tools: Option<&[ToolDefinition]>,
    system_prompt: Option<String>,
    cancel_token: CancellationToken,
    on_data: &Arc<dyn StringStream>,
) -> Result<(), ApiProviderError> {
    let endpoint = format!("{}/chat/completions", normalize_base_url(base_url));
    let mut body = json!({
        "model": model,
        "messages": normalize_messages(messages, system_prompt),
        "stream": true,
        "stream_options": { "include_usage": true }
    });

    if let Some(tool_defs) = tools {
        if !tool_defs.is_empty() {
            body["tools"] = json!(tool_defs.iter().map(|t| json!({
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.parameters
                }
            })).collect::<Vec<_>>());
        }
    }
    let response = client
        .post(endpoint)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| ApiProviderError::Execution(format!("请求失败: {e}")))?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(ApiProviderError::Execution(format!(
            "HTTP {}: {}",
            status.as_u16(),
            text
        )));
    }

    let mut is_reasoning = false;
    crate::api_provider::sse_util::process_sse_stream(response, cancel_token, |line| {
        let mut line_buf = line.to_string() + "\n";
        while let Some((content, reasoning, tool_calls, usage, done)) = sse::parse_openai_line(&mut line_buf) {
            if done {
                if is_reasoning {
                    let _ = on_data.send_string("\n</think>\n".to_string());
                }
                return Ok(true);
            }
            if let Some(u) = usage {
                let _ = on_data.send_string(format!("\u{0}TOKEN_USAGE:{}", serde_json::to_string(&u).unwrap_or_default()));
            }
            if let Some(r_text) = reasoning {
                if !is_reasoning {
                    is_reasoning = true;
                    on_data.send_string(format!("<think>\n{r_text}"))?;
                } else {
                    on_data.send_string(r_text)?;
                }
            }
            if let Some(c_text) = content {
                if is_reasoning {
                    is_reasoning = false;
                    on_data.send_string(format!("\n</think>\n{c_text}"))?;
                } else {
                    on_data.send_string(c_text)?;
                }
            }
            if let Some(tcs) = tool_calls {
                for tc in tcs {
                   on_data.send_string(format!("\u{0}TOOL_CALL:{}", serde_json::to_string(&tc).unwrap_or_default()))?;
                }
            }
        }
        Ok(false)
    }).await?;

    if is_reasoning {
        let _ = on_data.send_string("\n</think>\n".to_string());
    }
    Ok(())
}
