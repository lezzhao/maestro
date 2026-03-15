import { useState } from "react";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism-async-light";
import oneDark from "react-syntax-highlighter/dist/esm/styles/prism/one-dark";
import { Clipboard, Check } from "lucide-react";
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
    <div className="group relative my-3 rounded-xl border border-border-muted/30 bg-[#1e1e1e] shadow-md overflow-hidden transition-all hover:border-border-muted/50">
      <div className="flex items-center justify-between px-4 py-2 bg-bg-base/40 border-b border-border-muted/20 backdrop-blur-sm">
        <span className="text-[10px] font-bold text-text-muted/80 uppercase tracking-widest">{language}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] text-text-muted hover:text-primary-400 hover:bg-primary-500/10 transition-all font-medium"
        >
          {copied ? (
            <>
              <Check size={12} className="text-success-500" />
              <span>COPIED</span>
            </>
          ) : (
            <>
              <Clipboard size={12} />
              <span>COPY</span>
            </>
          )}
        </button>
      </div>
      <SyntaxHighlighter
        style={oneDark}
        language={language}
        PreTag="div"
        customStyle={{
          margin: 0,
          padding: "16px",
          backgroundColor: "transparent",
          fontSize: "12.5px",
          lineHeight: "1.6",
        }}
        codeTagProps={{ style: { fontFamily: "JetBrains Mono, Fira Code, monospace" } }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}
