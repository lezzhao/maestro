import { useAppStore } from "../../stores/appStore";
import { useTranslation } from "../../i18n";
import { Input } from "../ui/input";

interface GeneralSettingsProps {
  theme: "light" | "dark" | "system";
  onThemeChange: (theme: "light" | "dark" | "system") => void;
  lang: "en" | "zh";
  onLangChange: (lang: "en" | "zh") => void;
}

export function GeneralSettings({ theme, onThemeChange, lang, onLangChange }: GeneralSettingsProps) {
  const { t } = useTranslation();
  const maxConcurrentTasks = useAppStore((state) => state.maxConcurrentTasks);
  const setMaxConcurrentTasks = useAppStore((state) => state.setMaxConcurrentTasks);

  return (
    <div className="flex flex-col gap-8 w-full animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="bg-bg-surface border border-border-muted/10 rounded-2xl divide-y divide-border-muted/10 overflow-hidden">
        {/* Theme */}
        <div className="flex items-center justify-between p-6">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-bold uppercase tracking-widest text-text-main/80">{t("theme_label")}</span>
            <span className="text-[10px] text-text-muted opacity-60 uppercase">{t("theme_label")} switch</span>
          </div>
          <div className="flex gap-1 p-1 bg-bg-elevated/30 rounded-xl">
            {["light", "dark", "system"].map((tOpt) => (
              <button 
                key={tOpt}
                onClick={() => onThemeChange(tOpt as "light" | "dark" | "system")}
                className={`h-8 px-5 text-[10px] uppercase font-black transition-all rounded-lg ${
                  theme === tOpt 
                    ? "bg-bg-surface text-text-main shadow-sm border border-border-muted/10" 
                    : "text-text-muted hover:text-text-main hover:bg-bg-elevated/50"
                }`}
              >
                {tOpt}
              </button>
            ))}
          </div>
        </div>

        {/* Language */}
        <div className="flex items-center justify-between p-6">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-bold uppercase tracking-widest text-text-main/80">{t("language_label")}</span>
            <span className="text-[10px] text-text-muted opacity-60 uppercase">System language interface</span>
          </div>
          <div className="flex gap-1 p-1 bg-bg-elevated/30 rounded-xl">
            {[
              { id: "zh", label: "中文" },
              { id: "en", label: "English" }
            ].map((lOpt) => (
              <button 
                key={lOpt.id}
                onClick={() => onLangChange(lOpt.id as "zh" | "en")}
                className={`h-8 px-6 text-[10px] uppercase font-black transition-all rounded-lg ${
                  lang === lOpt.id 
                    ? "bg-bg-surface text-text-main shadow-sm border border-border-muted/10" 
                    : "text-text-muted hover:text-text-main hover:bg-bg-elevated/50"
                }`}
              >
                {lOpt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Concurrency */}
        <div className="flex items-center justify-between p-6">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-bold uppercase tracking-widest text-text-main/80">{t("max_concurrent_tasks_label")}</span>
            <span className="text-[10px] text-text-muted opacity-60 uppercase">{t("max_concurrent_tasks_desc")}</span>
          </div>
          <div className="w-32">
            <Input 
              type="number" 
              min={1} 
              max={10}
              value={maxConcurrentTasks}
              onChange={(e) => setMaxConcurrentTasks(parseInt(e.target.value) || 1)}
              className="h-10 rounded-xl border-border-muted/20 bg-bg-elevated/30 text-center font-bold"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
