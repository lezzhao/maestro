import { motion } from "framer-motion";
import { 
  Sparkles, 
  Terminal, 
  Search, 
  Cpu, 
  ChevronRight, 
  CheckCircle2, 
  AlertCircle,
  Zap,
  ShieldCheck,
  Activity
} from "lucide-react";
import { useTranslation } from "../../i18n";
import { cn } from "../../lib/utils";
import { useChatStore } from "../../stores/chatStore";
import { useActiveTask } from "../../hooks/useActiveTask";
import { useTaskRuntimeContext } from "../../hooks/useTaskRuntimeContext";

interface NewChatLandingProps {
  onActionClick: (text: string) => void;
}

export function NewChatLanding({ onActionClick }: NewChatLandingProps) {
  const { t } = useTranslation();
  const { activeTaskId } = useActiveTask();
  const { engineId, engine, profile, isReady } = useTaskRuntimeContext(activeTaskId);

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
      transition: { duration: 0.5, ease: "easeOut" }
    }
  };

  const actions = [
    {
      id: "analyze",
      icon: <Search className="w-5 h-5" />,
      title: t("landing_action_analyze"),
      description: t("landing_action_analyze_sub"),
      prompt: "Perform a deep technical audit of this project's architecture and identify potential risks or technical debt.",
      color: "text-blue-500",
      bg: "bg-blue-500/10"
    },
    {
      id: "test",
      icon: <ShieldCheck className="w-5 h-5" />,
      title: t("landing_action_test"),
      description: t("landing_action_test_sub"),
      prompt: "Find missing unit tests in this project and generate a coverage improvement plan with candidate test cases.",
      color: "text-emerald-500",
      bg: "bg-emerald-500/10"
    },
    {
      id: "optimize",
      icon: <Cpu className="w-5 h-5" />,
      title: t("landing_action_opt"),
      description: t("landing_action_opt_sub"),
      prompt: "Identify performance bottlenecks in the codebase and suggest specific optimization fixes.",
      color: "text-amber-500",
      bg: "bg-amber-500/10"
    }
  ];

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 max-w-4xl mx-auto w-full">
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="w-full space-y-12"
      >
        {/* Hero Section */}
        <div className="text-center space-y-6">
          <motion.div 
            variants={itemVariants}
            className="inline-flex items-center justify-center p-4 rounded-3xl bg-primary/5 border border-primary/10 relative group"
          >
            <div className="absolute inset-0 bg-primary/10 blur-2xl rounded-full opacity-30 group-hover:opacity-50 transition-opacity" />
            <Sparkles className="w-10 h-10 text-primary animate-pulse relative" />
          </motion.div>

          <motion.div variants={itemVariants} className="space-y-2">
            <h1 className="text-5xl font-black tracking-tight bg-gradient-to-b from-text-main to-text-main/50 bg-clip-text text-transparent">
              Maestro
            </h1>
            <p className="text-lg text-text-muted/70 font-medium max-w-md mx-auto leading-relaxed">
              {t("landing_hero_subtitle")}
            </p>
          </motion.div>

          {/* Engine Status Bar */}
          <motion.div 
            variants={itemVariants}
            className="flex items-center justify-center gap-4 py-2 px-4 rounded-full bg-bg-surface/50 border border-border-muted/20 backdrop-blur-md inline-flex mx-auto"
          >
            <div className="flex items-center gap-2 pr-3 border-r border-border-muted/20">
              <div className={cn(
                "w-1.5 h-1.5 rounded-full animate-pulse",
                isReady ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" : "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.4)]"
              )} />
              <span className="text-[10px] font-bold tracking-widest uppercase text-text-muted/60">
                {engine?.display_name || engineId || "System"}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Activity size={10} className="text-primary/50" />
              <span className="text-[10px] font-bold text-text-muted/80">
                {isReady ? "Inference Node: Ready" : "Setup Required"}
              </span>
            </div>
          </motion.div>
        </div>

        {/* Quick Actions Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {actions.map((action) => (
            <motion.button
              key={action.id}
              variants={itemVariants}
              whileHover={{ y: -4, scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => onActionClick(action.prompt)}
              className="flex flex-col items-start p-6 rounded-2xl bg-bg-elevated border border-border-muted/10 hover:border-primary/30 transition-all text-left shadow-sm hover:shadow-glow group relative overflow-hidden"
            >
              <div className={cn("p-2.5 rounded-xl mb-4 group-hover:scale-110 transition-transform", action.bg, action.color)}>
                {action.icon}
              </div>
              <h3 className="font-bold text-sm mb-1.5 group-hover:text-primary transition-colors">{action.title}</h3>
              <p className="text-xs text-text-muted/60 leading-relaxed">
                {action.description}
              </p>
              <ChevronRight className="absolute bottom-6 right-6 w-4 h-4 text-primary opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
            </motion.button>
          ))}
        </div>

        {/* Capabilities Hint */}
        <motion.div 
          variants={itemVariants}
          className="flex items-center justify-center gap-8 py-6 opacity-30 grayscale hover:grayscale-0 hover:opacity-100 transition-all duration-700"
        >
          <div className="flex items-center gap-2">
            <Zap size={14} />
            <span className="text-[10px] font-black uppercase tracking-tighter">Autonomous Execution</span>
          </div>
          <div className="flex items-center gap-2">
            <Terminal size={14} />
            <span className="text-[10px] font-black uppercase tracking-tighter">Pure Shell Integration</span>
          </div>
          <div className="flex items-center gap-2">
            <ShieldCheck size={14} />
            <span className="text-[10px] font-black uppercase tracking-tighter">Industrial Grade</span>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}
