import { useState } from "react";
import { 
  X, 
  Terminal, 
  Cloud, 
  ChevronRight,
  Monitor,
  Cpu
} from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import type { EngineConfig } from "../../types";
import { useTranslation } from "../../i18n";

interface ProviderCreateDialogProps {
  onClose: () => void;
  onUpsertEngine: (id: string, engine: EngineConfig) => Promise<void>;
}

export function ProviderCreateDialog({
  onClose,
  onUpsertEngine
}: ProviderCreateDialogProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<"type" | "details">("type");
  const [type, setType] = useState<"cli" | "api">("cli");
  const [name, setName] = useState("");
  const [command, setCommand] = useState("bash");
  const [model, setModel] = useState("claude-3-5-sonnet-latest");
  const [apiKey, setApiKey] = useState("");
  const [apiBaseUrl, setApiBaseUrl] = useState("https://api.anthropic.com");
  const [apiProvider, setApiProvider] = useState<"anthropic" | "openai-compatible">("anthropic");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    setError(null);
    setIsSaving(true);

    if (type === "cli") {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const exists = await invoke<boolean>("engine_check_command", { command });
        if (!exists) {
          setError(t("err_command_not_found", { command }));
          setIsSaving(false);
          return;
        }
      } catch (e) {
        console.error("Check command failed:", e);
      }
    } else {
      if (!apiKey.trim()) {
        setError(t("err_api_key_empty"));
        setIsSaving(false);
        return;
      }
    }

    const id = `provider-${Math.random().toString(36).slice(2, 6)}`;
    
    const engine: EngineConfig = {
      id,
      display_name: name || (type === "cli" ? "New CLI Provider" : "New Cloud Provider"),
      plugin_type: type === "cli" ? "native" : "api",
      icon: type === "cli" ? "terminal" : "cloud",
      profiles: {
        default: {
          id: "default",
          display_name: "Default Profile",
          command: type === "cli" ? command : "",
          args: [],
          env: type === "api" ? { [apiProvider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"]: apiKey } : {},
          supports_headless: false,
          headless_args: [],
          execution_mode: type,
          ...(type === "api" ? { api_provider: apiProvider, api_base_url: apiBaseUrl, api_key: apiKey, model } : {})
        }
      },
      active_profile_id: "default",
    };

    try {
      await onUpsertEngine(id, engine);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center p-4 bg-bg-base/60 backdrop-blur-xl animate-in fade-in duration-300">
      <div className="bg-bg-surface w-full max-w-[480px] rounded-md border border-border-muted/10 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-8 pt-8 pb-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-text-main">
              {step === "type" ? t("select_provider_type") : t("config_environment")}
            </h2>
            <p className="text-[11px] font-bold text-text-muted/50 uppercase tracking-widest mt-1">
              New Language Provider / {type.toUpperCase()} Mode
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-bg-elevated rounded-full transition-colors">
            <X size={18} className="text-text-muted" />
          </button>
        </div>

        {/* Content */}
        <div className="px-8 py-6">
          {step === "type" ? (
            <div className="grid gap-4">
              <button 
                onClick={() => { setType("cli"); setStep("details"); }}
                className="group flex items-start gap-4 p-5 rounded-sm border border-border-muted/10 bg-bg-elevated/40 hover:bg-bg-elevated hover:border-border-muted/30 transition-all text-left"
              >
                <div className="p-3 rounded-sm bg-bg-surface border border-border-muted/5 group-hover:bg-primary/5 group-hover:border-primary/20 group-hover:text-primary transition-all">
                  <Terminal size={22} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-text-main">Local CLI Tool</span>
                    <ChevronRight size={14} className="text-text-muted opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0 transition-all" />
                  </div>
                  <p className="text-[11px] text-text-muted/60 mt-1 leading-relaxed">
                    {t("cli_desc")}
                  </p>
                </div>
              </button>

              <button 
                onClick={() => { setType("api"); setStep("details"); }}
                className="group flex items-start gap-4 p-5 rounded-sm border border-border-muted/10 bg-bg-elevated/40 hover:bg-bg-elevated hover:border-border-muted/30 transition-all text-left"
              >
                <div className="p-3 rounded-sm bg-bg-surface border border-border-muted/5 group-hover:bg-sky-500/5 group-hover:border-sky-500/20 group-hover:text-sky-500 transition-all">
                  <Cloud size={22} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-black text-text-main">Cloud Model API</span>
                    <ChevronRight size={14} className="text-text-muted opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0 transition-all" />
                  </div>
                  <p className="text-[11px] text-text-muted/60 mt-1 leading-relaxed">
                    {t("api_desc")}
                  </p>
                </div>
              </button>
            </div>
          ) : (
            <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase text-text-muted/40 tracking-widest pl-1 flex items-center gap-2">
                    <Cpu size={10} /> {t("provider_label")}
                  </label>
                  <Input 
                    autoFocus
                    placeholder={type === "cli" ? "e.g. Claude CLI" : "e.g. Anthropic API"}
                    value={name}
                    onChange={e => setName(e.target.value)}
                    className="h-11 rounded-sm bg-bg-elevated/60 text-sm border-border-muted/10 focus:ring-primary/20 focus:border-primary/30"
                  />
                </div>

                {type === "cli" ? (
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase text-text-muted/40 tracking-widest pl-1 flex items-center gap-2">
                      <Monitor size={10} /> {t("base_command")}
                    </label>
                    <Input 
                      placeholder="e.g. claude"
                      value={command}
                      onChange={e => setCommand(e.target.value)}
                      className="h-11 rounded-sm bg-bg-elevated/60 text-xs font-mono border-border-muted/10"
                    />
                  </div>
                ) : (
                  <div className="space-y-4 pt-2">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-text-muted/40 tracking-widest pl-1 flex items-center gap-2">
                          <Cloud size={10} /> {t("provider_select_label")}
                        </label>
                        <select 
                          value={apiProvider}
                          onChange={e => {
                            const p = e.target.value as "anthropic" | "openai-compatible";
                            setApiProvider(p);
                            setApiBaseUrl(p === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com/v1");
                          }}
                          className="w-full h-11 rounded-sm bg-bg-elevated/60 text-xs font-mono border border-border-muted/10 px-3 outline-none focus:border-primary/30 transition-colors cursor-pointer appearance-none"
                        >
                          <option value="anthropic">Anthropic</option>
                          <option value="openai-compatible">OpenAI Compatible</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase text-text-muted/40 tracking-widest pl-1 flex items-center gap-2">
                          <Cpu size={10} /> {t("model_label")}
                        </label>
                        <Input 
                          placeholder="claude-3-5-sonnet..."
                          value={model}
                          onChange={e => setModel(e.target.value)}
                          className="h-11 rounded-sm bg-bg-elevated/60 text-xs font-mono border-border-muted/10"
                        />
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase text-text-muted/40 tracking-widest pl-1 flex items-center gap-2">
                        <X size={10} /> API Key
                      </label>
                      <Input 
                        type="password"
                        placeholder="sk-..."
                        value={apiKey}
                        onChange={e => setApiKey(e.target.value)}
                        className="h-11 rounded-sm bg-bg-elevated/60 text-xs font-mono border-border-muted/10"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase text-text-muted/40 tracking-widest pl-1 flex items-center gap-2">
                        <Cloud size={10} /> Base URL
                      </label>
                      <Input 
                        placeholder="https://..."
                        value={apiBaseUrl}
                        onChange={e => setApiBaseUrl(e.target.value)}
                        className="h-11 rounded-sm bg-bg-elevated/60 text-xs font-mono border-border-muted/10"
                      />
                    </div>
                  </div>
                )}
                
                {error && (
                  <div className="p-3 rounded-sm bg-red-500/5 border border-red-500/20 text-red-500 text-[10px] font-bold uppercase tracking-widest transition-all animate-in fade-in slide-in-from-top-1">
                    Error: {error}
                  </div>
                )}
              </div>

              <div className="p-4 rounded-sm bg-primary/5 border border-primary/10 flex items-start gap-3">
                <div className="text-primary mt-0.5"><Cpu size={14} /></div>
                <p className="text-[10px] leading-relaxed text-primary/80 font-medium italic">
                  {t("provider_create_hint")}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-8 pb-8 pt-2 flex items-center gap-3">
          {step === "details" && (
            <Button 
              variant="ghost" 
              className="px-6 rounded-sm text-text-muted/60 text-[11px] font-bold uppercase transition-all"
              onClick={() => { setStep("type"); setError(null); }}
            >
              {t("prev_step")}
            </Button>
          )}
          
          <div className="flex-1" />

          {step === "details" ? (
            <Button 
              className="px-8 h-10 rounded-sm bg-primary text-white font-black text-[11px] shadow-glow uppercase transition-all tracking-widest"
              onClick={handleCreate}
              loading={isSaving}
            >
              {t("finalize")}
            </Button>
          ) : (
            <Button 
              variant="ghost"
              className="px-6 rounded-sm text-text-muted/40 text-[11px] font-bold uppercase"
              onClick={onClose}
            >
              {t("cancel")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
