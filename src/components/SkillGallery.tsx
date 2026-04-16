import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { 
  Lightbulb, 
  Trash2, 
  ChevronRight, 
  Search,
  BookOpen,
  Zap,
  X
} from "lucide-react";
import { useTranslation } from "../i18n";
import { cn } from "../lib/utils";
import type { MemoryEntry } from "../types";
import { useAppUiState } from "../hooks/use-app-store-selectors";

export function SkillGallery() {
  const { t } = useTranslation();
  const { setShowSkillGallery } = useAppUiState();
  const [skills, setSkills] = useState<MemoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSkill, setSelectedSkill] = useState<MemoryEntry | null>(null);

  const fetchSkills = async () => {
    setIsLoading(true);
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
  }, []);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this skill?")) return;
    try {
      await invoke("delete_skill", { id });
      setSkills(s => s.filter(x => x.id !== id));
      if (selectedSkill?.id === id) setSelectedSkill(null);
    } catch (e) {
      console.error("Delete failed:", e);
    }
  };

  const filteredSkills = skills.filter(s => 
    s.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (s.metadata && s.metadata.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="flex flex-col h-full bg-background/50 backdrop-blur-xl transition-all duration-500">
      <div className="p-6 border-b border-white/[0.04]">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shadow-lg shadow-primary/5">
              <Zap size={20} />
            </div>
            <div>
              <h2 className="text-lg font-black tracking-tight text-foreground uppercase tracking-[0.1em]">Skill Engine</h2>
              <p className="text-[10px] font-bold text-muted-foreground/40 uppercase tracking-widest">Global Agent Intelligence</p>
            </div>
          </div>
          <button 
            onClick={() => setShowSkillGallery(false)}
            className="w-10 h-10 rounded-xl bg-white/[0.02] border border-white/[0.05] flex items-center justify-center text-muted-foreground/40 hover:text-foreground hover:bg-white/[0.05] transition-all active:scale-90"
          >
            <X size={18} />
          </button>
        </div>

        <div className="relative group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground/40 group-focus-within:text-primary transition-colors" size={14} />
          <input
            type="text"
            placeholder="Search Intelligence..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-11 pl-11 pr-4 rounded-xl bg-white/[0.02] border border-white/[0.05] text-[13px] font-medium focus:ring-1 focus:ring-primary/20 focus:border-primary/20 transition-all placeholder:text-muted-foreground/20"
          />
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* List View */}
        <div className={cn(
          "flex-1 overflow-y-auto no-scrollbar p-4 space-y-3 transition-all duration-500",
          selectedSkill ? "hidden md:block w-1/3 border-r border-white/[0.04]" : "w-full"
        )}>
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-40 gap-4">
              <div className="w-8 h-8 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
              <span className="text-[10px] font-bold text-muted-foreground/40 uppercase tracking-widest">Hydrating Core...</span>
            </div>
          ) : filteredSkills.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-60 text-center space-y-4">
              <div className="w-16 h-16 rounded-3xl bg-white/[0.02] flex items-center justify-center text-muted-foreground/20">
                <Lightbulb size={32} />
              </div>
              <p className="text-[11px] font-bold text-muted-foreground/30 uppercase tracking-[0.2em] max-w-[200px]">No intelligence patterns detected yet.</p>
            </div>
          ) : (
            filteredSkills.map(skill => (
              <div
                key={skill.id}
                onClick={() => setSelectedSkill(skill)}
                className={cn(
                  "group relative p-4 rounded-2xl border transition-all duration-300 cursor-pointer overflow-hidden",
                  selectedSkill?.id === skill.id
                    ? "bg-primary/5 border-primary/30 shadow-lg shadow-primary/5"
                    : "bg-white/[0.01] border-white/[0.05] hover:bg-white/[0.03] hover:border-white/[0.1] hover:scale-[1.01]"
                )}
              >
                <div className="absolute top-0 right-0 p-3 opacity-0 group-hover:opacity-100 transition-opacity">
                   <button onClick={(e) => handleDelete(skill.id, e)} className="text-muted-foreground/30 hover:text-destructive transition-colors">
                     <Trash2 size={14} />
                   </button>
                </div>

                <div className="flex items-start gap-3">
                  <div className={cn(
                    "w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border transition-colors",
                    selectedSkill?.id === skill.id ? "bg-primary/20 border-primary/20 text-primary" : "bg-white/[0.03] border-white/[0.05] text-muted-foreground/40"
                  )}>
                    <BookOpen size={14} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[13px] font-bold text-foreground truncate tracking-tight">{skill.content.split('\n')[0].replace('### Skill: ', '')}</h3>
                    <p className="text-[11px] text-muted-foreground/60 line-clamp-2 mt-1 leading-relaxed font-medium">
                      {skill.content.split('\n').slice(1).join(' ').replace(/\*\*Description\*\*: /, '').slice(0, 100)}...
                    </p>
                    <div className="flex items-center gap-2 mt-3">
                       <span className="px-2 py-0.5 rounded-full bg-white/[0.03] text-[9px] font-black text-muted-foreground/40 uppercase tracking-widest border border-white/[0.05]">
                         {new Date(skill.created_at).toLocaleDateString()}
                       </span>
                    </div>
                  </div>
                  <ChevronRight size={14} className="mt-1 text-muted-foreground/20" />
                </div>
              </div>
            ))
          )}
        </div>

        {/* Detail View */}
        {selectedSkill && (
          <div className="flex-1 flex flex-col min-h-0 bg-background/30 backdrop-blur-2xl animate-in slide-in-from-right-4 duration-500">
             <div className="p-8 overflow-y-auto no-scrollbar">
                <div className="flex items-center gap-4 mb-8">
                  <button onClick={() => setSelectedSkill(null)} className="md:hidden p-2 -ml-2 text-muted-foreground hover:text-foreground">
                    <ChevronRight className="rotate-180" size={20} />
                  </button>
                  <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary shadow-xl shadow-primary/5 border border-primary/20">
                    <Zap size={24} />
                  </div>
                  <h1 className="text-2xl font-black tracking-tighter text-foreground uppercase">{selectedSkill.content.split('\n')[0].replace('### Skill: ', '')}</h1>
                </div>

                <div className="space-y-8">
                  <section>
                    <h4 className="text-[10px] font-black text-muted-foreground/30 uppercase tracking-[0.3em] mb-4">Context & Description</h4>
                    <div className="prose prose-invert prose-sm max-w-none text-muted-foreground/80 leading-relaxed font-medium bg-white/[0.01] p-6 rounded-3xl border border-white/[0.03]">
                      {selectedSkill.content.split('\n').slice(1).find(l => l.includes('Description'))?.replace('**Description**: ', '')}
                    </div>
                  </section>

                  <section>
                    <h4 className="text-[10px] font-black text-muted-foreground/30 uppercase tracking-[0.3em] mb-4">Core Instructions</h4>
                    <div className="bg-white/[0.01] border border-white/[0.03] rounded-3xl overflow-hidden shadow-inner">
                      <pre className="p-8 text-[12px] font-mono leading-relaxed text-foreground/90 whitespace-pre-wrap overflow-x-auto">
                        {selectedSkill.content.split('**Instructions**:')[1] || "No instructions provided."}
                      </pre>
                    </div>
                  </section>
                </div>
             </div>
          </div>
        )}
      </div>
    </div>
  );
}
