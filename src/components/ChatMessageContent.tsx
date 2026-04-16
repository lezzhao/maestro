import { lazy, memo, Suspense, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { decodeTransportEscapes, normalizeTerminalChunk } from "../lib/utils/terminal";
import { cn } from "../lib/utils";
import { ThinkingBlock } from "./chat/ThinkingBlock";

type Props = {
  actualContent: string;
  thinking?: string;
  isStreaming?: boolean;
  className?: string;
};

const LazyMarkdownCodeBlock = lazy(async () => {
  const mod = await import("./MarkdownCodeBlock");
  return { default: mod.MarkdownCodeBlock };
});

export const ChatMessageContent = memo(function ChatMessageContent({
  actualContent,
  thinking,
  isStreaming = false,
  className = "",
}: Props) {
  const processedContent = useMemo(() => {
    if (!actualContent) return "";
    let out = actualContent;
    const isVeryLong = isStreaming && out.length > 8000;
    if (isVeryLong) {
      out = "..." + out.substring(out.length - 5000);
    }
    out = decodeTransportEscapes(out);
    out = normalizeTerminalChunk(out);
    return out;
  }, [actualContent, isStreaming]);

  if (!processedContent && !thinking) return null;
  const components: Components = {
    code({ className: codeClassName, children, ...props }) {
      const match = /language-(\w+)/.exec(codeClassName || "");
      const code = String(children).replace(/\n$/, "");
      return match ? (
        <Suspense
          fallback={
            <div className="my-6 glass-surface-low p-6 animate-pulse min-h-[100px] flex flex-col gap-3 rounded-[1.5rem]">
              <div className="h-2 w-24 bg-white/10 rounded-full" />
              <div className="h-2 w-full bg-white/5 rounded-full" />
              <div className="h-2 w-3/4 bg-white/5 rounded-full" />
            </div>
          }
        >
          <LazyMarkdownCodeBlock language={match[1]} code={code} />
        </Suspense>
      ) : (
        <code className="bg-muted/60 text-primary font-mono text-[13px] px-1.5 py-0.5 rounded-md border border-border/40" {...props}>
          {children}
        </code>
      );
    },
  };

  return (
    <div className={cn("chat-markdown w-full flex flex-col gap-5", className)}>
      {thinking && (
        <ThinkingBlock 
          content={thinking} 
          isStreaming={isStreaming && !actualContent}
        />
      )}
      {processedContent && (
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {processedContent}
        </ReactMarkdown>
      )}
    </div>
  );
});
