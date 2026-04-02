import { memo, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { SendHorizontal, Square, X, Paperclip, AlertCircle, FileText } from "lucide-react";
import { cn } from "../../lib/utils";
import type { ChatAttachment } from "../../types";

export interface ChatInputProps {
  input: string;
  setInput: (input: string) => void;
  isRunning: boolean;
  pendingAttachments: ChatAttachment[];
  removePendingAttachment: (path: string) => void;
  addPendingAttachments: (attachments: ChatAttachment[]) => void;
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
  addPendingAttachments,
  handleSend,
  handleStop,
  placeholder,
  sendBlocked,
  sendBlockedReason,
  onRecoveryAction,
  recoveryActionLabel,
}: ChatInputProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isComposingRef = useRef(false);
  const [isFocused, setIsFocused] = useState(false);
  const canSend = (input.trim() || pendingAttachments.length > 0) && !sendBlocked;

  const onFileClick = () => {
    fileInputRef.current?.click();
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newAttachments: ChatAttachment[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.type.startsWith("image/")) {
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
        const [mimePart, dataPart] = base64.split(";base64,");
        const mimeType = mimePart.replace("data:", "");

        newAttachments.push({
          name: file.name,
          path: `upload://${Date.now()}-${file.name}`,
          mime_type: mimeType,
          data: dataPart,
        });
      } else {
        newAttachments.push({
          name: file.name,
          path: `upload://${Date.now()}-${file.name}`,
        });
      }
    }
    addPendingAttachments(newAttachments);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="pb-8 px-6 max-w-[960px] mx-auto w-full">
      <div className={cn(
        "relative flex flex-col bg-bg-surface/60 backdrop-blur-3xl transition-all duration-500 rounded-4xl overflow-hidden border border-border-muted/10",
        isFocused ? "shadow-glow ring-1 ring-primary/30 border-primary/20 scale-[1.01]" : "shadow-md hover:border-border-muted/30",
        isRunning ? "animate-pulse" : ""
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
            <div className="flex flex-wrap gap-3 px-6 pt-5 pb-2">
              {pendingAttachments.map((att) => (
                <div key={att.path} className="relative group">
                  {att.mime_type?.startsWith("image/") && att.data ? (
                    <div className="relative w-16 h-16 rounded-xl overflow-hidden border border-primary/20 shadow-sm bg-primary/5 group">
                      <img
                        src={`data:${att.mime_type};base64,${att.data}`}
                        alt={att.name}
                        className="w-full h-full object-cover transition-transform group-hover:scale-110"
                      />
                      <button
                        onClick={() => removePendingAttachment(att.path)}
                        className="absolute top-1 right-1 p-1 rounded-full bg-rose-500 text-white shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 pl-3 pr-1 py-1.5 bg-primary/5 border border-primary/10 rounded-xl text-[10px] font-bold text-primary transition-all hover:bg-primary/10">
                      <FileText size={10} className="text-primary/40" />
                      <span className="max-w-[150px] truncate">{att.name}</span>
                      <button
                        onClick={() => removePendingAttachment(att.path)}
                        className="p-1 rounded-md text-primary/30 hover:text-rose-500 hover:bg-rose-500/10 transition-all"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  )}
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
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder={placeholder}
            className="w-full bg-transparent border-none outline-none focus:ring-0 focus:outline-none text-[16px] font-medium leading-relaxed py-5 px-8 resize-none min-h-[64px] max-h-[400px] text-text-main placeholder:text-text-muted/30 selection:bg-primary/20"
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

              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                multiple
                accept="image/*"
                onChange={onFileChange}
              />
              <button
                onClick={onFileClick}
                className="text-text-muted/20 hover:text-text-muted transition-colors p-1 rounded-md hover:bg-bg-elevated"
              >
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
                    disabled={!input.trim() && pendingAttachments.length === 0}
                    className={cn(
                      "text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-full transition-all",
                      (input.trim() || pendingAttachments.length > 0)
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
