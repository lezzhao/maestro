export type ProviderCategory = "cloud" | "local" | "proxy";

export interface ProviderMetadata {
  id: string;
  name: string;
  category: ProviderCategory;
  label: string;
  logo: string;
  description: string;
  defaultBaseUrl?: string;
  isPopular?: boolean;
}

export const PROVIDER_REGISTRY: ProviderMetadata[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    category: "cloud",
    label: "Claude 3.5 Sonnet",
    logo: "https://upload.wikimedia.org/wikipedia/commons/2/2a/Anthropic_logo.svg",
    description: "Superior reasoning and coding capabilities.",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    isPopular: true,
  },
  {
    id: "openai",
    name: "OpenAI",
    category: "cloud",
    label: "GPT-4o / o1",
    logo: "https://upload.wikimedia.org/wikipedia/commons/0/04/ChatGPT_logo.svg",
    description: "Industry standard for general intelligence.",
    defaultBaseUrl: "https://api.openai.com/v1",
    isPopular: true,
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    category: "cloud",
    label: "DeepSeek-V3 / R1",
    logo: "https://www.deepseek.com/favicon.svg",
    description: "High performance meeting exceptional value.",
    defaultBaseUrl: "https://api.deepseek.com/v1",
    isPopular: true,
  },
  {
    id: "google",
    name: "Google Gemini",
    category: "cloud",
    label: "Gemini 1.5 Pro / Flash",
    logo: "https://upload.wikimedia.org/wikipedia/commons/8/8a/Google_Gemini_logo.svg",
    description: "Massive context window (up to 2M tokens).",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
  },
  {
    id: "ollama",
    name: "Ollama",
    category: "local",
    label: "Local Llama / Mistral",
    logo: "https://ollama.com/public/ollama.png",
    description: "Run models privately on your machine.",
    defaultBaseUrl: "http://localhost:11434/v1",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    category: "proxy",
    label: "Universal API",
    logo: "https://openrouter.ai/favicon.ico",
    description: "Single API for 100+ open-source models.",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
  },
  {
    id: "custom",
    name: "Custom Endpoint",
    category: "proxy",
    label: "OpenAI Compatible",
    logo: "",
    description: "Connect to any OpenAI-compatible API.",
  },
];

export const getProviderById = (id: string) => PROVIDER_REGISTRY.find(p => p.id === id);
