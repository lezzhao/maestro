/// Pricing model for LLM token usage.
pub struct ModelPricing {
    pub input_usd_1m: f64,
    pub output_usd_1m: f64,
}

pub fn get_pricing(model: &str) -> ModelPricing {
    if model.contains("claude-3-5-sonnet") || model.contains("claude-3-7-sonnet") {
        ModelPricing {
            input_usd_1m: 3.0,
            output_usd_1m: 15.0,
        }
    } else if model.contains("claude-3-opus") {
        ModelPricing {
            input_usd_1m: 15.0,
            output_usd_1m: 75.0,
        }
    } else if model.contains("gpt-4o-mini") {
        ModelPricing {
            input_usd_1m: 0.15,
            output_usd_1m: 0.60,
        }
    } else if model.contains("gpt-4o") {
        ModelPricing {
            input_usd_1m: 5.0,
            output_usd_1m: 15.0,
        }
    } else {
        // Default conservative pricing for unknown models
        ModelPricing {
            input_usd_1m: 1.0,
            output_usd_1m: 5.0,
        }
    }
}

pub fn calculate_cost(input_tokens: u64, output_tokens: u64, pricing: &ModelPricing) -> f64 {
    (input_tokens as f64 * pricing.input_usd_1m + output_tokens as f64 * pricing.output_usd_1m) / 1_000_000.0
}
