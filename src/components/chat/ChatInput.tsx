import { memo, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { SendHorizontal, Square, X, Paperclip, AlertCircle } from "lucide-react";
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
    <div className="pb-8 px-6 max-w-[960px] mx-auto w-full">
      <div className={cn(
        "relative flex flex-col bg-bg-surface/40 backdrop-blur-xl transition-all duration-300 rounded-3xl overflow-hidden",
        isRunning ? "ring-1 ring-primary/20" : ""
      )}>
        {/* Extreme Minimalist Warning */}
        {sendBlocked && (
          <div className="px-5 pt-3 flex items-center justify-between gap-3 animate-in fade-in slide-in-from-top-1 duration-300">
            <div className="flex items-center gap-2 text-rose-500/80 font-bold text-[10px] tracking-tight uppercase">
              <AlertCircle size={12} />
              <span>{sendBlockedReason}</span>
            </div>
            {onRecoveryAction && (
              <button
                type="button"
                onClick={onRecoveryAction}
                className="text-[9px] font-black uppercase tracking-[0.2em] text-emerald-500 hover:opacity-80 transition-all"
              >
                [{recoveryActionLabel}]
              </button>
            )}
          </div>
        )}

        {/* Attachments Area */}
        <AnimatePresence>
          {pendingAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-5 py-3">
              {pendingAttachments.map((att) => (
                <div key={att.path} className="flex items-center gap-2 pl-3 pr-2 py-1.5 bg-bg-base/40 border border-white/5 rounded-full text-[10px] font-bold text-text-muted hover:border-primary/30 transition-all group">
                  <span className="max-w-[150px] truncate">{att.name}</span>
                  <button onClick={() => removePendingAttachment(att.path)} className="text-text-muted/30 hover:text-rose-500 transition-colors"><X size={12} /></button>
                </div>
              ))}
            </div>
          )}
        </AnimatePresence>

        {/* Textarea Area */}
        <div className="relative flex flex-col p-1">
          <textarea
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 300)}px`;
            }}
            onCompositionStart={() => { isComposingRef.current = true; }}
            onCompositionEnd={() => { setTimeout(() => { isComposingRef.current = false; }, 50); }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || isComposingRef.current || e.keyCode === 229) return;
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (canSend) void handleSend();
              }
            }}
            placeholder={placeholder}
            className="w-full bg-transparent border-none outline-none focus:ring-0 focus:outline-none text-[15px] font-medium leading-relaxed py-4 px-6 resize-none min-h-[56px] max-h-[400px] text-text-main placeholder:text-text-muted/20"
            rows={1}
          />
          
          {/* Minimalist Action Bar */}
          <div className="flex items-center justify-between px-6 pb-4">
             <div className="flex items-center gap-6">
               {/* Context Status */}
               <div className="flex items-center gap-2 opacity-40 hover:opacity-100 transition-opacity">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]"></span>
                  <span className="text-[9px] font-black uppercase tracking-[0.2em] text-text-muted">READY</span>
               </div>
               
               <button className="text-text-muted/20 hover:text-text-muted transition-colors">
                 <Paperclip size={16} />
               </button>
             </div>

             <div className="flex items-center gap-3">
                {!isRunning ? (
                  <button
                    disabled={!canSend}
                    onClick={handleSend}
                    className={cn(
                      "flex items-center justify-center p-2 rounded-full transition-all duration-300",
                      canSend
                        ? "text-primary hover:bg-primary/10 active:scale-90"
                        : "text-text-muted/10 cursor-not-allowed"
                    )}
                  >
                    <SendHorizontal size={20} className={cn("transition-transform", canSend ? "scale-100" : "scale-90")} />
                  </button>
                ) : (
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleSend}
                      disabled={!input.trim() || sendBlocked}
                      className={cn(
                        "text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-full transition-all",
                        input.trim() && !sendBlocked
                          ? "text-primary bg-primary/10" 
                          : "text-text-muted/20"
                      )}
                    >
                      CONFIRM
                    </button>
                    <button
                      onClick={handleStop}
                      className="p-2 rounded-full text-rose-500 hover:bg-rose-500/10 transition-all active:scale-95"
                    >
                      <Square size={16} fill="currentColor" />
                    </button>
                  </div>
                )}
             </div>
          </div>
        </div>
      </div>
    </div>
  );
});
