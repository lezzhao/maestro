import * as React from "react";
import { ChevronDown, Check, type LucideIcon, Loader2 } from "lucide-react";
import { cn } from "../../lib/utils";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  icon?: LucideIcon;
  placeholder?: string;
  className?: string;
  buttonClassName?: string;
  isLoading?: boolean;
}

export const Select = ({ value, onChange, options, icon: Icon, placeholder = "Select...", className, buttonClassName, isLoading }: SelectProps) => {
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const selectedOption = options.find(opt => opt.value === value);

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className={cn("relative", className)} ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "flex h-8 items-center justify-between rounded-lg border border-transparent bg-transparent px-2 text-[12px] font-bold transition-all hover:bg-bg-elevated focus:outline-none group select-none whitespace-nowrap min-w-[60px]",
          open && "bg-bg-elevated ring-1 ring-primary/30",
          buttonClassName
        )}
      >
        <div className="flex items-center gap-2 overflow-hidden mr-1">
          {Icon && <Icon size={12} className={cn("text-text-muted/40 transition-colors", open ? "text-primary" : "group-hover:text-primary/70")} />}
          <span className={cn("truncate text-left", !selectedOption && "text-text-muted/50")}>
            {selectedOption ? selectedOption.label : (value || placeholder)}
          </span>
        </div>
        <ChevronDown size={12} className={cn("text-text-muted/20 transition-transform duration-300 shrink-0", open && "rotate-180 text-primary")} />
      </button>

      {open && (
        <div 
          className="absolute top-[calc(100%+8px)] left-0 min-w-[200px] z-[50] overflow-hidden rounded-xl border border-border-strong bg-bg-surface text-text-main shadow-2xl animate-in fade-in zoom-in-95 duration-200 origin-top p-1.5 backdrop-blur-3xl"
          style={{ boxShadow: '0 20px 50px -12px rgba(0, 0, 0, 0.25)' }}
        >
          <div className="max-h-[300px] overflow-y-auto no-scrollbar py-1">
            {isLoading ? (
              <div className="flex items-center justify-center py-6 gap-2 text-text-muted/40 animate-pulse">
                <Loader2 size={14} className="animate-spin" />
                <span className="text-[10px] font-bold tracking-widest uppercase">Fetching...</span>
              </div>
            ) : options.length > 0 ? (
              options.map((option) => (
                <div
                  key={option.value}
                  onClick={() => {
                    if (option.value !== value) onChange(option.value);
                    setOpen(false);
                  }}
                  className={cn(
                    "relative flex w-full cursor-pointer select-none items-center rounded-lg py-2 pl-9 pr-3 text-[12px] font-bold outline-none transition-all duration-150 mb-0.5 last:mb-0",
                    value === option.value 
                      ? "bg-primary text-white shadow-lg shadow-primary/20" 
                      : "text-text-muted hover:bg-bg-elevated hover:text-text-main"
                  )}
                >
                  {value === option.value && (
                    <span className="absolute left-2.5 flex h-4 w-4 items-center justify-center">
                      <Check size={14} strokeWidth={3} />
                    </span>
                  )}
                  <span className="truncate">{option.label}</span>
                </div>
              ))
            ) : (
              <div className="py-6 px-4 flex flex-col items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-bg-base/50 flex items-center justify-center text-text-muted/20">
                  <ChevronDown size={16} />
                </div>
                <span className="text-[10px] font-bold text-text-muted/40 uppercase tracking-widest">No options</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
