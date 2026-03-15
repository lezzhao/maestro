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
    <div className="pb-3 px-2">
      <div className="bg-bg-surface border border-border-muted/40 rounded-xl overflow-hidden shadow-sm transition-colors focus-within:border-primary-500/40">
        {sendBlocked && (
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-rose-500/20 bg-rose-500/5">
            <p className="text-[11px] leading-relaxed text-rose-400">{sendBlockedReason}</p>
            {onRecoveryAction && (
              <button
                type="button"
                onClick={onRecoveryAction}
                className="shrink-0 px-2 py-1 rounded-md border border-emerald-500/40 text-emerald-400 text-[10px] font-semibold hover:bg-emerald-500/10 transition-colors"
              >
                {recoveryActionLabel}
              </button>
            )}
          </div>
        )}
        <AnimatePresence>
          {pendingAttachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 p-3 border-b border-border-muted/5">
              {pendingAttachments.map((att) => (
                <Badge key={att.path} variant="secondary" className="h-6 gap-1.5 px-2 bg-bg-base border-border-muted/20 text-text-muted text-[9px] font-bold">
                  <span className="max-w-[100px] truncate">{att.name}</span>
                  <button onClick={() => removePendingAttachment(att.path)} className="hover:text-rose-500"><X size={10} /></button>
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
              e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (canSend) void handleSend();
              }
            }}
            placeholder={placeholder}
            className="w-full bg-transparent border-none focus:ring-0 text-[14px] leading-relaxed py-3 px-4 resize-none min-h-[50px] max-h-[250px] text-text-main placeholder:text-text-muted/30"
            rows={1}
          />
          
          <div className="flex items-center justify-between px-3 pb-2.5">
            <div className="text-[10px] text-text-muted/70">附件入口已收敛到任务上下文</div>

            {!isRunning ? (
              <button
                disabled={!canSend}
                onClick={handleSend}
                title={sendBlocked ? sendBlockedReason : undefined}
                className={cn(
                  "w-8 h-8 flex items-center justify-center rounded-lg transition-all",
                  canSend
                    ? "bg-primary-500 text-white shadow-sm hover:bg-primary-600"
                    : "text-text-muted/20 cursor-not-allowed"
                )}
              >
                <SendHorizontal size={16} />
              </button>
            ) : (
              <div className="flex items-center gap-2">
                 <button
                  onClick={handleSend}
                  disabled={!input.trim() || sendBlocked}
                  title={sendBlocked ? sendBlockedReason : undefined}
                  className={cn(
                    "h-7 px-3 flex items-center justify-center rounded-md text-[10px] font-black uppercase tracking-widest transition-all",
                    input.trim() && !sendBlocked
                      ? "bg-primary-500 text-white shadow-md active:scale-95" 
                      : "bg-bg-base text-text-muted/30 border border-border-muted/10 cursor-not-allowed"
                  )}
                >
                  Confirm
                </button>
                <button
                  onClick={handleStop}
                  className="w-8 h-8 flex items-center justify-center rounded-lg bg-rose-500/10 text-rose-500 hover:bg-rose-500 hover:text-white transition-all shadow-sm"
                >
                  <Square size={12} fill="currentColor" />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
