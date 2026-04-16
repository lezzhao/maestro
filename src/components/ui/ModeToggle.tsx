import { cn } from "../../lib/utils";

interface ModeToggleProps {
  mode: "api" | "cli";
  onChange: (mode: "api" | "cli") => void;
  className?: string;
}

export function ModeToggle({ mode, onChange, className }: ModeToggleProps) {
  return (
    <div className={cn("flex items-center gap-1 p-1 bg-white/[0.03] rounded-xl border border-white/[0.04] transition-all", className)}>
      <button
        type="button"
        onClick={() => onChange("api")}
        className={cn(
          "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-[0.15em] transition-all duration-300 relative",
          mode === "api"
            ? "text-primary bg-primary/10 shadow-lg shadow-primary/5"
            : "text-muted-foreground/30 hover:text-muted-foreground/60"
        )}
      >
        API
        {mode === "api" && (
          <div className="absolute -bottom-[2px] left-2 right-2 h-[1.5px] bg-primary rounded-full animate-in fade-in zoom-in duration-500" />
        )}
      </button>
      
      <div className="h-3 w-[1px] bg-white/[0.04] mx-0.5" />
      
      <button
        type="button"
        onClick={() => onChange("cli")}
        className={cn(
          "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-[0.15em] transition-all duration-300 relative",
          mode === "cli"
            ? "text-amber-500 bg-amber-500/10 shadow-lg shadow-amber-500/5"
            : "text-muted-foreground/30 hover:text-muted-foreground/60"
        )}
      >
        CLI
        {mode === "cli" && (
          <div className="absolute -bottom-[2px] left-2 right-2 h-[1.5px] bg-amber-500 rounded-full animate-in fade-in zoom-in duration-500" />
        )}
      </button>
    </div>
  );
}
