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
    <div className={cn("chat-markdown w-full flex flex-col", className)}>
      {thinking && (
        <ThinkingBlock 
          content={thinking} 
          isStreaming={isStreaming && !actualContent}
          label="Inference Logic"
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
