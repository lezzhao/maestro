export type AuthScheme = 
  | { type: "api_key"; config: { api_key: string; key_prefix?: string; is_secret: boolean } }
  | { type: "aws_bedrock"; config: { region: string; profile?: string; access_key_id?: string } }
  | { type: "azure_foundry"; config: { endpoint: string; deployment: string; key?: string } }
  | { type: "none"; config?: null };

export type ProviderMetadata = {
  provider_id: string;
  logo_key?: string;
  help_url?: string;
  category?: string;
};

/** Required fields for all engine profiles. */
export type EngineProfileBase = {
  id: string;
  display_name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  supports_headless: boolean;
  headless_args: string[];
};

/** Optional fields: CLI-specific (ready_signal) or API-specific (model, api_*). */
export type EngineProfileOptional = {
  model?: string | null;
  ready_signal?: string | null;
  execution_mode?: "cli" | "api";
  api_provider?: string | null;
  api_base_url?: string | null;
  api_key?: string | null;
  auth?: AuthScheme | null;
  metadata?: ProviderMetadata | null;
};

export type EngineProfile = EngineProfileBase & Partial<EngineProfileOptional>;

/** Engine-level config. Profile-level fields (command, args, env, etc.) live in profiles[profileId]. */
export type EngineConfig = {
  id: string;
  plugin_type: string;
  display_name: string;
  profiles?: Record<string, EngineProfile>;
  active_profile_id?: string;
  exit_command?: string;
  exit_timeout_ms?: number;
  icon: string;
  category?: string; // 'cloud', 'local', 'proxy'
};

export type EnginePreflightResult = {
  engine_id: string;
  profile_id?: string;
  command_exists: boolean;
  auth_ok: boolean;
  supports_headless: boolean;
  notes: string;
  cached?: boolean;
  checked_at_ms?: number;
};

export type EngineModelListResult = {
  engine_id: string;
  profile_id: string;
  models: string[];
  source: "cli" | "builtin";
  notes: string;
};

export type EngineModelListState = EngineModelListResult & {
  cached: boolean;
  fetched_at_ms: number;
};

export type EngineRecommendation = {
  engine_id: string;
  reason: string;
};
