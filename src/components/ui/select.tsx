import * as React from "react";
import { createPortal } from "react-dom";
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
  const [coords, setCoords] = React.useState({ top: 0, left: 0, width: 0 });
  const containerRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  const selectedOption = options.find(opt => opt.value === value);

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current && !containerRef.current.contains(event.target as Node) &&
        !(event.target as Element).closest('.select-portal-content')
      ) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setCoords({
        top: rect.bottom,
        left: rect.left,
        width: rect.width
      });
    }
    setOpen(!open);
  };

  return (
    <div className={cn("relative", className)} ref={containerRef}>
      <button
        type="button"
        ref={triggerRef}
        onClick={handleOpen}
        className={cn(
          "flex h-8 items-center justify-between rounded-lg border border-transparent bg-transparent px-2 text-[12px] font-medium transition-all hover:bg-accent focus:outline-none group select-none whitespace-nowrap min-w-[60px]",
          open && "bg-accent ring-1 ring-ring/30",
          buttonClassName
        )}
      >
        <div className="flex items-center gap-2 overflow-hidden mr-1">
          {Icon && <Icon size={12} className={cn("text-muted-foreground transition-colors", open ? "text-primary" : "group-hover:text-primary")} />}
          <span className={cn("truncate text-left", !selectedOption && "text-muted-foreground/50")}>
            {selectedOption ? selectedOption.label : (value || placeholder)}
          </span>
        </div>
        <ChevronDown size={12} className={cn("text-muted-foreground/30 transition-transform duration-300 shrink-0", open && "rotate-180 text-primary")} />
      </button>

      {open && createPortal(
        <div 
          style={{ 
            position: 'fixed', 
            top: `${coords.top + 6}px`, 
            left: `${coords.left}px`,
            minWidth: Math.max(240, coords.width),
          }}
          className="z-[9999] overflow-hidden rounded-xl border border-border-strong bg-card/95 text-popover-foreground shadow-vibe animate-fade-up duration-200 origin-top p-1.5 backdrop-blur-3xl select-portal-content"
        >
          <div className="max-h-[320px] overflow-y-auto no-scrollbar py-1">
            {isLoading ? (
              <div className="flex items-center justify-center py-8 gap-3 text-muted-foreground/30 animate-pulse">
                <Loader2 size={16} className="animate-spin" />
                <span className="text-[10px] font-black tracking-[0.2em] uppercase">Loading Models</span>
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
                    "relative flex w-full cursor-pointer select-none items-center rounded-[8px] py-2 pl-9 pr-3 text-[12px] font-semibold outline-none transition-all duration-150 mb-0.5 last:mb-0",
                    value === option.value 
                      ? "bg-primary text-primary-foreground shadow-glow" 
                      : "text-muted-foreground hover:bg-white/5 dark:hover:bg-white/5 hover:text-foreground active:scale-[0.98]"
                  )}
                >
                  {value === option.value && (
                    <span className="absolute left-3 flex h-4 w-4 items-center justify-center">
                      <Check size={14} strokeWidth={3} />
                    </span>
                  )}
                  <span className="truncate tracking-tight">{option.label}</span>
                </div>
              ))
            ) : (
              <div className="py-8 px-4 flex flex-col items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-muted/30 flex items-center justify-center text-muted-foreground/20">
                  <ChevronDown size={20} />
                </div>
                <span className="text-[10px] font-black text-muted-foreground/30 uppercase tracking-[0.2em]">Empty Set</span>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
