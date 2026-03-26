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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-6 w-full">
      {/* Integrated into Bento Grid, no standalone card needed here anymore */}
      <div className="text-[10px] font-black uppercase tracking-widest text-text-muted opacity-40 text-center">
        General Configuration Module
      </div>
    </div>
  );
}
