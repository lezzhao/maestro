import { ShieldCheck } from "lucide-react";
import { cn } from "../lib/utils";
import { useTranslation } from "../i18n";

type Props = {
  provider: "none" | "bmad" | "custom";
  onChange: (provider: "none" | "bmad" | "custom") => void;
};

export function SpecPanel({ provider, onChange }: Props) {
  const { t } = useTranslation();
  const options: Array<{ id: "none" | "bmad" | "custom"; label: string }> = [
    { id: "none", label: t("none_label") },
    { id: "bmad", label: t("bmad_label") },
    { id: "custom", label: t("custom_label") },
  ];

  return (
    <div className="flex flex-col ml-1">
      <span className="text-[10px] uppercase font-bold text-text-muted tracking-widest leading-none mb-1.5 flex items-center gap-1.5 px-0.5">
        <ShieldCheck size={11} className="text-emerald-500" />
        {t("rule_spec")}
      </span>
      <div className="flex gap-1 bg-bg-base/30 p-0.5 rounded-md border border-border-muted">
        {options.map((opt) => (
          <button
            key={opt.id}
            className={cn(
              "text-[10px] px-2 py-0.5 rounded transition-all font-bold uppercase",
              provider === opt.id 
                ? "bg-primary-500/15 text-primary-400 shadow-sm ring-1 ring-primary-500/20" 
                : "text-text-muted hover:text-text-main"
            )}
            onClick={() => onChange(opt.id)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
