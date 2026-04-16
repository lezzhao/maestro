import { useState, useEffect, useRef, useCallback } from "react";
import { Search, File, X, Loader2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { useAppUiState, useWorkspaceStoreState } from "../hooks/use-app-store-selectors";
import { useAppStore } from "../stores/appStore";
import { useTranslation } from "../i18n";

interface SearchMatch {
  file: string;
  line: number;
  content: string;
}

export function GlobalSearch() {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchMatch[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const { activeWorkspaceId } = useAppUiState();
  const { togglePinnedFile } = useWorkspaceStoreState();
  const projectPath = useAppStore(state => state.workspaces.find(w => w.id === activeWorkspaceId)?.workingDirectory);
  
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const performSearch = useCallback(async (q: string) => {
    if (!q.trim() || !projectPath) {
      setResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const matches = await invoke<SearchMatch[]>("project_find_symbols", {
        projectPath,
        query: q
      });
      setResults(matches);
    } catch (e) {
      console.error("Search failed:", e);
      toast.error(`Search failed: ${String(e)}`);
    } finally {
      setIsSearching(false);
    }
  }, [projectPath]);

  useEffect(() => {
    if (searchTimeout.current !== null) {
      clearTimeout(searchTimeout.current);
    }
    if (!query) {
      setResults([]);
      return;
    }
    searchTimeout.current = setTimeout(() => {
      performSearch(query);
    }, 300);
    return () => {
      if (searchTimeout.current !== null) {
        clearTimeout(searchTimeout.current);
      }
    };
  }, [query, performSearch]);

  if (!activeWorkspaceId) return null;

  return (
    <div className="px-4 mb-4">
      <div className="relative group">
        <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-muted-foreground/20 group-focus-within:text-primary/50 transition-colors">
          <Search size={14} />
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!isOpen) setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder={t("search_placeholder")}
          className="w-full h-10 pl-9 pr-12 bg-muted/10 border border-border/5 rounded-xl text-[12px] font-bold focus:outline-none focus:ring-2 focus:ring-primary/10 focus:bg-background focus:border-primary/20 transition-all placeholder:text-muted-foreground/20"
        />
        <div className="absolute inset-y-0 right-3 flex items-center gap-1.5 pointer-events-none">
          {!query && (
            <kbd className="hidden sm:flex h-5 select-none items-center gap-1 rounded border border-border/20 bg-muted/20 px-1.5 font-mono text-[10px] font-bold text-muted-foreground/30 opacity-100">
              <span className="text-[10px]">⌘</span>K
            </kbd>
          )}
        </div>
        {query && (
          <button 
            onClick={() => { setQuery(""); setResults([]); }}
            className="absolute inset-y-0 right-2 flex items-center text-muted-foreground/40 hover:text-foreground"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {isOpen && query && (
        <div className="mt-2 max-h-[360px] bg-glass-surface border border-border shadow-2xl rounded-2xl overflow-hidden z-dropdown animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="px-4 py-3 border-b border-border/10 bg-muted/40 flex justify-between items-center">
            <span className="text-[10px] font-black uppercase text-muted-foreground/40 tracking-[0.2em] px-1">
              {isSearching ? t("searching") : t("search_results_count", { n: results.length })}
            </span>
            {isSearching && <Loader2 size={12} className="animate-spin text-primary/60" />}
          </div>
          
          <div className="overflow-y-auto max-h-[260px] p-2 no-scrollbar space-y-1">
            {results.length > 0 ? (
              results.map((res, idx) => (
                <button
                  key={`${res.file}-${res.line}-${idx}`}
                  className="w-full p-3 flex flex-col items-start gap-1.5 hover:bg-primary/5 rounded-xl transition-all group/item active:scale-[0.98]"
                  onClick={() => {
                    togglePinnedFile(res.file);
                    toast.success(t("file_pinned", { file: res.file }));
                    setIsOpen(false);
                  }}
                >
                  <div className="flex items-center gap-2 w-full">
                    <File size={14} className="text-primary/20 group-hover/item:text-primary/40 transition-colors" />
                    <span className="text-[13px] font-bold text-foreground/80 truncate flex-1 text-left tracking-tight group-hover/item:text-primary transition-colors">{res.file}</span>
                    <span className="text-[10px] text-muted-foreground/30 font-mono px-1.5 py-0.5 rounded bg-muted/20">L{res.line}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground/50 font-mono truncate w-full text-left bg-muted/10 px-3 py-2 rounded-lg border border-border/5 group-hover/item:border-primary/10 transition-colors">
                    {res.content}
                  </div>
                </button>
              ))
            ) : !isSearching && (
              <div className="py-12 text-center text-muted-foreground/20 text-[12px] font-bold tracking-tight">
                {t("no_results_found")}
              </div>
            )}
          </div>
          
          <div className="p-3 border-t border-border/10 bg-muted/20 flex items-center gap-6 justify-center">
            <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground/40 uppercase tracking-widest">
              <kbd className="px-2 py-0.5 rounded-md bg-background border border-border/20 shadow-sm font-mono text-[9px]">↑↓</kbd> <span>Select</span>
            </div>
            <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground/40 uppercase tracking-widest">
              <kbd className="px-2 py-0.5 rounded-md bg-background border border-border/20 shadow-sm font-mono text-[9px]">↵</kbd> <span>Open</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
