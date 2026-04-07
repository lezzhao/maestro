import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  X, 
  Check, 
  AlertCircle, 
  Loader2, 
  ExternalLink,
  ShieldCheck,
  Zap,
  Info
} from "lucide-react";
import { Button } from "../ui/button";
import { useAsyncCallback } from "../../hooks/use-async-callback";
import { Z_INDEX } from "../../constants";
import { type ProviderMetadata as ProviderMarketItem } from "../../config/provider-registry";
import type { AuthScheme, EngineConfig } from "../../types";

interface ProviderConfigDrawerProps {
  provider: ProviderMarketItem | null;
  onClose: () => void;
  onSave: (config: EngineConfig) => Promise<void>;
  onVerify: (providerId: string, auth: AuthScheme, baseUrl?: string) => Promise<{ success: boolean; message: string; available_models: string[] }>;
}

export function ProviderConfigDrawer({ provider, onClose, onSave, onVerify }: ProviderConfigDrawerProps) {
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [verifyStatus, setVerifyStatus] = useState<"idle" | "success" | "error">("idle");
  const [verifyMessage, setVerifyMessage] = useState("");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState("");

  const { execute: handleVerify, isLoading: isVerifying } = useAsyncCallback(
    async () => {
      if (!provider) return;
      setVerifyStatus("idle");
      const auth: AuthScheme = {
        type: "api_key",
        config: { api_key: apiKey, is_secret: true }
      };
      const res = await onVerify(provider.id, auth, baseUrl || undefined);
      if (res.success) {
        setVerifyStatus("success");
        setAvailableModels(res.available_models);
        if (res.available_models.length > 0) {
          setSelectedModel(res.available_models[0]);
        }
      } else {
        setVerifyStatus("error");
        setVerifyMessage(res.message);
      }
    },
    { errorMessagePrefix: "verify_failed" }
  );

  const { execute: handleSave, isLoading: isSaving, error: saveError, setError: setSaveError } = useAsyncCallback(
    async () => {
      if (!provider) return;
      const config: EngineConfig = {
          id: provider.id,
          plugin_type: "api",
          display_name: provider.name,
          icon: provider.logo,
          category: provider.category,
          active_profile_id: "default",
          profiles: {
              default: {
                  id: "default",
                  display_name: "Default Profile",
                  command: provider.id,
                  args: [],
                  env: {},
                  supports_headless: true,
                  headless_args: [],
                  api_provider: provider.id,
                  api_base_url: baseUrl || null,
                  api_key: apiKey || null,
                  model: selectedModel || null,
                  auth: {
                      type: "api_key",
                      config: { 
                        api_key: apiKey,
                        key_prefix: undefined, 
                        is_secret: true 
                      }
                  }
              }
          },
      };
      await onSave(config);
      onClose();
    },
    { errorMessagePrefix: "save_config_failed" }
  );

  useEffect(() => {
    if (provider) {
       // Reset state when provider changes
       setApiKey("");
       setBaseUrl(provider.defaultBaseUrl || "");
       setVerifyStatus("idle");
       setAvailableModels([]);
       setSaveError(null);
    }
  }, [provider, setSaveError]);

  if (!provider) return null;

  return (
    <AnimatePresence>
      <div 
        className="fixed inset-0 flex justify-end overflow-hidden"
        style={{ zIndex: Z_INDEX.DRAWER }}
      >
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        />

        <motion.div
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          transition={{ type: "spring", damping: 25, stiffness: 200 }}
          className="relative w-full max-w-lg bg-bg-surface shadow-2xl border-l border-border-muted/10 h-full flex flex-col"
        >
          {/* Header */}
          <div className="p-6 border-b border-border-muted/10 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-bg-base border border-border-muted/10 flex items-center justify-center p-2">
                 <img src={provider.logo} alt={provider.name} className="w-full h-full object-contain" />
              </div>
              <div>
                <h3 className="text-lg font-black text-text-main uppercase tracking-tight">Configure {provider.name}</h3>
                <p className="text-[10px] font-bold text-text-muted/60 uppercase tracking-[0.2em]">{provider.category} Provider</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 rounded-full hover:bg-bg-elevated text-text-muted transition-colors">
              <X size={20} />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
             
             {/* Info Section */}
             <div className="bg-primary/5 border border-primary/10 rounded-2xl p-5 flex gap-4">
                <div className="shrink-0 w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                   <ShieldCheck size={18} />
                </div>
                <div className="space-y-1">
                   <h5 className="text-[12px] font-black text-primary uppercase tracking-wide">Security Guarantee</h5>
                   <p className="text-[11px] text-primary/70 leading-relaxed font-medium">
                     Your API keys are stored securely on your local device. They are only used to communicate directly with {provider.name}.
                   </p>
                </div>
             </div>

             {/* Form Fields */}
             <div className="space-y-6">
                <div className="space-y-2">
                   <label className="text-[10px] font-black text-text-muted uppercase tracking-widest pl-1">API Key</label>
                   <div className="relative group">
                      <input 
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder="sk-..."
                        className="w-full h-12 bg-bg-base border border-border-muted/10 rounded-xl px-4 text-sm font-mono focus:border-primary/40 focus:ring-4 focus:ring-primary/5 transition-all outline-none"
                      />
                      <Zap size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-text-muted/20 group-hover:text-primary/40 transition-colors" />
                   </div>
                   <p className="text-[10px] text-text-muted/40 pl-1 flex items-center gap-1.5">
                      <Info size={10} />
                      Required for authentication. Get it from <a href="#" className="underline hover:text-primary transition-colors inline-flex items-center gap-0.5">Admin Console <ExternalLink size={8} /></a>
                   </p>
                </div>

                <div className="space-y-2">
                   <label className="text-[10px] font-black text-text-muted uppercase tracking-widest pl-1">Base URL (Optional)</label>
                   <input 
                     type="text"
                     value={baseUrl}
                     onChange={(e) => setBaseUrl(e.target.value)}
                     placeholder="https://api.openai.com/v1"
                     className="w-full h-12 bg-bg-base border border-border-muted/10 rounded-xl px-4 text-sm font-mono focus:border-primary/40 outline-none transition-all"
                   />
                </div>
             </div>

             {/* Connection Status */}
             <div className="pt-4 space-y-4">
                <Button 
                    variant="outline" 
                    className="w-full h-12 rounded-xl border-dashed border-border-muted/30 hover:border-primary hover:bg-primary/5 font-black uppercase tracking-widest text-[11px] gap-2 transition-all"
                    onClick={handleVerify}
                    disabled={isVerifying || !apiKey}
                >
                    {isVerifying ? (
                       <>
                         <Loader2 size={16} className="animate-spin" />
                         Verifying Link...
                       </>
                    ) : (
                       <>Verify Connection</>
                    )}
                </Button>

                 <AnimatePresence mode="wait">
                  {saveError && (
                    <motion.div 
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="bg-rose-500/10 border border-rose-500/20 rounded-2xl p-4 flex gap-3 text-rose-500"
                    >
                        <AlertCircle size={18} className="shrink-0 mt-0.5" />
                        <div className="space-y-1 text-[11px]">
                           <h6 className="font-black uppercase tracking-wide">Save Failed</h6>
                           <p className="font-medium opacity-80 leading-relaxed font-mono break-all line-clamp-3">{saveError}</p>
                        </div>
                    </motion.div>
                  )}

                  {verifyStatus === "success" && (
                    <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-emerald-500/5 border border-emerald-500/20 rounded-2xl p-5 space-y-4"
                    >
                        <div className="flex items-center gap-3 text-emerald-500">
                           <Check size={18} className="shrink-0" />
                           <span className="text-[12px] font-black uppercase tracking-wide">Connection Active</span>
                        </div>
                        
                        <div className="space-y-2">
                           <label className="text-[10px] font-black text-emerald-500/60 uppercase tracking-widest pl-1">Select Model</label>
                           <select 
                             value={selectedModel}
                             onChange={(e) => setSelectedModel(e.target.value)}
                             className="w-full h-10 bg-white dark:bg-black rounded-lg border border-emerald-500/10 px-3 text-[12px] font-mono focus:outline-none"
                           >
                             {availableModels.map(m => (
                               <option key={m} value={m}>{m}</option>
                             ))}
                           </select>
                        </div>
                    </motion.div>
                  )}

                  {verifyStatus === "error" && (
                    <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-rose-500/5 border border-rose-500/20 rounded-2xl p-4 flex gap-3 text-rose-500"
                    >
                        <AlertCircle size={18} className="shrink-0 mt-0.5" />
                        <div className="space-y-1">
                           <h6 className="text-[12px] font-black uppercase tracking-wide">Connection Failed</h6>
                           <p className="text-[11px] font-medium opacity-80 leading-relaxed font-mono break-all">{verifyMessage}</p>
                        </div>
                    </motion.div>
                  )}
                </AnimatePresence>
             </div>
          </div>

          {/* Footer */}
          <div className="p-8 border-t border-border-muted/10 bg-bg-surface mt-auto">
             <div className="flex gap-4">
                <Button 
                    variant="ghost" 
                    className="flex-1 h-12 rounded-xl font-black uppercase tracking-widest text-[11px]"
                    onClick={onClose}
                >
                    Cancel
                </Button>
                <Button 
                    className="flex-2 h-12 rounded-xl bg-primary hover:bg-primary/90 text-white font-black uppercase tracking-widest text-[11px] shadow-lg shadow-primary/20 disabled:opacity-50"
                    disabled={verifyStatus !== "success" || isSaving}
                    onClick={handleSave}
                >
                    {isSaving ? (
                      <>
                        <Loader2 size={16} className="animate-spin mr-2" />
                        Saving...
                      </>
                    ) : (
                      <>Apply & Save</>
                    )}
                </Button>
             </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
