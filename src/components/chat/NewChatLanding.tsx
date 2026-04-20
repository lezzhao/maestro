import { motion } from "framer-motion";
import { 
  Sparkles, 
  Terminal, 
  Search, 
  Cpu, 
  ChevronRight, 
  Zap,
  ShieldCheck,
  Activity,
  Settings,
  FileCode,
  Layers,
  FileSearch,
  FolderOpen
} from "lucide-react";
import { useTranslation } from "../../i18n";
import { cn } from "../../lib/utils";
import { useActiveTask } from "../../hooks/useActiveTask";
import { useTaskRuntimeContext } from "../../hooks/useTaskRuntimeContext";
import { useAppUiState, useWorkspaceStoreState, useProjectStoreState } from "../../hooks/use-app-store-selectors";
import { useMemo, useCallback } from "react";

interface NewChatLandingProps {
  onActionClick: (text: string) => void;
}

export function NewChatLanding({ onActionClick }: NewChatLandingProps) {
  const { t } = useTranslation();
  const { activeTaskId } = useActiveTask();
  const { engineId, engine, isReady } = useTaskRuntimeContext(activeTaskId);
  const { setShowSettings } = useAppUiState();
  const { pinnedFiles, activeWorkspaceId, workspaces } = useWorkspaceStoreState();
  const { projectPath } = useProjectStoreState();

  const handleImportClick = useCallback(() => {
    // This is handled by a listener in App.tsx typically, 
    // but we can trigger it via the command palette's action logic or a custom event if needed.
    // For now, we'll assume the user uses the command palette as instructed or we can open settings.
    setShowSettings(true);
  }, [setShowSettings]);

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
        delayChildren: 0.2
      }
    }
  };

  const itemVariants = {
    hidden: { y: 20, opacity: 0 },
    visible: { 
      y: 0, 
      opacity: 1,
      transition: { duration: 0.5 }
    }
  };

  const dynamicActions = useMemo(() => {
    const baseActions = [];

    // Context-aware action: Pinned files
    if (pinnedFiles.length > 0) {
      baseActions.push({
        id: "pinned",
        icon: <FileCode className="w-5 h-5" />,
        title: "Analyze Pinned",
        description: `Analyze context from ${pinnedFiles.length} pinned files`,
        prompt: `I have pinned some files. Please summarize their purpose and interactions within the codebase.`,
        color: "text-primary",
        bg: "bg-primary/10"
      });
    }

    // Context-aware action: Workspace
    if (activeWorkspaceId) {
      baseActions.push({
        id: "scan",
        icon: <Layers className="w-5 h-5" />,
        title: "Project Scan",
        description: "Map project structure and logic",
        prompt: "Scan this workspace to identify core modules, entry points, and architectural patterns.",
        color: "text-indigo-500",
        bg: "bg-indigo-500/10"
      });
    }

    // Standard high-value actions
    baseActions.push(
      {
        id: "analyze",
        icon: <FileSearch className="w-5 h-5" />,
        title: "Technical Audit",
        description: "Identify risks and technical debt",
        prompt: "Perform a deep technical audit of this project's architecture and identify potential risks or technical debt.",
        color: "text-blue-500",
        bg: "bg-blue-500/10"
      },
      {
        id: "test",
        icon: <ShieldCheck className="w-5 h-5" />,
        title: "Test Coverage",
        description: "Find gaps and generate tests",
        prompt: "Find missing unit tests in this project and generate a coverage improvement plan with candidate test cases.",
        color: "text-emerald-500",
        bg: "bg-emerald-500/10"
      },
      {
        id: "optimize",
        icon: <Cpu className="w-5 h-5" />,
        title: "Optimize Performance",
        description: "Identify and fix bottlenecks",
        prompt: "Identify performance bottlenecks in the codebase and suggest specific optimization fixes.",
        color: "text-amber-500",
        bg: "bg-amber-500/10"
      }
    );

    return baseActions.slice(0, 3); // Keep it clean with 3 slots
  }, [pinnedFiles.length, activeWorkspaceId]);

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 max-w-4xl mx-auto w-full">
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="w-full space-y-12 relative z-10"
      >
        {/* Hero Section */}
        <div className="text-center space-y-4">
          <motion.div variants={itemVariants} className="space-y-1">
            <h1 className="text-[10px] font-black uppercase tracking-[0.5em] text-muted-foreground/20">
              {activeWorkspaceId ? workspaces.find(w => w.id === activeWorkspaceId)?.name : "Maestro"}
            </h1>
            <p className="text-[14px] font-bold text-muted-foreground/40 max-w-sm mx-auto">
              {t("landing_hero_subtitle") || "How can I help with your codebase today?"}
            </p>
          </motion.div>

          {/* Redundant Engine Status Bar Removed - Info is in Header */}

          {/* Call to action if no project */}
          {!projectPath && (
            <motion.div 
              variants={itemVariants}
              className="py-4 px-6 rounded-2xl border border-primary/20 bg-primary/[0.03] text-primary max-w-sm mx-auto flex items-center justify-between group cursor-pointer hover:bg-primary/[0.05] transition-all"
              onClick={() => window.dispatchEvent(new CustomEvent("maestro:open-project-picker"))}
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <FolderOpen size={18} />
                </div>
                <div className="text-left">
                  <div className="text-[12px] font-black uppercase tracking-wider">Connect Codebase</div>
                  <div className="text-[10px] opacity-60 font-medium">Select a project directory to begin</div>
                </div>
              </div>
              <ChevronRight size={16} className="opacity-40 group-hover:translate-x-1 transition-transform" />
            </motion.div>
          )}
        </div>

        {/* Quick Actions Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {dynamicActions.map((action) => {
            const isDisabled = !projectPath;
            return (
              <motion.button
                key={action.id}
                variants={itemVariants}
                whileHover={isDisabled ? {} : { y: -4, scale: 1.01 }}
                whileTap={isDisabled ? {} : { scale: 0.99 }}
                onClick={() => !isDisabled && onActionClick(action.prompt)}
                disabled={isDisabled}
                className={cn(
                  "group relative flex flex-col items-start p-7 rounded-[22px] border transition-all text-left overflow-hidden backdrop-blur-3xl inner-border",
                  isDisabled 
                    ? "bg-muted/5 border-border/20 opacity-30 cursor-not-allowed grayscale" 
                    : "border-border/60 bg-card/40 hover:bg-card/80 hover:border-primary/40 hover:shadow-vibe"
                )}
              >
                <div className={cn("p-3 rounded-2xl mb-5 shadow-sm transition-all duration-500", 
                  isDisabled ? "bg-muted/10 text-muted-foreground" : cn("group-hover:scale-110", action.bg, action.color)
                )}>
                  {action.icon}
                </div>
                <h3 className={cn("font-black text-[12px] uppercase tracking-[0.2em] mb-2",
                  isDisabled ? "text-muted-foreground/60" : "text-foreground"
                )}>{action.title}</h3>
                <p className="text-[11px] text-muted-foreground/80 leading-relaxed font-medium">
                  {isDisabled ? "Connect a codebase to unlock this action." : action.description}
                </p>
                
                {!isDisabled && (
                  <div className="absolute top-6 right-6 opacity-0 group-hover:opacity-100 transition-all translate-x-2 group-hover:translate-x-0">
                    <ChevronRight size={16} className="text-primary" />
                  </div>
                )}
                
                {/* Subtle background glow on hover */}
                {!isDisabled && (
                  <div className={cn("absolute inset-0 bg-gradient-to-br opacity-0 group-hover:opacity-[0.03] transition-opacity duration-700", {
                    "from-primary": action.id === "pinned",
                    "from-indigo-500": action.id === "scan",
                    "from-blue-500": action.id === "analyze",
                    "from-emerald-500": action.id === "test",
                    "from-amber-500": action.id === "optimize"
                  })} />
                )}
              </motion.button>
            );
          })}
        </div>

        {/* Capabilities Hint */}
        <motion.div 
          variants={itemVariants}
          className="flex items-center justify-center gap-10 pt-8 opacity-20"
        >
          <div className="flex items-center gap-2">
            <Zap size={14} />
            <span className="text-[9px] font-black uppercase tracking-[0.2em]">Autonomous</span>
          </div>
          <div className="flex items-center gap-2 border-x border-border/40 px-10">
            <Terminal size={14} />
            <span className="text-[9px] font-black uppercase tracking-[0.2em]">Integrated</span>
          </div>
          <div className="flex items-center gap-2">
            <ShieldCheck size={14} />
            <span className="text-[9px] font-black uppercase tracking-[0.2em]">Hardened</span>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
