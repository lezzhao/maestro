import { memo, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { SendHorizontal, Square, X, Paperclip, AlertCircle, FileText, Sparkles } from "lucide-react";
import { cn } from "../../lib/utils";
import type { ChatAttachment } from "../../types";
import { useHarness } from "../../hooks/useHarness";
import { ChatInputMetadata } from "./ChatInputMetadata";

export interface ChatInputProps {
  input: string;
  setInput: (input: string) => void;
  isRunning: boolean;
  pendingAttachments: ChatAttachment[];
  removePendingAttachment: (path: string) => void;
  addPendingAttachments: (attachments: ChatAttachment[]) => void;
  pinnedFiles: string[];
  removePinnedFile: (path: string) => void;
  handleSend: () => Promise<void>;
  handleStop: () => Promise<void>;
  placeholder: string;
  sendBlocked: boolean;
  sendBlockedReason: string;
  onRecoveryAction?: () => void;
  recoveryActionLabel: string;
  taskId: string | null;
}

export const ChatInput = memo(function ChatInput({
  input,
  setInput,
  isRunning,
  pendingAttachments,
  removePendingAttachment,
  addPendingAttachments,
  pinnedFiles,
  removePinnedFile,
  handleSend,
  handleStop,
  placeholder,
  sendBlocked,
  sendBlockedReason,
  onRecoveryAction,
  recoveryActionLabel,
  taskId,
}: ChatInputProps) {
  const { currentMode } = useHarness(taskId || undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isComposingRef = useRef(false);
  const [isFocused, setIsFocused] = useState(false);
  const hasContent = input.trim().length > 0 || pendingAttachments.length > 0;

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
    <div className="pb-6 px-6 max-w-[900px] mx-auto w-full">
      <div className={cn(
        "relative flex flex-col bg-muted/20 backdrop-blur-3xl transition-all duration-500 rounded-[1.5rem] overflow-hidden border border-border/40",
        isFocused ? "shadow-2xl shadow-primary/5 ring-1 ring-primary/20 border-primary/30" : "shadow-md hover:border-border/60",
        isRunning ? "animate-pulse" : ""
      )}>
        {/* Extreme Minimalist Warning */}
        {sendBlocked && (
          <div className="px-6 py-3 flex items-center justify-between gap-3 bg-destructive/5 border-b border-destructive/10 animate-in fade-in slide-in-from-top-1 duration-300">
            <div className="flex items-center gap-2 text-destructive/80 font-bold text-[10px] tracking-tight uppercase">
              <AlertCircle size={14} />
              <span>{sendBlockedReason}</span>
            </div>
            {onRecoveryAction && (
              <button
                type="button"
                onClick={onRecoveryAction}
                className="px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-[0.2em] text-primary bg-primary/5 hover:bg-primary/10 transition-all border border-primary/20 transition-all"
              >
                {recoveryActionLabel}
              </button>
            )}
          </div>
        )}

        <AnimatePresence>
          {(pendingAttachments.length > 0 || (pinnedFiles && pinnedFiles.length > 0)) && (
            <div className="flex flex-wrap gap-2 px-6 pt-5 pb-1">
              {/* Pinned Files */}
              {pinnedFiles.map((path) => (
                <div key={`pinned-${path}`} className="relative group">
                  <div className="flex items-center gap-2 pl-2 pr-1 py-1 bg-primary/10 border border-primary/30 rounded-lg text-[10px] font-bold text-primary transition-all hover:bg-primary/20">
                    <Sparkles size={12} className="text-primary/60" />
                    <span className="max-w-[150px] truncate">{path.split("/").pop()}</span>
                    <button
                      onClick={() => removePinnedFile(path)}
                      className="p-1 rounded-md text-primary/40 hover:text-destructive transition-all"
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>
              ))}

              {/* Attachments */}
              {pendingAttachments.map((att) => (
                <div key={att.path} className="relative group">
                  {att.mime_type?.startsWith("image/") && att.data ? (
                    <div className="relative w-14 h-14 rounded-lg overflow-hidden border border-border/40 bg-muted/50">
                      <img
                        src={`data:${att.mime_type};base64,${att.data}`}
                        alt={att.name}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                      />
                      <button
                        onClick={() => removePendingAttachment(att.path)}
                        className="absolute top-0.5 right-0.5 p-1 rounded-full bg-destructive text-destructive-foreground shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 pl-2 pr-1 py-1 bg-muted/40 border border-border/40 rounded-lg text-[10px] font-bold text-foreground transition-all hover:bg-muted/60">
                      <FileText size={12} className="text-muted-foreground/40" />
                      <span className="max-w-[120px] truncate">{att.name}</span>
                      <button
                        onClick={() => removePendingAttachment(att.path)}
                        className="p-1 rounded-md text-muted-foreground/30 hover:text-destructive transition-all"
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
              e.target.style.height = `${Math.min(e.target.scrollHeight, 400)}px`;
            }}
            onCompositionStart={() => { isComposingRef.current = true; }}
            onCompositionEnd={() => { setTimeout(() => { isComposingRef.current = false; }, 50); }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || isComposingRef.current || e.keyCode === 229) return;
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (hasContent) void handleSend();
              }
            }}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder={placeholder}
            className="w-full bg-transparent border-none outline-none focus:ring-0 focus:outline-none text-[15px] font-medium leading-[1.6] py-5 px-6 resize-none min-h-[64px] max-h-[400px] text-foreground placeholder:text-muted-foreground/20 selection:bg-primary/20"
            rows={1}
          />

          {/* Integrated Action Bar - Refined */}
          <div className="flex items-center justify-between px-5 py-3 border-t border-white/[0.04] bg-white/[0.01]">
            <div className="flex items-center gap-4">
              <ChatInputMetadata 
                taskId={taskId}
                sendBlocked={sendBlocked}
                sendBlockedReason={sendBlockedReason}
              />
              <div className="h-4 w-[1px] bg-white/[0.08]" />
              <button
                onClick={onFileClick}
                className="text-muted-foreground/30 hover:text-primary transition-all p-2 rounded-xl hover:bg-primary/10 active:scale-90"
                title="Attach Files"
              >
                <Paperclip size={18} />
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  multiple
                  accept="image/*"
                  onChange={onFileChange}
                />
              </button>
            </div>

            <div className="flex items-center gap-3">
              {!isRunning ? (
                <button
                  disabled={!hasContent || sendBlocked}
                  onClick={handleSend}
                  className={cn(
                    "flex items-center justify-center w-10 min-w-[40px] h-10 rounded-2xl transition-all duration-500 active:scale-95 group/send inner-border",
                    hasContent && !sendBlocked
                      ? "bg-primary text-primary-foreground shadow-2xl shadow-primary/20 hover:scale-110"
                      : "bg-white/[0.03] text-muted-foreground/10 cursor-not-allowed border-transparent"
                  )}
                >
                  <SendHorizontal 
                    size={20} 
                    className={cn(
                      "transition-all duration-500", 
                      hasContent && !sendBlocked ? "translate-x-0.5 group-hover/send:rotate-12" : "scale-90 opacity-20"
                    )} 
                  />
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSend}
                    disabled={!hasContent}
                    className={cn(
                      "text-[10px] font-black tracking-[0.2em] px-5 py-2.5 rounded-2xl transition-all border active:scale-95 inner-border uppercase",
                      hasContent
                        ? "text-primary bg-primary/10 border-primary/20 hover:bg-primary/20"
                        : "text-muted-foreground/10 border-white/[0.04]"
                    )}
                  >
                    Continue
                  </button>
                  <button
                    onClick={handleStop}
                    className="w-10 h-10 flex items-center justify-center rounded-2xl bg-rose-500/10 text-rose-500 hover:bg-rose-500 hover:text-white transition-all active:scale-95 shadow-lg shadow-rose-500/10 inner-border"
                  >
                    <Square size={12} fill="currentColor" strokeWidth={0} />
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
