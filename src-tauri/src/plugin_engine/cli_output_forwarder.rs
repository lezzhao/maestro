use crate::core::events::StringStream;
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};

const MAX_AGGREGATE_CHARS: usize = 1_500_000;

fn append_aggregate(aggregate: &Arc<Mutex<String>>, chunk: &str) {
    let mut text = aggregate.lock().unwrap_or_else(|e| e.into_inner());
    text.push_str(chunk);
    if text.len() > MAX_AGGREGATE_CHARS {
        let drop_prefix = text.len() - MAX_AGGREGATE_CHARS;
        text.drain(..drop_prefix);
    }
}

fn extract_assistant_text(value: &serde_json::Value) -> Option<String> {
    if let Some(arr) = value
        .pointer("/message/content")
        .and_then(|content| content.as_array())
    {
        if let Some(first) = arr.first() {
            return first
                .pointer("/text")
                .and_then(|text| text.as_str())
                .map(|text| text.to_string());
        }
    }
    value
        .pointer("/message/content")
        .and_then(|content| content.as_str())
        .map(|content| content.to_string())
}

fn parse_json_stream_chunk(
    chunk: &str,
    on_data: &Arc<dyn StringStream>,
    aggregate: &Arc<Mutex<String>>,
    in_thinking: &mut bool,
) {
    let trimmed = chunk.trim();
    if trimmed.is_empty() {
        return;
    }
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
        let payload_type = value
            .pointer("/type")
            .and_then(|t| t.as_str())
            .unwrap_or("");
        let text_to_emit = if payload_type == "thinking" {
            let subtype = value
                .pointer("/subtype")
                .and_then(|s| s.as_str())
                .unwrap_or("");
            if subtype == "completed" {
                if *in_thinking {
                    *in_thinking = false;
                    Some("\n</think>\n\n".to_string())
                } else {
                    None
                }
            } else {
                let text = value
                    .pointer("/text")
                    .and_then(|text| text.as_str())
                    .unwrap_or("");
                if !*in_thinking {
                    *in_thinking = true;
                    Some(format!("<think>\n{text}"))
                } else {
                    Some(text.to_string())
                }
            }
        } else if payload_type == "assistant" {
            if *in_thinking {
                *in_thinking = false;
                let _ = on_data.send_string("\n</think>\n\n".to_string());
            }
            extract_assistant_text(&value)
        } else if payload_type == "result" {
            if let Some(usage) = value.pointer("/usage") {
                if let (Some(input), Some(output)) = (
                    usage.pointer("/inputTokens").and_then(|t| t.as_u64()),
                    usage.pointer("/outputTokens").and_then(|t| t.as_u64()),
                ) {
                    let _ = on_data.send_string(format!(
                        "\x00TOKEN_USAGE:{{\"approx_input_tokens\":{},\"approx_output_tokens\":{}}}",
                        input, output
                    ));
                }
            }
            None
        } else {
            None
        };

        if let Some(text) = text_to_emit {
            append_aggregate(aggregate, &text);
            let _ = on_data.send_string(text);
        }
        return;
    }

    append_aggregate(aggregate, chunk);
    let _ = on_data.send_string(chunk.to_string());
}

pub async fn forward_output<R>(
    reader: R,
    on_data: Arc<dyn StringStream>,
    aggregate: Arc<Mutex<String>>,
) where
    R: AsyncRead + Unpin,
{
    let mut stream = BufReader::new(reader);
    let mut line_buf = String::new();
    let mut is_json_stream = false;
    let mut json_detected = false;
    let mut in_thinking = false;

    loop {
        line_buf.clear();
        match stream.read_line(&mut line_buf).await {
            Ok(0) => break,
            Ok(_) => {
                let chunk = line_buf.clone();
                if !json_detected {
                    let trimmed = chunk.trim();
                    if trimmed.starts_with("{\"type\":") {
                        is_json_stream = true;
                    }
                    json_detected = true;
                }

                if is_json_stream {
                    parse_json_stream_chunk(&chunk, &on_data, &aggregate, &mut in_thinking);
                } else {
                    append_aggregate(&aggregate, &chunk);
                    if on_data.send_string(chunk).is_err() {
                        break;
                    }
                }
            }
            Err(_) => break,
        }
    }

    if is_json_stream && in_thinking {
        let _ = on_data.send_string("\n</think>\n".to_string());
    }
}
