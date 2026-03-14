import * as React from "react"
import { ChevronDown, Check, LucideIcon } from "lucide-react"
import { cn } from "../../lib/utils"

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
}

const Select = ({ value, onChange, options, icon: Icon, placeholder = "Select...", className }: SelectProps) => {
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
          "flex h-9 w-full items-center justify-between rounded-md border border-border-muted bg-bg-base px-3 py-1 text-sm shadow-sm transition-all hover:bg-bg-elevated/50 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-50",
          Icon && "pl-10", // Increased padding for icon
          open && "ring-1 ring-primary-500 border-primary-500"
        )}
      >
        <div className="flex items-center gap-2 overflow-hidden mr-2">
          {Icon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted transition-colors pointer-events-none">
              <Icon size={14} />
            </div>
          )}
          <span className={cn("truncate", !selectedOption && "text-text-muted/50")}>
            {selectedOption ? selectedOption.label : placeholder}
          </span>
        </div>
        <ChevronDown size={14} className={cn("text-text-muted transition-transform duration-200 shrink-0", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute top-[calc(100%+4px)] left-0 w-full z-100 min-w-32 overflow-hidden rounded-md border border-border-strong bg-bg-surface text-text-main shadow-lg animate-in fade-in zoom-in-95 duration-200 origin-top">
          <div className="p-1 max-h-60 overflow-y-auto scrollbar-thin">
            {options.map((option) => (
              <div
                key={option.value}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={cn(
                  "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors hover:bg-primary-500/20 hover:text-primary-400",
                  value === option.value && "bg-primary-500/15 text-primary-400 font-bold"
                )}
              >
                {value === option.value && (
                  <span className="absolute left-2.5 flex h-3.5 w-3.5 items-center justify-center">
                    <Check size={14} />
                  </span>
                )}
                <span className="truncate">{option.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export { Select }
