import { memo } from "react";
import { 
  Sparkles, 
  Cloud, 
  Server, 
  Globe, 
  Plus,
  ArrowRight
} from "lucide-react";
import { cn } from "../../lib/utils";

import { PROVIDER_REGISTRY, type ProviderMetadata as ProviderMarketItem } from "../../config/provider-registry";

interface ProviderMarketplaceProps {
  onSelectProvider: (provider: ProviderMarketItem) => void;
}

export const ProviderMarketplace = memo(function ProviderMarketplace({ onSelectProvider }: ProviderMarketplaceProps) {
  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {PROVIDER_REGISTRY.map((provider) => (
          <button
            key={provider.id}
            onClick={() => onSelectProvider(provider)}
            className={cn(
              "group relative flex flex-col p-5 rounded-2xl border text-left transition-all duration-300",
              "bg-bg-surface border-border-muted/10 hover:border-primary/40 hover:shadow-xl hover:shadow-primary/5 hover:-translate-y-1 active:scale-[0.98]"
            )}
          >
            {provider.isPopular && (
              <div className="absolute top-3 right-3 flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[9px] font-black uppercase tracking-wider">
                <Sparkles size={10} />
                <span>Popular</span>
              </div>
            )}

            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 rounded-xl bg-bg-base border border-border-muted/10 flex items-center justify-center overflow-hidden p-2 group-hover:scale-110 transition-transform">
                {provider.logo ? (
                  <img src={provider.logo} alt={provider.name} className="w-full h-full object-contain" />
                ) : (
                  <div className="text-2xl font-black text-text-muted/20">?</div>
                )}
              </div>
              <div>
                <h4 className="text-sm font-black text-text-main group-hover:text-primary transition-colors">{provider.name}</h4>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {provider.category === "cloud" && <Cloud size={10} className="text-sky-500" />}
                  {provider.category === "local" && <Server size={10} className="text-emerald-500" />}
                  {provider.category === "proxy" && <Globe size={10} className="text-amber-500" />}
                  <span className="text-[10px] font-bold text-text-muted/60 uppercase tracking-tight">{provider.label}</span>
                </div>
              </div>
            </div>

            <p className="text-[11px] text-text-muted/70 leading-relaxed mb-6 line-clamp-2">
              {provider.description}
            </p>

            <div className="mt-auto flex items-center justify-between">
              <div className="text-[10px] font-black uppercase tracking-widest text-text-muted/30 group-hover:text-primary/60 transition-colors">
                Configure Now
              </div>
              <div className="w-6 h-6 rounded-full bg-bg-base border border-border-muted/10 flex items-center justify-center text-text-muted group-hover:bg-primary group-hover:text-white group-hover:border-primary transition-all">
                <ArrowRight size={12} />
              </div>
            </div>
          </button>
        ))}

        {/* Add more placeholder */}
        <div className="flex flex-col items-center justify-center p-8 rounded-2xl border border-dashed border-border-muted/20 text-center opacity-40 hover:opacity-100 transition-all cursor-default">
           <Plus size={24} className="text-text-muted mb-2" />
           <div className="text-[10px] font-black uppercase tracking-widest text-text-muted">More coming soon</div>
        </div>
      </div>
    </div>
  );
});
