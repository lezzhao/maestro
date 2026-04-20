import { ReactNode } from "react";
import { cn } from "../../lib/utils";

interface PanelHeaderProps {
  title?: ReactNode;
  actions?: ReactNode;
  className?: string;
  showBorder?: boolean;
}

/**
 * PanelHeader - A standardized header for all top-level panels (Sidebar, Chat, etc.)
 * Enforces the 56px global height and glassmorphism styling.
 */
export function PanelHeader({ 
  title, 
  actions, 
  className, 
  showBorder = true 
}: PanelHeaderProps) {
  return (
    <header className={cn(
      "h-[var(--header-height)] min-h-[var(--header-height)] flex items-center justify-between px-6",
      "bg-glass-surface backdrop-blur-3xl z-[var(--z-header)]",
      showBorder && "border-b border-border/40",
      className
    )}>
      <div className="flex items-center gap-3 flex-1 mr-4 min-w-0">
        {title}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {actions}
      </div>
    </header>
  );
}
