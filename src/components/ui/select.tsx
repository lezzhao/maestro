import * as React from "react";
import { ChevronDown, Check, type LucideIcon } from "lucide-react";
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
  className?: string; // Wrapper className
  buttonClassName?: string; // Button className
}

export const Select = ({ value, onChange, options, icon: Icon, placeholder = "Select...", className, buttonClassName }: SelectProps) => {
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
    <div className={cn("relative w-full", className)} ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "flex h-7 w-full items-center justify-between rounded-lg border border-transparent bg-transparent px-2 text-[11px] font-bold transition-all hover:bg-bg-elevated/80 focus:outline-none group",
          open && "bg-bg-elevated ring-1 ring-primary-500/30",
          buttonClassName
        )}
      >
        <div className="flex items-center gap-1.5 overflow-hidden">
          {Icon && <Icon size={11} className="text-text-muted/40 group-hover:text-primary-500/60 transition-colors" />}
          <span className={cn("truncate text-left", !selectedOption && "text-text-muted/50")}>
            {selectedOption ? selectedOption.label : (value || placeholder)}
          </span>
        </div>
        <ChevronDown size={11} className={cn("text-text-muted/30 transition-transform duration-200 shrink-0 ml-1.5", open && "rotate-180 text-primary-500")} />
      </button>

      {open && (
        <div className="absolute top-[calc(100%+6px)] left-0 w-full z-100 min-w-[180px] overflow-hidden rounded-lg border border-border-strong bg-bg-surface text-text-main shadow-xl animate-in fade-in zoom-in-95 duration-200 origin-top p-1 backdrop-blur-xl">
          <div className="max-h-60 overflow-y-auto scrollbar-thin scrollbar-thumb-bg-elevated scrollbar-track-transparent">
            {options.map((option) => (
              <div
                key={option.value}
                onClick={() => {
                  if (option.value !== value) onChange(option.value);
                  setOpen(false);
                }}
                className={cn(
                  "relative flex w-full cursor-default select-none items-center rounded-md py-1.5 pl-8 pr-3 text-[11px] font-bold outline-none transition-all duration-150 mb-0.5 last:mb-0",
                  value === option.value 
                    ? "bg-primary-500/15 text-primary-500" 
                    : "text-text-muted hover:bg-bg-elevated hover:text-text-main"
                )}
              >
                {value === option.value && (
                  <span className="absolute left-2.5 flex h-3.5 w-3.5 items-center justify-center text-primary-500">
                    <Check size={12} strokeWidth={3} />
                  </span>
                )}
                <span className="truncate">{option.label}</span>
              </div>
            ))}
            {options.length === 0 && (
              <div className="py-2 px-3 text-[10px] text-text-muted italic text-center">
                No items found
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
