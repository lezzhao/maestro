import { Languages, Palette } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
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
    <section className="space-y-6">
      <div className="flex items-center gap-3 px-2">
        <div className="flex flex-col">
          <h2 className="text-xl font-bold tracking-tight">
            {t("general_settings") || "General Settings"}
          </h2>
          <p className="text-sm text-text-muted mt-1">
            Customization & Locale
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="rounded-xl border border-border-muted bg-bg-surface overflow-hidden">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Palette size={16} className="text-text-muted" />
              <CardTitle className="text-sm font-semibold">
                {t("theme_label") || "Theme"}
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-4 px-6 pb-6">
            <div className="flex gap-2 w-full max-w-sm">
              <button
                className={cn(
                  "flex-1 rounded-lg px-3 py-2 text-sm font-medium border transition-colors",
                  theme === "light" ? "bg-bg-elevated border-border text-text-main shadow-sm" : "bg-transparent border-transparent text-text-muted hover:bg-bg-subtle"
                )}
                onClick={() => onThemeChange("light")}
              >
                Light
              </button>
              <button
                className={cn(
                  "flex-1 rounded-lg px-3 py-2 text-sm font-medium border transition-colors",
                  theme === "dark" ? "bg-bg-elevated border-border text-text-main shadow-sm" : "bg-transparent border-transparent text-text-muted hover:bg-bg-subtle"
                )}
                onClick={() => onThemeChange("dark")}
              >
                Dark
              </button>
              <button
                className={cn(
                  "flex-1 rounded-lg px-3 py-2 text-sm font-medium border transition-colors",
                  theme === "system" ? "bg-bg-elevated border-border text-text-main shadow-sm" : "bg-transparent border-transparent text-text-muted hover:bg-bg-subtle"
                )}
                onClick={() => onThemeChange("system")}
              >
                System
              </button>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-xl border border-border-muted bg-bg-surface overflow-hidden">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Languages size={16} className="text-text-muted" />
              <CardTitle className="text-sm font-semibold">
                {t("language_label") || "Language"}
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-4 px-6 pb-6">
            <div className="flex gap-2 w-full max-w-xs">
              <button
                className={cn(
                  "flex-1 rounded-lg px-3 py-2 text-sm font-medium border transition-colors",
                  lang === "zh" ? "bg-bg-elevated border-border text-text-main shadow-sm" : "bg-transparent border-transparent text-text-muted hover:bg-bg-subtle"
                )}
                onClick={() => onLangChange("zh")}
              >
                中文
              </button>
              <button
                className={cn(
                  "flex-1 rounded-lg px-3 py-2 text-sm font-medium border transition-colors",
                  lang === "en" ? "bg-bg-elevated border-border text-text-main shadow-sm" : "bg-transparent border-transparent text-text-muted hover:bg-bg-subtle"
                )}
                onClick={() => onLangChange("en")}
              >
                English
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
