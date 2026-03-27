import { useEffect, useState } from "react";
import { ChevronRight, X } from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "./button";
import type { ChoiceVariant } from "../../types";

export interface ChoiceDialogOption {
  id: string;
  label: string;
  description?: string;
  variant?: ChoiceVariant;
  onSelect: () => Promise<void> | void;
}

interface ChoiceDialogProps {
  open: boolean;
  title: string;
  description?: string;
  options: ChoiceDialogOption[];
  cancelLabel?: string;
  onClose: () => void;
}

export function ChoiceDialog({
  open,
  title,
  description,
  options,
  cancelLabel = "暂不处理",
  onClose,
}: ChoiceDialogProps) {
  const [pendingOptionId, setPendingOptionId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setPendingOptionId(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pendingOptionId) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose, pendingOptionId]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-320 flex items-center justify-center p-4 bg-bg-base/70 backdrop-blur-md">
      <button
        type="button"
        aria-label="关闭选择框"
        className="absolute inset-0"
        disabled={Boolean(pendingOptionId)}
        onClick={onClose}
      />

      <div className="relative w-full max-w-[520px] overflow-hidden rounded-2xl border border-border-muted/20 bg-bg-surface shadow-2xl">
        <div className="flex items-start justify-between px-6 pt-6 pb-3">
          <div className="space-y-1">
            <h2 className="text-lg font-black tracking-tight text-text-main">{title}</h2>
            {description && (
              <p className="max-w-[420px] text-sm leading-relaxed text-text-muted/80">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={Boolean(pendingOptionId)}
            className="rounded-full p-2 text-text-muted hover:bg-bg-elevated hover:text-text-main transition-colors disabled:opacity-40"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3 px-6 py-4">
          {options.map((option) => {
            const isPending = pendingOptionId === option.id;
            const isDestructive = option.variant === "destructive";

            return (
              <button
                key={option.id}
                type="button"
                disabled={Boolean(pendingOptionId)}
                onClick={async () => {
                  try {
                    setPendingOptionId(option.id);
                    await option.onSelect();
                    onClose();
                  } finally {
                    setPendingOptionId(null);
                  }
                }}
                className={cn(
                  "w-full rounded-xl border px-4 py-4 text-left transition-all",
                  "hover:scale-[1.01] hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60",
                  isDestructive
                    ? "border-rose-500/20 bg-rose-500/5 hover:border-rose-500/40"
                    : "border-border-muted/20 bg-bg-base/50 hover:border-primary/30 hover:bg-primary/5",
                )}
              >
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div
                      className={cn(
                        "text-sm font-bold",
                        isDestructive ? "text-rose-500" : "text-text-main",
                      )}
                    >
                      {option.label}
                    </div>
                    {option.description && (
                      <div className="mt-1 text-xs leading-relaxed text-text-muted/75">
                        {option.description}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0">
                    {isPending ? (
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent text-primary" />
                    ) : (
                      <ChevronRight
                        size={16}
                        className={cn(
                          "opacity-50",
                          isDestructive ? "text-rose-500" : "text-text-muted",
                        )}
                      />
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex justify-end px-6 pb-6 pt-2">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={Boolean(pendingOptionId)}
            className="text-xs font-bold text-text-muted"
          >
            {cancelLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
