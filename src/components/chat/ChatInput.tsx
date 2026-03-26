import { memo, useRef } from "react";
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
  const isComposingRef = useRef(false);
  const canSend = (input.trim() || pendingAttachments.length > 0) && !sendBlocked;

  return (
    <div className="pb-4 px-4">
      <div className={cn(
        "bg-bg-surface/60 backdrop-blur-3xl border border-border-muted/20 rounded-[20px] overflow-hidden transition-all shadow-[0_8px_32px_rgb(0,0,0,0.04)] dark:shadow-[0_8px_32px_rgb(0,0,0,0.2)]",
        isRunning ? "ring-2 ring-primary-500/30 glow-primary" : "focus-within:border-primary-500/40 focus-within:ring-4 focus-within:ring-primary-500/10 hover:border-border-muted/40"
      )}>
        {sendBlocked && (
          <div className="flex justify-center border-b border-border-muted/5 px-4 py-2 bg-bg-surface/30 relative">
            <div className="flex items-center gap-3 relative z-10 w-full justify-between">
              <span className="flex items-center gap-2 text-[11px] font-bold text-rose-500/80 tracking-wide">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse shadow-[0_0_6px_rgba(244,63,94,0.6)]" />
                {sendBlockedReason}
              </span>
              {onRecoveryAction && (
                <button
                  type="button"
                  onClick={onRecoveryAction}
                  className="shrink-0 text-[9px] font-black uppercase tracking-widest text-emerald-500 hover:text-emerald-400 border border-emerald-500/20 hover:border-emerald-500/50 bg-emerald-500/5 rounded px-2.5 py-1 transition-all active:scale-95"
                >
                  {recoveryActionLabel}
                </button>
              )}
            </div>
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
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={() => {
              // React 偶尔会先触发 onCompositionEnd 再触发 onKeyDown(Enter)
              // 使用 setTimeout 保证当前事件循环中的 onKeyDown 仍然判断为 composing
              setTimeout(() => {
                isComposingRef.current = false;
              }, 50);
            }}
            onKeyDown={(e) => {
              // 229 也是某些浏览器下输入法正在输入的重要标志
              if (e.nativeEvent.isComposing || isComposingRef.current || e.keyCode === 229) {
                return;
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (canSend) void handleSend();
              }
            }}
            placeholder={placeholder}
            className="w-full bg-transparent border-none focus:ring-0 text-[13px] font-medium leading-relaxed py-3 px-4 resize-none min-h-[44px] max-h-[250px] text-text-main placeholder:text-text-muted/20"
            rows={1}
          />
          
          <div className="flex items-center justify-between px-4 pb-3 mt-0">
            <div className="text-[10px] font-black text-text-muted/30 uppercase tracking-[0.15em] flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500/60" />
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
