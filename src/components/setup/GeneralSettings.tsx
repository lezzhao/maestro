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
        <div className="w-10 h-10 rounded-xl bg-primary-500/10 text-primary-500 flex items-center justify-center">
          <Palette size={20} />
        </div>
        <div className="flex flex-col">
          <h2 className="text-xl font-bold text-text-main tracking-tight">
            {t("general_settings") || "General Settings"}
          </h2>
          <p className="text-[10px] text-text-muted font-semibold uppercase tracking-wider mt-0.5">
            Customization & Locale
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="rounded-xl border-border-muted bg-bg-surface shadow-sm overflow-hidden">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2 text-primary-500">
              <Palette size={16} />
              <CardTitle className="text-sm font-semibold uppercase">
                {t("theme_label") || "Theme"}
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-4 px-6 pb-6">
            <div className="capsule-group w-full max-w-sm">
              <button
                className={cn(
                  "capsule-sm flex-1 text-[10px] font-semibold uppercase",
                  theme === "light" && "active",
                )}
                onClick={() => onThemeChange("light")}
              >
                Light
              </button>
              <button
                className={cn(
                  "capsule-sm flex-1 text-[10px] font-semibold uppercase",
                  theme === "dark" && "active",
                )}
                onClick={() => onThemeChange("dark")}
              >
                Dark
              </button>
              <button
                className={cn(
                  "capsule-sm flex-1 text-[10px] font-semibold uppercase",
                  theme === "system" && "active",
                )}
                onClick={() => onThemeChange("system")}
              >
                System
              </button>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-xl border-border-muted bg-bg-surface shadow-sm overflow-hidden">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2 text-primary-500">
              <Languages size={16} />
              <CardTitle className="text-sm font-semibold uppercase">
                {t("language_label") || "Language"}
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-4 px-6 pb-6">
            <div className="capsule-group w-full max-w-xs">
              <button
                className={cn(
                  "capsule-sm flex-1 text-[10px] font-semibold uppercase",
                  lang === "zh" && "active",
                )}
                onClick={() => onLangChange("zh")}
              >
                中文
              </button>
              <button
                className={cn(
                  "capsule-sm flex-1 text-[10px] font-semibold uppercase",
                  lang === "en" && "active",
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
