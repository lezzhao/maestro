use futures::StreamExt;
use reqwest::Response;
use tokio_util::sync::CancellationToken;
use crate::api_provider::ApiProviderError;

/// Process a raw SSE byte stream from a reqwest Response.
/// Calls `line_callback` for each full line found in the stream.
pub async fn process_sse_stream<F>(
    response: Response,
    cancel_token: CancellationToken,
    mut line_callback: F,
) -> Result<(), ApiProviderError>
where
    F: FnMut(&str) -> Result<bool, ApiProviderError>,
{
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    loop {
        tokio::select! {
            _ = cancel_token.cancelled() => {
                return Err(ApiProviderError::Execution("请求已取消".into()));
            }
            next = stream.next() => {
                match next {
                    Some(Ok(bytes)) => {
                        let chunk = String::from_utf8_lossy(&bytes);
                        buffer.push_str(&chunk);
                        while let Some(pos) = buffer.find('\n') {
                            let line = buffer[..pos].to_string();
                            buffer.drain(..=pos);
                            if line_callback(&line)? {
                                return Ok(());
                            }
                        }
                    }
                    Some(Err(e)) => return Err(ApiProviderError::Execution(format!("读取流失败: {e}"))),
                    None => {
                        // Process remaining buffer
                        if !buffer.is_empty() {
                             line_callback(&buffer)?;
                        }
                        return Ok(());
                    }
                }
            }
        }
    }
}
