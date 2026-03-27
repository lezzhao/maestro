interface GeneralSettingsProps {
  theme: "light" | "dark" | "system";
  onThemeChange: (theme: "light" | "dark" | "system") => void;
  lang: "en" | "zh";
  onLangChange: (lang: "en" | "zh") => void;
}

export function GeneralSettings(_props: GeneralSettingsProps) {
  return (
    <div className="flex flex-col gap-6 w-full">
      <div className="text-[10px] font-black uppercase tracking-widest text-text-muted opacity-40 text-center">
        通用配置模块
      </div>
    </div>
  );
}
