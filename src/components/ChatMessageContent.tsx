import { lazy, memo, Suspense, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { decodeTransportEscapes, normalizeTerminalChunk } from "../lib/utils/terminal";
import { cn } from "../lib/utils";
import { ThinkingBlock } from "./chat/ThinkingBlock";

type Props = {
  taskId: string | null;
  actualContent: string;
  isStreaming?: boolean;
  className?: string;
};

const LazyMarkdownCodeBlock = lazy(async () => {
  const mod = await import("./MarkdownCodeBlock");
  return { default: mod.MarkdownCodeBlock };
});

export const ChatMessageContent = memo(function ChatMessageContent({
  taskId,
  actualContent,
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

  if (!processedContent) return null;
  const components: Components = {
    code({ className: codeClassName, children, ...props }) {
      const match = /language-(\w+)/.exec(codeClassName || "");
      const code = String(children).replace(/\n$/, "");
      return match ? (
        <Suspense
          fallback={
            <div className="my-4 border border-primary/20 bg-primary/[0.02] p-4 animate-pulse min-h-[100px] flex flex-col gap-2 rounded">
              <div className="h-1.5 w-32 bg-primary/20 rounded-none" />
              <div className="h-1.5 w-full bg-primary/10 rounded-none" />
              <div className="h-1.5 w-2/3 bg-primary/10 rounded-none" />
            </div>
          }
        >
          <LazyMarkdownCodeBlock language={match[1]} code={code} taskId={taskId} />
        </Suspense>
      ) : (
        <code className="bg-primary/[0.04] text-primary/80 font-mono text-[12px] px-1.5 py-0.5 rounded-md border border-primary/20" {...props}>
          {children}
        </code>
      );
    },
  };

  return (
    <div className={cn("chat-markdown w-full flex flex-col gap-1", className)}>
      {processedContent && (
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {processedContent}
        </ReactMarkdown>
      )}
    </div>
  );
});
