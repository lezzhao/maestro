import {
  memo,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  ChevronRight,
  File,
  FileCode2,
  Folder,
  FolderOpen,
  Search,
  X,
  Copy,
  ExternalLink,
} from "lucide-react";
import { useTranslation } from "../i18n";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { cn } from "../lib/utils";
import type { FileTreeNode } from "../types";

type Props = {
  projectName: string;
  projectPath: string;
  tree: FileTreeNode[] | null;
  loading?: boolean;
};

function iconForFile(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["ts", "tsx", "js", "jsx", "rs", "py", "go", "java", "c", "cpp"].includes(ext)) {
    return FileCode2;
  }
  return File;
}

type TreeItemProps = {
  node: FileTreeNode;
  level: number;
  selectedPath: string;
  onSelect: (path: string) => void;
  onContextMenu: (event: MouseEvent<HTMLButtonElement>, path: string) => void;
};

const TreeItem = memo(function TreeItem({ node, level, selectedPath, onSelect, onContextMenu }: TreeItemProps) {
  const [open, setOpen] = useState(level < 2);
  const isSelected = selectedPath === node.path;
  const paddingLeft = 10 + level * 14;

  if (node.is_dir) {
    return (
      <div>
        <button
          type="button"
          className={cn(
            "w-full flex items-center gap-1.5 py-1.5 rounded-md text-xs text-left text-text-muted hover:bg-bg-subtle/60 hover:text-text-main transition-colors",
            isSelected && "bg-primary-500/12 text-primary-500",
          )}
          style={{ paddingLeft }}
          onClick={() => {
            setOpen((v) => !v);
            onSelect(node.path);
          }}
          onContextMenu={(event) => onContextMenu(event, node.path)}
        >
          <ChevronRight size={12} className={cn("transition-transform", open && "rotate-90")} />
          {open ? <FolderOpen size={13} /> : <Folder size={13} />}
          <span className="truncate">{node.name}</span>
        </button>
        {open &&
          node.children.map((child) => (
            <TreeItem
              key={`${child.path}-${child.name}`}
              node={child}
              level={level + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
            />
          ))}
      </div>
    );
  }

  const FileIcon = iconForFile(node.name);
  return (
    <button
      type="button"
      className={cn(
        "w-full flex items-center gap-1.5 py-1.5 rounded-md text-xs text-left text-text-muted hover:bg-bg-subtle/60 hover:text-text-main transition-colors",
        isSelected && "bg-primary-500/12 text-primary-500",
      )}
      style={{ paddingLeft: paddingLeft + 16 }}
      onClick={() => onSelect(node.path)}
      onContextMenu={(event) => onContextMenu(event, node.path)}
    >
      <FileIcon size={12} />
      <span className="truncate">{node.name}</span>
    </button>
  );
});

function FileTreeImpl({ projectName, projectPath, tree, loading = false }: Props) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [selectedPath, setSelectedPath] = useState("");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    path: string;
  } | null>(null);

  const selectedAbsolutePath = useMemo(() => {
    if (!selectedPath) return "";
    return `${projectPath}/${selectedPath}`;
  }, [projectPath, selectedPath]);
  const visibleTree = useMemo(() => {
    if (!tree) return null;
    const keyword = deferredQuery.trim().toLowerCase();
    if (!keyword) return tree;

    const filterNodes = (nodes: FileTreeNode[]): FileTreeNode[] => {
      const filtered: FileTreeNode[] = [];
      for (const node of nodes) {
        const selfMatch =
          node.name.toLowerCase().includes(keyword) || node.path.toLowerCase().includes(keyword);
        if (node.is_dir) {
          const children = filterNodes(node.children);
          if (selfMatch || children.length > 0) {
            filtered.push({ ...node, children });
          }
        } else if (selfMatch) {
          filtered.push(node);
        }
      }
      return filtered;
    };

    return filterNodes(tree);
  }, [deferredQuery, tree]);

  const contextPathAbsolute = useMemo(() => {
    if (!contextMenu) return "";
    return `${projectPath}/${contextMenu.path}`;
  }, [contextMenu, projectPath]);
  const contextMenuPosition = useMemo(() => {
    if (!contextMenu || !containerRef.current) return null;
    const menuWidth = 228;
    const menuHeight = 120;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(6, Math.min(contextMenu.x, rect.width - menuWidth - 6));
    const y = Math.max(6, Math.min(contextMenu.y, rect.height - menuHeight - 6));
    return { left: x, top: y };
  }, [contextMenu]);

  useEffect(() => {
    const closeMenu = (event: Event) => {
      if (!contextMenu) return;
      const target = event.target as Node | null;
      if (
        target &&
        containerRef.current &&
        containerRef.current.contains(target) &&
        event.type === "click"
      ) {
        return;
      }
      setContextMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    };
    window.addEventListener("click", closeMenu as EventListener);
    window.addEventListener("contextmenu", closeMenu as EventListener);
    window.addEventListener("resize", closeMenu as EventListener);
    window.addEventListener("wheel", closeMenu as EventListener, { passive: true });
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("click", closeMenu as EventListener);
      window.removeEventListener("contextmenu", closeMenu as EventListener);
      window.removeEventListener("resize", closeMenu as EventListener);
      window.removeEventListener("wheel", closeMenu as EventListener);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [contextMenu]);

  return (
    <Card
      ref={containerRef}
      className="relative flex h-full min-h-0 flex-col border-none bg-transparent shadow-none"
    >
      <CardHeader className="pb-3 px-2 pt-2">
        <CardTitle className="text-[10px] font-black uppercase tracking-widest text-text-muted/60 mb-2">
          {t("file_explorer")}
        </CardTitle>
        <div className="flex items-center justify-between gap-2 mb-3 bg-bg-elevated/50 p-2 rounded-lg border border-border-subtle">
          <span className="text-xs font-bold truncate text-primary-500">{projectName}</span>
          <div className="flex items-center gap-1">
            {tree?.length === 2000 && (
              <Badge variant="warning" className="text-[8px] h-3.5 px-1 animate-pulse" title="Reached 2000 files limit">
                LIMIT
              </Badge>
            )}
            <Badge variant="secondary" className="text-[9px] font-black h-4 px-1 bg-primary-500/10 text-primary-500 border-none">
              {visibleTree?.length ?? 0}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("filter_files")}
              className="h-8 text-[11px] pl-8 bg-bg-elevated/30 border-border-subtle focus:border-primary-500/50 transition-all"
            />
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted/50" />
          </div>
          {query.trim().length > 0 && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8 hover:bg-rose-500/10 hover:text-rose-500"
              onClick={() => setQuery("")}
              title={t("clear_filter")}
            >
              <X size={12} />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col space-y-3 px-2 pb-2">
        <div className="min-h-0 flex-1 overflow-y-auto pr-1 scrollbar-thin">
          {loading ? (
            <div className="space-y-3 p-2 opacity-60 animate-pulse">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-sm bg-bg-elevated/80" />
                  <div className="h-2.5 rounded-full bg-bg-elevated/80" style={{ width: `${Math.max(30, 100 - (i * 15))}%` }} />
                </div>
              ))}
            </div>
          ) : !visibleTree || visibleTree.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center opacity-40">
              <Folder size={24} />
              <p className="text-[10px] font-bold uppercase tracking-widest">{t("empty_tree")}</p>
            </div>
          ) : (
            visibleTree.map((node) => (
              <TreeItem
                key={`${node.path}-${node.name}`}
                node={node}
                level={0}
                selectedPath={selectedPath}
                onSelect={setSelectedPath}
                onContextMenu={(event, path) => {
                  event.preventDefault();
                  const rect = containerRef.current?.getBoundingClientRect();
                  const x = rect ? event.clientX - rect.left : event.clientX;
                  const y = rect ? event.clientY - rect.top : event.clientY;
                  setSelectedPath(path);
                  setContextMenu({
                    x,
                    y,
                    path,
                  });
                }}
              />
            ))
          )}
        </div>
        <div className="rounded-xl border border-border-subtle bg-bg-elevated/30 p-2.5 backdrop-blur-sm">
          <p className="mb-1.5 flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest text-text-muted/50">
            <span className="h-1 w-1 rounded-full bg-primary-500" />
            {t("active_path")}
          </p>
          <p className="break-all font-mono text-[10px] leading-relaxed text-text-main/80">
            {selectedAbsolutePath || projectPath}
          </p>
        </div>
      </CardContent>
      {contextMenu && contextMenuPosition && (
        <div
          className="absolute z-50 min-w-[220px] rounded-lg border border-border-strong bg-bg-surface p-1 shadow-2xl"
          style={{ left: contextMenuPosition.left, top: contextMenuPosition.top }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-text-main hover:bg-bg-subtle"
            onClick={async () => {
              await navigator.clipboard.writeText(contextMenu.path);
              setContextMenu(null);
            }}
          >
            <Copy size={12} />
            {t("copy_relative_path")}
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-text-main hover:bg-bg-subtle"
            onClick={async () => {
              await navigator.clipboard.writeText(contextPathAbsolute);
              setContextMenu(null);
            }}
          >
            <Copy size={12} />
            {t("copy_absolute_path")}
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-text-main hover:bg-bg-subtle"
            onClick={() => {
              void openPath(contextPathAbsolute);
              setContextMenu(null);
            }}
          >
            <ExternalLink size={12} />
            {t("open_in_system")}
          </button>
        </div>
      )}
    </Card>
  );
}

export const FileTree = memo(
  FileTreeImpl,
  (prev, next) =>
    prev.projectName === next.projectName &&
    prev.projectPath === next.projectPath &&
    prev.tree === next.tree &&
    prev.loading === next.loading,
);
