import { X } from "lucide-react";
import { cn } from "../lib/utils";
import { useTranslation } from "../i18n";

interface DiffDialogProps {
  open: boolean;
  onClose: () => void;
  filePath: string;
  diffContent: string;
}

export function DiffDialog({ open, onClose, filePath, diffContent }: DiffDialogProps) {
  const { t } = useTranslation();

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200 p-8">
      <div className="w-full max-w-4xl h-[85vh] flex flex-col bg-bg-surface border border-border-muted/20 rounded-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-muted/10 bg-bg-elevated/30">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-bold text-text-main truncate">
              {t("changes") || "Diff Preview"}
            </h2>
            <div className="px-2 py-0.5 rounded-sm bg-bg-base text-[11px] font-mono text-text-muted border border-border-muted/10">
              {filePath}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-rose-500 hover:bg-rose-500/10 p-1.5 rounded-sm transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto custom-scrollbar p-0 bg-bg-elevated/40 text-white selection:bg-primary-500/30">
          {diffContent ? (
            <div className="font-mono text-[11px] leading-relaxed p-4 whitespace-pre-wrap select-text break-all">
              {diffContent.split('\n').map((line, idx) => {
                const isAdded = line.startsWith('+') && !line.startsWith('+++');
                const isRemoved = line.startsWith('-') && !line.startsWith('---');
                const isHeader = line.startsWith('@@') || line.startsWith('diff') || line.startsWith('---') || line.startsWith('+++');
                
                return (
                  <div 
                    key={idx} 
                    className={cn(
                      "group flex hover:bg-white/5 transition-colors pl-4 -ml-4",
                      isAdded ? "text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20" :
                      isRemoved ? "text-rose-400 bg-rose-500/10 hover:bg-rose-500/20" :
                      isHeader ? "text-blue-400 opacity-60 bg-blue-500/5 mt-4 first:mt-0" : "text-white/80"
                    )}
                  >
                    <span className="select-none w-8 text-right pr-4 opacity-30 group-hover:opacity-50 inline-block font-mono text-[10px]">{idx + 1}</span>
                    <span className="flex-1">{line}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="h-full flex items-center justify-center">
              <span className="text-white/40 italic text-sm">No diff content available</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
