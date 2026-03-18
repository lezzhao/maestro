import { Languages, Palette } from "lucide-react";

import { cn } from "../../lib/utils";
import { useTranslation } from "../../i18n";

interface GeneralSettingsProps {
  theme: "light" | "dark" | "system";
  onThemeChange: (theme: "light" | "dark" | "system") => void;
  lang: "en" | "zh";
  onLangChange: (lang: "en" | "zh") => void;
}

export function GeneralSettings({
  theme,
  onThemeChange,
  lang,
  onLangChange,
}: GeneralSettingsProps) {
  const { t } = useTranslation();

  return (
    <section className="space-y-6 px-4">

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-2">
        <div className="p-6 rounded-xl border border-border-muted bg-bg-surface flex flex-col gap-4">
          <div className="flex items-center gap-2 text-text-muted opacity-80">
            <Palette size={16} />
            <span className="text-sm font-medium">{t("theme_label") || "Theme"}</span>
          </div>
          <div className="flex bg-bg-elevated p-1 rounded-lg w-full">
            <button
              className={cn(
                "flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-all",
                theme === "light" ? "bg-bg-surface text-text-main shadow-sm" : "text-text-muted hover:text-text-main"
              )}
              onClick={() => onThemeChange("light")}
            >
              Light
            </button>
            <button
              className={cn(
                "flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-all",
                theme === "dark" ? "bg-bg-surface text-text-main shadow-sm" : "text-text-muted hover:text-text-main"
              )}
              onClick={() => onThemeChange("dark")}
            >
              Dark
            </button>
            <button
              className={cn(
                "flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-all",
                theme === "system" ? "bg-bg-surface text-text-main shadow-sm" : "text-text-muted hover:text-text-main"
              )}
              onClick={() => onThemeChange("system")}
            >
              System
            </button>
          </div>
        </div>

        <div className="p-6 rounded-xl border border-border-muted bg-bg-surface flex flex-col gap-4">
          <div className="flex items-center gap-2 text-text-muted opacity-80">
            <Languages size={16} />
            <span className="text-sm font-medium">{t("language_label") || "Language"}</span>
          </div>
          <div className="flex bg-bg-elevated p-1 rounded-lg w-full max-w-xs">
            <button
              className={cn(
                "flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-all",
                lang === "zh" ? "bg-bg-surface text-text-main shadow-sm" : "text-text-muted hover:text-text-main"
              )}
              onClick={() => onLangChange("zh")}
            >
              中文
            </button>
            <button
              className={cn(
                "flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-all",
                lang === "en" ? "bg-bg-surface text-text-main shadow-sm" : "text-text-muted hover:text-text-main"
              )}
              onClick={() => onLangChange("en")}
            >
              English
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
