import { useEffect, useMemo, useState, type ComponentType } from "react";
import { Command } from "cmdk";
import {
  Braces,
  FolderOpen,
  PlayCircle,
  Settings2,
  Search,
  GitCompare,
} from "lucide-react";
import { cn } from "../lib/utils";

type CommandAction = {
  id: string;
  title: string;
  subtitle?: string;
  icon?: ComponentType<{ size?: number; className?: string }>;
  keywords?: string;
  run: () => void;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: CommandAction[];
};

export function CommandPalette({ open, onOpenChange, actions }: Props) {
  const [query, setQuery] = useState("");

  const grouped = useMemo(() => {
    const ui = actions.filter((a) => a.id.startsWith("ui."));
    const project = actions.filter((a) => a.id.startsWith("project."));
    const run = actions.filter((a) => a.id.startsWith("run."));
    return { ui, project, run };
  }, [actions]);

  useEffect(() => {
    if (!open) {
      setQuery("");
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[300] flex items-start justify-center pt-[14vh]">
      <button
        type="button"
        className="absolute inset-0 bg-black/35 backdrop-blur-[2px]"
        aria-label="Close command palette"
        onClick={() => onOpenChange(false)}
      />
      <div className="relative w-[min(92vw,700px)] overflow-hidden rounded-2xl border border-border-strong bg-bg-surface/95 shadow-2xl">
        <Command
          label="Global Command Palette"
          className="cmdk-root"
          shouldFilter
          loop
        >
          <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-3">
            <Search size={14} className="text-text-muted" />
            <Command.Input
              value={query}
              onValueChange={setQuery}
              placeholder="输入命令，例如：导入项目 / 打开设置 / 切换到终端"
              className="h-8 w-full border-none bg-transparent px-0 text-sm outline-none focus:ring-0"
            />
            <span className="rounded-md border border-border-muted px-1.5 py-0.5 text-[10px] text-text-muted">
              ESC
            </span>
          </div>

          <Command.List className="max-h-[52vh] overflow-y-auto p-2">
            <Command.Empty className="px-3 py-8 text-center text-xs text-text-muted">
              没有匹配的命令
            </Command.Empty>

            <Command.Group heading="界面">
              {grouped.ui.map((action) => {
                const Icon = action.icon ?? Braces;
                return (
                  <Command.Item
                    key={action.id}
                    value={`${action.title} ${action.subtitle || ""} ${action.keywords || ""}`}
                    onSelect={() => {
                      action.run();
                      onOpenChange(false);
                    }}
                    className={cn(
                      "flex cursor-pointer items-center justify-between rounded-lg px-3 py-2.5 text-sm",
                      "text-text-main data-[selected=true]:bg-primary-500/15 data-[selected=true]:text-primary-400",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Icon size={14} className="opacity-80" />
                      <div className="flex flex-col">
                        <span>{action.title}</span>
                        {action.subtitle && (
                          <span className="text-[11px] text-text-muted">{action.subtitle}</span>
                        )}
                      </div>
                    </div>
                  </Command.Item>
                );
              })}
            </Command.Group>

            <Command.Group heading="项目">
              {grouped.project.map((action) => {
                const Icon = action.icon ?? FolderOpen;
                return (
                  <Command.Item
                    key={action.id}
                    value={`${action.title} ${action.subtitle || ""} ${action.keywords || ""}`}
                    onSelect={() => {
                      action.run();
                      onOpenChange(false);
                    }}
                    className={cn(
                      "flex cursor-pointer items-center justify-between rounded-lg px-3 py-2.5 text-sm",
                      "text-text-main data-[selected=true]:bg-primary-500/15 data-[selected=true]:text-primary-400",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Icon size={14} className="opacity-80" />
                      <div className="flex flex-col">
                        <span>{action.title}</span>
                        {action.subtitle && (
                          <span className="text-[11px] text-text-muted">{action.subtitle}</span>
                        )}
                      </div>
                    </div>
                  </Command.Item>
                );
              })}
            </Command.Group>

            <Command.Group heading="执行">
              {grouped.run.map((action) => {
                const iconMap = {
                  "run.orchestration": PlayCircle,
                  "run.review": GitCompare,
                  "run.settings": Settings2,
                } as const;
                const Icon = action.icon ?? iconMap[action.id as keyof typeof iconMap] ?? PlayCircle;
                return (
                  <Command.Item
                    key={action.id}
                    value={`${action.title} ${action.subtitle || ""} ${action.keywords || ""}`}
                    onSelect={() => {
                      action.run();
                      onOpenChange(false);
                    }}
                    className={cn(
                      "flex cursor-pointer items-center justify-between rounded-lg px-3 py-2.5 text-sm",
                      "text-text-main data-[selected=true]:bg-primary-500/15 data-[selected=true]:text-primary-400",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Icon size={14} className="opacity-80" />
                      <div className="flex flex-col">
                        <span>{action.title}</span>
                        {action.subtitle && (
                          <span className="text-[11px] text-text-muted">{action.subtitle}</span>
                        )}
                      </div>
                    </div>
                  </Command.Item>
                );
              })}
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
