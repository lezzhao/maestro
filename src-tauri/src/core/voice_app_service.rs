use crate::core::MaestroCore;

impl MaestroCore {
    pub async fn voice_transcribe(
        &self,
        engine_id: String,
        audio_base64: String,
    ) -> Result<String, String> {
        let config = self.config.get();
        let engine = config.engines.get(&engine_id)
            .ok_or_else(|| format!("引擎 {} 未找到", engine_id))?;
            
        let active_profile = engine.active_profile();
        let api_key = active_profile.api_key()
            .ok_or_else(|| format!("引擎 {} 的 API Key 未配置", engine_id))?;
            
        use base64::{Engine as _, engine::general_purpose};
        let audio_data = general_purpose::STANDARD.decode(audio_base64).map_err(|e| format!("音频数据解码失败: {e}"))?;
        
        let provider_id = &engine.id;
        let registry = crate::api_provider::ApiProviderRegistry::new();
        let provider = registry.get(provider_id)
            .ok_or_else(|| format!("提供商 {} 不支持语音功能", provider_id))?;
            
        provider.transcribe(
            &reqwest::Client::new(), 
            active_profile.api_base_url().as_deref().unwrap_or("https://api.openai.com/v1"), 
            &api_key, 
            "whisper-1", 
            audio_data, 
            "speech.webm"
        ).await.map_err(|e| e.to_string())
    }

    pub async fn voice_speech(
        &self,
        engine_id: String,
        text: String,
        voice: String,
    ) -> Result<String, String> {
        let config = self.config.get();
        let engine = config.engines.get(&engine_id)
            .ok_or_else(|| format!("引擎 {} 未找到", engine_id))?;
            
        let active_profile = engine.active_profile();
        let api_key = active_profile.api_key()
            .ok_or_else(|| format!("引擎 {} 的 API Key 未配置", engine_id))?;
            
        let provider_id = &engine.id;
        let registry = crate::api_provider::ApiProviderRegistry::new();
        let provider = registry.get(provider_id)
            .ok_or_else(|| format!("提供商 {} 不支持语音功能", provider_id))?;
            
        let bytes = provider.speech(
            &reqwest::Client::new(), 
            active_profile.api_base_url().as_deref().unwrap_or("https://api.openai.com/v1"), 
            &api_key, 
            "tts-1", 
            &text, 
            &voice
        ).await.map_err(|e| e.to_string())?;
        
        use base64::{Engine as _, engine::general_purpose};
        Ok(general_purpose::STANDARD.encode(bytes))
    }
}
