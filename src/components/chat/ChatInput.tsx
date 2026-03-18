import { memo } from "react";
import { AnimatePresence } from "framer-motion";
import { SendHorizontal, Square, X } from "lucide-react";
import { Badge } from "../ui/badge";
import { cn } from "../../lib/utils";

export interface ChatInputProps {
  input: string;
  setInput: (input: string) => void;
  isRunning: boolean;
  pendingAttachments: { path: string; name: string }[];
  removePendingAttachment: (path: string) => void;
  handleSend: () => Promise<void>;
  handleStop: () => Promise<void>;
  placeholder: string;
  sendBlocked: boolean;
  sendBlockedReason: string;
  onRecoveryAction?: () => void;
  recoveryActionLabel: string;
}

export const ChatInput = memo(function ChatInput({
  input,
  setInput,
  isRunning,
  pendingAttachments,
  removePendingAttachment,
  handleSend,
  handleStop,
  placeholder,
  sendBlocked,
  sendBlockedReason,
  onRecoveryAction,
  recoveryActionLabel,
}: ChatInputProps) {
  const canSend = (input.trim() || pendingAttachments.length > 0) && !sendBlocked;

  return (
    <div className="pb-6 px-6">
      <div className={cn(
        "bg-bg-surface/80 backdrop-blur-xl border border-border-muted/30 rounded-2xl overflow-hidden transition-all shadow-lg",
        isRunning ? "ring-1 ring-primary-500/20" : "focus-within:border-primary-500/40 focus-within:ring-4 focus-within:ring-primary-500/5 shadow-black/5"
      )}>
        {sendBlocked && (
          <div className="flex items-center justify-between gap-4 px-4 py-2 bg-rose-500/5 border-b border-rose-500/10">
            <p className="text-[11px] font-bold text-rose-500/80">{sendBlockedReason}</p>
            {onRecoveryAction && (
              <button
                type="button"
                onClick={onRecoveryAction}
                className="shrink-0 px-2.5 py-1 rounded-lg bg-emerald-500 text-white text-[10px] font-black uppercase tracking-wider hover:bg-emerald-600 transition-all active:scale-95"
              >
                {recoveryActionLabel}
              </button>
            )}
          </div>
        )}
        <AnimatePresence>
          {pendingAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2 p-3 bg-bg-base/20 border-b border-border-muted/5">
              {pendingAttachments.map((att) => (
                <Badge key={att.path} variant="secondary" className="h-7 gap-2 px-2.5 bg-bg-base rounded-lg border-border-muted/20 text-text-muted text-[10px] font-bold shadow-sm">
                  <span className="max-w-[120px] truncate">{att.name}</span>
                  <button onClick={() => removePendingAttachment(att.path)} className="hover:text-rose-500 transition-colors"><X size={12} /></button>
                </Badge>
              ))}
            </div>
          )}
        </AnimatePresence>

        <div className="flex flex-col">
          <textarea
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 240)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (canSend) void handleSend();
              }
            }}
            placeholder={placeholder}
            className="w-full bg-transparent border-none focus:ring-0 text-[13px] font-medium leading-relaxed py-4 px-5 resize-none min-h-[56px] max-h-[250px] text-text-main placeholder:text-text-muted/20"
            rows={1}
          />
          
          <div className="flex items-center justify-between px-4 pb-4">
            <div className="text-[10px] font-bold text-text-muted/30 uppercase tracking-widest pl-1">
              Context Ready
            </div>

            {!isRunning ? (
              <button
                disabled={!canSend}
                onClick={handleSend}
                title={sendBlocked ? sendBlockedReason : undefined}
                className={cn(
                  "w-10 h-10 flex items-center justify-center rounded-xl transition-all shadow-sm active:scale-90",
                  canSend
                    ? "bg-primary-500 text-white hover:bg-primary-600 shadow-primary-500/20"
                    : "bg-bg-base text-text-muted/10 border border-border-muted/10 cursor-not-allowed"
                )}
              >
                <SendHorizontal size={18} className={cn(canSend ? "opacity-100" : "opacity-40")} />
              </button>
            ) : (
              <div className="flex items-center gap-2">
                 <button
                  onClick={handleSend}
                  disabled={!input.trim() || sendBlocked}
                  title={sendBlocked ? sendBlockedReason : undefined}
                  className={cn(
                    "h-9 px-4 flex items-center justify-center rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95",
                    input.trim() && !sendBlocked
                      ? "bg-primary-500 text-white shadow-lg shadow-primary-500/20" 
                      : "bg-bg-base text-text-muted/20 border border-border-muted/10 cursor-not-allowed"
                  )}
                >
                  Confirm Send
                </button>
                <button
                  onClick={handleStop}
                  className="w-10 h-10 flex items-center justify-center rounded-xl bg-rose-500/10 text-rose-500 hover:bg-rose-500 hover:text-white transition-all active:scale-90 shadow-sm"
                >
                  <Square size={14} fill="currentColor" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
