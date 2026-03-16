import { Loader2 } from "lucide-react";
import { useTranslation } from "../../i18n";

export function PanelFallback({ label }: { label: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex-1 min-h-0 flex flex-col items-center justify-center p-6 animate-pulse opacity-60">
      <div className="w-16 h-16 rounded-2xl bg-bg-elevated/80 flex items-center justify-center mb-6 shadow-inner">
        <Loader2 size={24} className="animate-spin text-primary-500/50" />
      </div>
      <div className="text-xs font-black tracking-widest uppercase text-text-muted/60 mb-2">
        {t("loading")} {label}
      </div>
    </div>
  );
}
