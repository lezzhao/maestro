import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Zap, ChevronRight, BrainCircuit } from "lucide-react";
import { useTranslation } from "../../i18n";
import { cn } from "../../lib/utils";
import type { MemoryEntry } from "../../types";

interface Props {
  onOpenGallery: () => void;
}

export function SkillSidebarSection({ onOpenGallery }: Props) {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<MemoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchSkills = async () => {
    try {
      const list = await invoke<MemoryEntry[]>("list_skills");
      setSkills(list);
    } catch (e) {
      console.error("Failed to fetch skills:", e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSkills();
    // Refresh occasionally or on an event? 
    // For now just on mount.
  }, []);

  if (!isLoading && skills.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4 px-4">
      <div className="flex items-center justify-between group/title">
        <h3 className="text-[10px] font-black text-muted-foreground/30 uppercase tracking-[0.2em]">
          Knowledge Base
        </h3>
        <button 
          onClick={onOpenGallery}
          className="text-[9px] font-bold text-primary/40 hover:text-primary transition-colors uppercase tracking-widest opacity-0 group-hover/title:opacity-100"
        >
          View All
        </button>
      </div>

      <div className="space-y-1">
        {isLoading ? (
          <div className="h-20 flex items-center justify-center opacity-20">
            <Zap size={14} className="animate-pulse" />
          </div>
        ) : (
          <div className="space-y-1">
            {skills.slice(0, 3).map(skill => (
              <button
                key={skill.id}
                onClick={onOpenGallery}
                className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/[0.03] transition-all group active:scale-[0.98] text-left border border-transparent hover:border-white/[0.05]"
              >
                <div className="w-8 h-8 rounded-lg bg-primary/5 flex items-center justify-center text-primary/40 group-hover:text-primary transition-colors">
                  <BrainCircuit size={14} />
                </div>
                <div className="min-w-0 flex-1">
                   <div className="text-[12px] font-bold text-muted-foreground/60 group-hover:text-foreground truncate transition-colors">
                     {skill.content.split('\n')[0].replace('### Skill: ', '')}
                   </div>
                   <div className="text-[9px] font-bold text-muted-foreground/30 truncate uppercase tracking-tight">
                     Core Intelligence Pattern
                   </div>
                </div>
              </button>
            ))}
            
            {skills.length > 3 && (
              <button
                onClick={onOpenGallery}
                className="w-full mt-2 py-2 flex items-center justify-center gap-2 text-[10px] font-bold text-muted-foreground/40 hover:text-primary transition-all rounded-xl hover:bg-primary/5"
              >
                <span>Discover {skills.length - 3} more patterns</span>
                <ChevronRight size={10} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
