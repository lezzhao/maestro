import { memo, useRef, useState, useCallback, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { 
  SendHorizontal, 
  Square, 
  X, 
  Paperclip, 
  AlertCircle, 
  FileText, 
  Sparkles, 
  Terminal, 
  Wand2, 
  TestTube,
  Trash2,
  Plus
} from "lucide-react";
import { cn } from "../../lib/utils";
import type { ChatAttachment } from "../../types";
import { useHarness } from "../../hooks/useHarness";
import { ChatInputMetadata } from "./ChatInputMetadata";
import { Button } from "../ui/button";
import { useTaskActions } from "../../hooks/useTaskActions";

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

const SLASH_COMMANDS = [
  { id: "fix", label: "Fix", icon: Wand2, description: "Suggest fixes for current task/diff", prompt: "Please analyze the current state and suggest any necessary fixes or refinements." },
  { id: "test", label: "Test", icon: TestTube, description: "Generate tests for current progress", prompt: "Write comprehensive unit tests for the changes implemented so far." },
  { id: "refactor", label: "Refactor", icon: Sparkles, description: "Optimize and clean up code", prompt: "Refactor the current implementation for better readability, performance, and best practices." },
  { id: "clear", label: "Clear", icon: Trash2, description: "Clear flow history (local session)", action: "clear" },
];

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
  const { handleClearHistory } = useTaskActions();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isComposingRef = useRef(false);
  const [isFocused, setIsFocused] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const hasContent = input.trim().length > 0 || pendingAttachments.length > 0;

  const handleFiles = useCallback(async (files: FileList) => {
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
  }, [addPendingAttachments]);

  const onFileClick = () => {
    fileInputRef.current?.click();
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      await handleFiles(e.target.files);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      await handleFiles(e.dataTransfer.files);
    }
  };

  const handleSlashCommandSelect = (cmd: typeof SLASH_COMMANDS[0]) => {
    if (cmd.action === "clear") {
      if (taskId) handleClearHistory(taskId);
      setInput("");
    } else if (cmd.prompt) {
      setInput(cmd.prompt);
    }
    setShowSlashMenu(false);
  };

  useEffect(() => {
    if (input === "/") {
      setShowSlashMenu(true);
      setSelectedIndex(0);
    } else if (!input.startsWith("/")) {
      setShowSlashMenu(false);
    }
  }, [input]);

  return (
    <div className="pb-6 px-6 max-w-[900px] mx-auto w-full animate-in fade-in slide-in-from-bottom-2 duration-700">
      <div 
        className={cn(
          "relative flex flex-col bg-card/40 backdrop-blur-3xl border border-border/80 shadow-md transition-all duration-300 rounded-[20px] overflow-hidden inner-border",
          isFocused && "ring-2 ring-primary/10 border-primary/30 shadow-lg bg-card/60",
          isDragging && "ring-4 ring-primary/20 border-primary scale-[1.005] bg-primary/[0.02] shadow-vibe"
        )}
        onDragOver={onDragOver}
        onDragEnter={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {isDragging && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-primary/10 backdrop-blur-[2px] pointer-events-none">
            <div className="flex flex-col items-center gap-3 animate-bounce">
              <Plus size={48} className="text-primary" />
              <span className="text-sm font-black uppercase tracking-widest text-primary">Drop to attach context</span>
            </div>
          </div>
        )}

        <AnimatePresence>
          {showSlashMenu && (
            <motion.div 
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className="absolute bottom-full left-4 mb-3 w-[280px] bg-background border border-border rounded-xl shadow-2xl overflow-hidden z-50 p-1.5"
            >
              <div className="px-3 py-2 border-b border-border/10 mb-1">
                <span className="text-[10px] font-black uppercase text-muted-foreground/40 tracking-[0.2em]">Quick Commands</span>
              </div>
              <div className="space-y-0.5">
                {SLASH_COMMANDS.map((cmd, idx) => (
                  <button
                    key={cmd.id}
                    onClick={() => handleSlashCommandSelect(cmd)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all text-left",
                      idx === selectedIndex ? "bg-primary text-white" : "hover:bg-secondary text-text-muted"
                    )}
                  >
                    <cmd.icon size={14} className={idx === selectedIndex ? "text-white" : "text-primary"} />
                    <div className="flex flex-col flex-1 overflow-hidden">
                      <span className="text-[12px] font-bold leading-tight uppercase tracking-wider">{cmd.label}</span>
                      <span className={cn(
                        "text-[10px] truncate leading-none mt-1",
                        idx === selectedIndex ? "text-white/70" : "text-muted-foreground/50"
                      )}>{cmd.description}</span>
                    </div>
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Warning Belt */}
        {sendBlocked && (
          <div className="px-5 py-2.5 flex items-center justify-between gap-3 bg-destructive/5 border-b border-destructive/10 animate-in fade-in slide-in-from-top-1 px-5 py-2.5">
            <div className="flex items-center gap-2 text-destructive font-bold text-[11px] uppercase tracking-widest">
              <AlertCircle size={14} />
              <span>{sendBlockedReason}</span>
            </div>
            {onRecoveryAction && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onRecoveryAction}
                className="h-7 px-3 text-[10px] uppercase font-black text-destructive hover:bg-destructive/10 tracking-widest"
              >
                {recoveryActionLabel}
              </Button>
            )}
          </div>
        )}

        <AnimatePresence>
          {(pendingAttachments.length > 0 || (pinnedFiles && pinnedFiles.length > 0)) && (
            <div className="flex flex-wrap gap-2 px-5 pt-4 pb-0">
              {/* Pinned Files */}
              {pinnedFiles.map((path) => (
                <div key={`pinned-${path}`} className="relative group">
                  <div className="flex items-center gap-2 pl-2.5 pr-1.5 py-1 bg-primary/5 border border-primary/20 rounded-lg text-[11px] font-bold text-primary transition-all hover:bg-primary/10">
                    <Sparkles size={12} className="opacity-60" />
                    <span className="max-w-[150px] truncate uppercase tracking-tighter">{path.split("/").pop()}</span>
                    <button
                      onClick={() => removePinnedFile(path)}
                      className="p-1 rounded-md hover:bg-primary/20 transition-colors"
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
                    <div className="relative w-12 h-12 rounded-lg overflow-hidden border border-border bg-muted/30 group-hover:border-primary/40 transition-all">
                      <img
                        src={`data:${att.mime_type};base64,${att.data}`}
                        alt={att.name}
                        className="w-full h-full object-cover transition-transform group-hover:scale-105"
                      />
                      <button
                        onClick={() => removePendingAttachment(att.path)}
                        className="absolute top-0.5 right-0.5 p-1 rounded-full bg-destructive text-destructive-foreground shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 pl-2.5 pr-1.5 py-1 bg-secondary border border-border rounded-lg text-[11px] font-bold text-foreground transition-all hover:border-primary/20">
                      <FileText size={12} className="text-primary/60" />
                      <span className="max-w-[120px] truncate uppercase tracking-tighter">{att.name}</span>
                      <button
                        onClick={() => removePendingAttachment(att.path)}
                        className="p-1 rounded-md hover:bg-muted-foreground/10 transition-colors"
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
        <div className="relative flex flex-col p-0.5">
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
              
              if (showSlashMenu) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSelectedIndex(s => (s + 1) % SLASH_COMMANDS.length);
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSelectedIndex(s => (s - 1 + SLASH_COMMANDS.length) % SLASH_COMMANDS.length);
                } else if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  handleSlashCommandSelect(SLASH_COMMANDS[selectedIndex]);
                } else if (e.key === "Escape") {
                  setShowSlashMenu(false);
                }
                return;
              }

              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (hasContent) void handleSend();
              }
            }}
            onFocus={() => setIsFocused(true)}
            onBlur={() => {
              setIsFocused(false);
              // Small timeout to allow click on slash menu
              setTimeout(() => setShowSlashMenu(false), 200);
            }}
            placeholder={placeholder}
            className="w-full bg-transparent border-none outline-none focus:ring-0 focus:outline-none text-[14px] leading-relaxed py-4 px-5 resize-none min-h-[56px] max-h-[400px] text-foreground placeholder:text-muted-foreground/30 selection:bg-primary/20 font-medium"
            rows={1}
          />

          {/* Action Bar */}
          <div className="flex items-center justify-between px-4 py-1.5 bg-secondary/15 border-t border-border/20 backdrop-blur-md">
            <div className="flex items-center gap-2">
              <button
                onClick={onFileClick}
                className="text-muted-foreground/40 hover:text-primary transition-colors p-2 rounded-lg hover:bg-primary/5 active:scale-95 group/attach"
                title="Attach Files"
              >
                <Paperclip size={16} className="transition-transform group-hover:rotate-12" />
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  multiple
                  accept="image/*"
                  onChange={onFileChange}
                />
              </button>
              
              <div className="h-4 w-px bg-border/20" />
              
              <ChatInputMetadata 
                taskId={taskId}
                sendBlocked={sendBlocked}
                sendBlockedReason={sendBlockedReason}
              />
            </div>

            <div className="flex items-center gap-3">
              {!isRunning ? (
                <Button
                  size="icon"
                  disabled={!hasContent || sendBlocked}
                  onClick={handleSend}
                  className={cn(
                    "w-10 h-10 rounded-xl transition-all active:scale-90",
                    hasContent && !sendBlocked ? "shadow-lg shadow-primary/20 bg-primary hover:bg-primary/90" : "opacity-20 grayscale"
                  )}
                >
                  <SendHorizontal size={18} className="text-white" />
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSend}
                    disabled={!hasContent}
                    className="h-8 rounded-lg text-[10px] font-black uppercase tracking-widest border-primary/20 text-primary hover:bg-primary/5"
                  >
                    Continue
                  </Button>
                  <Button
                    variant="destructive"
                    size="icon"
                    onClick={handleStop}
                    className="w-9 h-9 rounded-xl shadow-lg shadow-destructive/10 active:scale-90"
                  >
                    <Square size={12} fill="currentColor" strokeWidth={0} />
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="mt-2 px-2 flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-muted-foreground/30">
              <Terminal size={10} />
              <span>Type / for commands</span>
          </div>
          <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-muted-foreground/30">
              <Plus size={10} />
              <span>Drag files to attach</span>
          </div>
      </div>
    </div>
  );
});
