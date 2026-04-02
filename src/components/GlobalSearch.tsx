import { useState, useEffect, useRef, useCallback } from "react";
import { Search, File, X, Loader2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useAppUiState } from "../hooks/use-app-store-selectors";
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
    <div className="px-3 mb-4">
      <div className="relative group">
        <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-text-muted/40 group-focus-within:text-primary transition-colors">
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
          className="w-full h-9 pl-9 pr-8 bg-bg-base/40 border border-border-muted/20 rounded-xl text-[12px] focus:outline-none focus:ring-1 focus:ring-primary/30 focus:bg-bg-base/60 transition-all placeholder:text-text-muted/30"
        />
        {query && (
          <button 
            onClick={() => { setQuery(""); setResults([]); }}
            className="absolute inset-y-0 right-2 flex items-center text-text-muted/40 hover:text-text-main"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {isOpen && query && (
        <div className="mt-2 max-h-[300px] bg-bg-surface border border-border-muted/30 rounded-xl shadow-2xl overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="p-2 border-b border-border-muted/10 bg-bg-base/20 flex justify-between items-center">
            <span className="text-[9px] font-black uppercase text-text-muted/50 tracking-widest pl-1">
              {isSearching ? t("searching") : t("search_results_count", { n: results.length })}
            </span>
            {isSearching && <Loader2 size={10} className="animate-spin text-primary" />}
          </div>
          
          <div className="overflow-y-auto max-h-[250px] p-1">
            {results.length > 0 ? (
              results.map((res, idx) => (
                <button
                  key={`${res.file}-${res.line}-${idx}`}
                  className="w-full p-2 flex flex-col items-start gap-1 hover:bg-primary/5 rounded-lg transition-colors group/item"
                  onClick={() => {
                    // TODO: Trigger file open/jump
                    setIsOpen(false);
                  }}
                >
                  <div className="flex items-center gap-2 w-full">
                    <File size={12} className="text-text-muted/40" />
                    <span className="text-[11px] font-bold text-text-main truncate flex-1 text-left">{res.file}</span>
                    <span className="text-[10px] text-text-muted/30 font-mono">L{res.line}</span>
                  </div>
                  <div className="text-[10px] text-text-muted/60 font-mono truncate w-full text-left bg-bg-base/30 px-1.5 py-0.5 rounded border border-border-muted/5 group-hover/item:border-primary/20">
                    {res.content}
                  </div>
                </button>
              ))
            ) : !isSearching && (
              <div className="py-8 text-center text-text-muted/30 text-[11px] italic">
                {t("no_results_found")}
              </div>
            )}
          </div>
          
          <div className="p-2 border-t border-border-muted/10 bg-bg-base/10 flex items-center gap-3 justify-center">
            <div className="flex items-center gap-1 text-[9px] text-text-muted/40">
              <kbd className="px-1 rounded bg-bg-base border border-border-muted/20 font-mono">↑↓</kbd> {t("search_select")}
            </div>
            <div className="flex items-center gap-1 text-[9px] text-text-muted/40">
              <kbd className="px-1 rounded bg-bg-base border border-border-muted/20 font-mono">↵</kbd> {t("search_navigate")}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
