import { memo, Suspense, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { decodeTransportEscapes, normalizeTerminalChunk } from "../lib/utils/terminal";
import { cn } from "../lib/utils";

type Props = {
  content: string;
  isStreaming?: boolean;
  className?: string;
};

import { MarkdownCodeBlock as LazyMarkdownCodeBlock } from "./MarkdownCodeBlock";

export const ChatMessageContent = memo(function ChatMessageContent({
  content,
  isStreaming = false,
  className = "",
}: Props) {
  const cleaned = useMemo(() => {
    let out = content;
    
    // Performance: If streaming extremely long output, only clean the relevant "window"
    // to avoid O(N^2) processing of the whole buffer every 60ms.
    const isVeryLong = isStreaming && content.length > 8000;
    if (isVeryLong) {
      // Keep a large enough window to preserve context but small enough to be fast
      out = "..." + out.substring(out.length - 5000);
    }

    out = decodeTransportEscapes(out);
    out = normalizeTerminalChunk(out);
    return out.trim();
  }, [content, isStreaming]);

  const isTerminalLike = useMemo(() => {
    // If it has boxed characters or multiple carriage returns/ANSI escapes initially
    return content.includes("\u001b") || content.includes("\r");
  }, [content]);

  if (!cleaned) {
    // Fallback if cleaning stripped everything but the original had content
    if (content.trim()) {
      return (
        <pre className={cn(
          "text-[12px] leading-tight whitespace-pre-wrap font-mono opacity-60 w-full",
          className
        )}>
          {content.substring(0, 1000)}
        </pre>
      );
    }
    return null;
  }

  if (isStreaming) {
    return (
      <div className={cn(
        "text-[13px] leading-relaxed whitespace-pre-wrap font-mono w-full",
        isTerminalLike ? "bg-black/5 dark:bg-white/5 p-2 rounded-md border border-black/5" : "opacity-90",
        className
      )}>
        {cleaned}
      </div>
    );
  }

  const components: Components = {
    code({ className: codeClassName, children, ...props }) {
      const match = /language-(\w+)/.exec(codeClassName || "");
      const code = String(children).replace(/\n$/, "");
      return match ? (
        <Suspense
          fallback={<pre className="whitespace-pre-wrap overflow-x-auto bg-bg-base/50 p-2 rounded">{code}</pre>}
        >
          <LazyMarkdownCodeBlock language={match[1]} code={code} />
        </Suspense>
      ) : (
        <code className="bg-bg-base/50 px-1 rounded text-[12px]" {...props}>
          {children}
        </code>
      );
    },
  };

  return (
    <div className={cn("chat-markdown text-[14px] leading-relaxed", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {cleaned}
      </ReactMarkdown>
    </div>
  );
});
