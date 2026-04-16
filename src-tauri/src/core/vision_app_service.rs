use crate::core::MaestroCore;
use screenshots::Screen;
use std::io::Cursor;
// use image::ImageFormat; // Removed to avoid version conflict

impl MaestroCore {
    pub fn vision_capture_screen(&self) -> Result<String, String> {
        let screens = Screen::all().map_err(|e| format!("无法获取屏幕列表: {e}"))?;
        let primary = screens.get(0).ok_or_else(|| "未找到主显示器".to_string())?;
        
        // Capture full screen
        let image = primary.capture().map_err(|e| format!("屏幕捕获失败: {e}"))?;
        
        // Convert to PNG in memory
        let mut buffer = Vec::new();
        let mut cursor = Cursor::new(&mut buffer);
        image.write_to(&mut cursor, screenshots::image::ImageFormat::Png)
            .map_err(|e| format!("图片编码失败: {e}"))?;
            
        use base64::{Engine as _, engine::general_purpose};
        Ok(general_purpose::STANDARD.encode(buffer))
    }
}
