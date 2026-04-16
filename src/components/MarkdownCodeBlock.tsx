import { useState } from "react";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism-async-light";
import oneDark from "react-syntax-highlighter/dist/esm/styles/prism/one-dark";
import { Clipboard, Check, Eye } from "lucide-react";
import { useAppStore } from "../stores/appStore";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import markdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import rust from "react-syntax-highlighter/dist/esm/languages/prism/rust";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx";

type Props = {
  language: string;
  code: string;
};

SyntaxHighlighter.registerLanguage("bash", bash);
SyntaxHighlighter.registerLanguage("javascript", javascript);
SyntaxHighlighter.registerLanguage("json", json);
SyntaxHighlighter.registerLanguage("markdown", markdown);
SyntaxHighlighter.registerLanguage("python", python);
SyntaxHighlighter.registerLanguage("rust", rust);
SyntaxHighlighter.registerLanguage("typescript", typescript);
SyntaxHighlighter.registerLanguage("tsx", tsx);

export function MarkdownCodeBlock({ language, code }: Props) {
  const [copied, setCopied] = useState(false);
  const setActiveArtifact = useAppStore(state => state.setActiveArtifact);

  const previewableLanguages = ["html", "svg", "mermaid", "tsx", "jsx", "javascript", "typescript"];
  const isPreviewable = previewableLanguages.includes(language.toLowerCase());

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="group relative my-6 rounded-2xl border border-white/[0.04] bg-[#0A0A0B]/80 shadow-lg overflow-hidden transition-all duration-300 hover:border-primary/30 inner-border">
      <div className="flex items-center justify-between px-6 py-3 bg-white/[0.02] border-b border-white/[0.02] backdrop-blur-md">
        <span className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-[0.2em]">{language}</span>
        <div className="flex items-center gap-3">
          {isPreviewable && (
            <button
              onClick={() => setActiveArtifact({ code, language, title: `Preview: ${language}` })}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] text-primary bg-primary/5 hover:bg-primary/10 border border-primary/20 transition-all font-bold tracking-wider"
            >
              <Eye size={14} />
              PREVIEW
            </button>
          )}
          <button
            onClick={handleCopy}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] text-muted-foreground hover:text-foreground hover:bg-muted transition-all font-bold tracking-wider"
          >
            {copied ? (
              <>
                <Check size={14} className="text-primary" />
                <span>COPIED</span>
              </>
            ) : (
              <>
                <Clipboard size={14} />
                <span>COPY</span>
              </>
            )}
          </button>
        </div>
      </div>
      <SyntaxHighlighter
        style={oneDark}
        language={language}
        PreTag="div"
        customStyle={{
          margin: 0,
          padding: "24px",
          backgroundColor: "transparent",
          fontSize: "13px",
          lineHeight: "1.7",
          fontFamily: "var(--font-mono)",
        }}
        codeTagProps={{
          style: {
            fontFamily: "var(--font-mono)",
            background: "transparent",
          }
        }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}
