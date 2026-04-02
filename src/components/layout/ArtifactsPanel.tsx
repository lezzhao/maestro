import { memo, useState, useEffect } from "react";
import { X, Code, Eye, Sparkles, Check, Copy } from "lucide-react";
import { useAppStore } from "../../stores/appStore";
import { useAppUiState } from "../../hooks/use-app-store-selectors";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism-async-light";
import oneDark from "react-syntax-highlighter/dist/esm/styles/prism/one-dark";

export const ArtifactsPanel = memo(function ArtifactsPanel() {
  const { activeArtifact, setActiveArtifact } = useAppStore();
  const { theme } = useAppUiState();
  const [view, setView] = useState<"preview" | "code">("preview");
  const [copied, setCopied] = useState(false);

  // Reset to preview when artifact changes
  useEffect(() => {
    setView("preview");
  }, [activeArtifact?.code]);

  if (!activeArtifact) return null;

  const isHtml = activeArtifact.language === "html" || activeArtifact.code.trim().startsWith("<!DOCTYPE html>") || activeArtifact.code.trim().startsWith("<html");
  const isSvg = activeArtifact.language === "svg" || activeArtifact.code.trim().startsWith("<svg");
  const isMermaid = activeArtifact.language === "mermaid";

  const handleCopy = () => {
    navigator.clipboard.writeText(activeArtifact.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const renderContent = () => {
    if (view === "code") {
      return (
        <div className="h-full overflow-auto bg-bg-base/30 relative custom-scrollbar">
          <SyntaxHighlighter
            style={oneDark}
            language={activeArtifact.language || "text"}
            PreTag="div"
            customStyle={{
              margin: 0,
              padding: "24px",
              backgroundColor: "transparent",
              fontSize: "12px",
              lineHeight: "1.6",
              minHeight: "100%",
            }}
          >
            {activeArtifact.code}
          </SyntaxHighlighter>
        </div>
      );
    }

    if (isHtml || isSvg) {
      const srcDoc = isSvg 
        ? `<html><body style="margin:0;display:flex;justify-content:center;align-items:center;height:100vh;background:transparent;">${activeArtifact.code}</body></html>`
        : activeArtifact.code;

      return (
        <iframe
          title="Artifact Preview"
          srcDoc={srcDoc}
          className="w-full h-full border-none bg-white rounded-lg shadow-inner"
          sandbox="allow-scripts"
        />
      );
    }

    if (isMermaid) {
       const mermaidHtml = `
       <!DOCTYPE html>
       <html>
       <head>
          <script type="module">
            import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';
            mermaid.initialize({ startOnLoad: true, theme: '${theme === 'dark' ? 'dark' : 'default'}' });
          </script>
          <style>
            body { margin: 0; display: flex; justify-content: center; padding: 20px; background: transparent; }
            .mermaid { width: 100%; }
          </style>
       </head>
       <body>
         <div class="mermaid">
           ${activeArtifact.code}
         </div>
       </body>
       </html>
       `;

       return (
          <iframe
            title="Mermaid Preview"
            srcDoc={mermaidHtml}
            className="w-full h-full border-none bg-transparent"
            sandbox="allow-scripts"
          />
       );
    }

    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center text-text-muted/60 lowercase italic text-xs">
        No preview available for {activeArtifact.language}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-bg-surface border-l border-border-muted/30 overflow-hidden animate-in slide-in-from-right duration-300 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-bg-elevated/50 border-b border-border-muted/20">
        <div className="flex items-center gap-3">
          <div className="flex p-1 bg-bg-base/50 rounded-xl border border-border-muted/10 shadow-inner">
            <button
              onClick={() => setView("preview")}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all duration-200",
                view === "preview" ? "bg-primary text-white shadow-lg shadow-primary/30" : "text-text-muted hover:text-text-main"
              )}
            >
              <Eye size={12} />
              Preview
            </button>
            <button
              onClick={() => setView("code")}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all duration-200",
                view === "code" ? "bg-primary text-white shadow-lg shadow-primary/30" : "text-text-muted hover:text-text-main"
              )}
            >
              <Code size={12} />
              Code
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button 
            onClick={handleCopy}
            className="h-8 px-3 rounded-lg flex items-center gap-2 text-[10px] font-bold uppercase tracking-tighter text-text-muted hover:text-primary hover:bg-primary/5 transition-all"
          >
            {copied ? <Check size={12} className="text-success-500" /> : <Copy size={12} />}
            {copied ? "Copied" : "Copy"}
          </button>
          <div className="w-px h-4 bg-border-muted/10 mx-1" />
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-8 w-8 text-text-muted hover:text-danger-500 hover:bg-danger-500/10 rounded-lg transition-all"
            onClick={() => setActiveArtifact(null)}
          >
            <X size={16} />
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className={cn(
        "flex-1 min-h-0 relative",
        view === "preview" && (isHtml || isSvg || isMermaid) ? "bg-bg-base/20" : "bg-bg-base/10"
      )}>
        {renderContent()}
      </div>

      {/* Footer Info */}
      <div className="px-5 py-3 bg-bg-elevated/30 border-t border-border-muted/10 flex justify-between items-center group/footer">
        <div className="flex items-center gap-2">
            <Sparkles size={10} className="text-primary animate-pulse" />
            <span className="text-[10px] font-black uppercase text-text-muted/50 tracking-[0.2em] italic group-hover/footer:text-primary/70 transition-colors">
            Artifact &bull; {activeArtifact.language || 'dynamic'}
            </span>
        </div>
        <div className="flex items-center gap-4">
            <span className="text-[9px] font-mono text-text-muted/30">
            {activeArtifact.code.length} bytes
            </span>
            <button className="text-[9px] font-bold text-primary/40 hover:text-primary transition-colors uppercase tracking-widest">
                Download
            </button>
        </div>
      </div>
    </div>
  );
});
