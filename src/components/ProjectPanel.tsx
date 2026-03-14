import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { ProjectImport } from "./ProjectImport";
import { FolderOpen, Sparkles, ShieldCheck, Wand2 } from "lucide-react";
import { useTranslation } from "../i18n";
import type { EngineRecommendation, ProjectStackResult } from "../types";

type Props = {
  projectPath: string;
  onImport: (path: string) => Promise<{
    stack: ProjectStackResult;
    recommendation: EngineRecommendation;
  }>;
  onInjectSpec: () => Promise<void>;
};

export function ProjectPanel({ projectPath, onImport, onInjectSpec }: Props) {
  const { t } = useTranslation();
  const [stack, setStack] = useState<ProjectStackResult | null>(null);
  const [recommendation, setRecommendation] = useState<EngineRecommendation | null>(null);
  const [specDetected, setSpecDetected] = useState(false);
  const [specLoading, setSpecLoading] = useState(false);

  const handleImport = async (path: string) => {
    const result = await onImport(path);
    setStack(result.stack);
    setRecommendation(result.recommendation);
    try {
      const detected = await invoke<boolean>("spec_detect", { projectPath: path });
      setSpecDetected(detected);
    } catch {
      setSpecDetected(false);
    }
  };

  const applySpec = async () => {
    setSpecLoading(true);
    try {
      await onInjectSpec();
      if (projectPath) {
        const detected = await invoke<boolean>("spec_detect", { projectPath });
        setSpecDetected(detected);
      }
    } finally {
      setSpecLoading(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <section className="flex items-center gap-2">
        <FolderOpen size={16} className="text-primary-500" />
        <h2 className="text-xs font-bold text-text-muted uppercase tracking-widest">
          {t("project_import")}
        </h2>
      </section>

      <section className="animate-in slide-in-from-bottom-2 duration-500">
        <Card className="border-border-muted/60 bg-bg-surface/50 backdrop-blur-sm shadow-xl">
          <CardContent className="pt-8 pb-8 px-8">
            <div className="flex flex-col md:flex-row items-center gap-8">
              <div className="w-16 h-16 rounded-2xl bg-primary-500/10 flex items-center justify-center text-primary-500 shrink-0 shadow-inner">
                <FolderOpen size={32} />
              </div>
              <div className="flex-1 space-y-1 text-center md:text-left">
                <h3 className="text-lg font-bold">{t("project_import")}</h3>
                <p className="text-sm text-text-muted max-w-lg">
                  {t("project_import_desc")}
                </p>
              </div>
              <ProjectImport projectPath={projectPath} onApply={handleImport} />
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2 border-border-muted/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Sparkles size={14} className="text-primary-500" />
              {t("stack_detected")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {(stack?.stacks || []).length === 0 ? (
                <span className="text-xs text-text-muted">{t("no_stack")}</span>
              ) : (
                stack?.stacks.map((item) => (
                  <Badge key={item} variant="secondary">
                    {item}
                  </Badge>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border-muted/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Wand2 size={14} className="text-amber-500" />
              {t("recommended_engine")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="text-sm font-semibold">
              {recommendation?.engine_id || t("not_recommended")}
            </div>
            <div className="text-xs text-text-muted leading-relaxed">
              {recommendation?.reason || t("recommend_reason")}
            </div>
          </CardContent>
        </Card>
      </section>

      <Card className="border-border-muted/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldCheck size={14} className="text-emerald-500" />
            {t("spec_status")}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <div className="text-sm">
            {specDetected ? (
              <Badge variant="success">{t("spec_detected")}</Badge>
            ) : (
              <Badge variant="warning">{t("spec_not_found")}</Badge>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void applySpec()}
            disabled={!projectPath}
            loading={specLoading}
          >
            {t("inject_spec")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
