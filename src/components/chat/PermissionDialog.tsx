import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useChatStore } from "../../stores/chatStore";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "../ui/card";
import { Button } from "../ui/button";
import { ShieldAlert, Terminal, Check, X, AlertTriangle, Edit3, Save } from "lucide-react";
import { useTranslation } from "../../i18n";
import { cn } from "../../lib/utils";

export function PermissionDialog() {
  const { t } = useTranslation();
  const pendingPermissionRequest = useChatStore((state) => state.pendingPermissionRequest);
  const resolvePermission = useChatStore((state) => state.resolvePermission);
  
  const [isEditing, setIsEditing] = useState(false);
  const [editedInput, setEditedInput] = useState("");

  // Update editedInput when pendingPermissionRequest changes
  useEffect(() => {
    if (pendingPermissionRequest) {
      setEditedInput(pendingPermissionRequest.toolInput);
      setIsEditing(false);
    }
  }, [pendingPermissionRequest]);

  if (!pendingPermissionRequest) return null;

  const handleApprove = () => {
    resolvePermission(true, isEditing ? editedInput : undefined);
  };

  const handleDeny = () => {
    resolvePermission(false);
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/60 backdrop-blur-md"
          onClick={handleDeny}
        />

        {/* Dialog Content */}
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          transition={{ type: "spring", damping: 20, stiffness: 300 }}
          className="relative w-full max-w-md"
        >
          <Card className="border-2 border-primary/20 shadow-2xl shadow-primary/10 bg-bg-surface overflow-hidden text-text-main">
            <div className="absolute top-0 left-0 w-full h-1 bg-linear-to-r from-primary via-sky-400 to-primary/40" />
            
            <CardHeader className="pt-8 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                <ShieldAlert className="h-8 w-8 text-primary" />
              </div>
              <CardTitle className="text-2xl font-black tracking-tight">{t("permission_request_title")}</CardTitle>
              <CardDescription className="text-text-muted/80 font-medium">
                {t("permission_desc")}
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              <div className="rounded-lg border border-border-muted/20 bg-bg-elevated/50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Terminal size={14} className="text-sky-400" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-text-muted">{t("tool_call_label")}</span>
                  </div>
                  <button 
                    onClick={() => setIsEditing(!isEditing)}
                    className={cn(
                      "flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-bold transition-all",
                      isEditing ? "bg-primary/20 text-primary" : "bg-bg-base hover:bg-primary/10 text-text-muted/60 hover:text-primary"
                    )}
                  >
                    <Edit3 size={12} />
                    {isEditing ? t("cancel_edit") : t("edit_params")}
                  </button>
                </div>

                <div className="font-mono text-sm font-bold text-primary px-2 py-1 rounded bg-primary/5 border border-primary/10 inline-block">
                  {pendingPermissionRequest.toolName}
                </div>
                {!isEditing && (
                  <p className="text-sm leading-relaxed text-text-main/90 font-medium italic border-l-2 border-primary/40 pl-3">
                    &quot;{pendingPermissionRequest.message}&quot;
                  </p>
                )}

                <div className="mt-2 space-y-1.5">
                  <span className="text-text-muted/40 uppercase text-[9px] font-black block tracking-widest">
                    {isEditing ? t("editing_params") : t("input_params_label")}
                  </span>
                  {isEditing ? (
                    <textarea
                      value={editedInput}
                      onChange={(e) => setEditedInput(e.target.value)}
                      className="w-full h-32 p-3 text-xs font-mono bg-black/40 border border-primary/30 rounded-lg text-text-main focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none"
                    />
                  ) : (
                      <div className="text-[11px] font-mono text-text-muted/60 break-all bg-black/20 p-2 rounded border border-white/5 max-h-32 overflow-y-auto">
                        {pendingPermissionRequest.toolInput}
                      </div>
                  )}
                </div>
              </div>

              {!isEditing && (
                <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/5 border border-amber-500/10">
                  <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-amber-500/80 leading-snug">
                    {t("permission_warning")}
                  </p>
                </div>
              )}
            </CardContent>

            <CardFooter className="flex gap-3 pb-8 px-6">
              <Button
                variant="outline"
                className="flex-1 h-12 border-border-muted/20 hover:bg-rose-500/10 hover:text-rose-500 hover:border-rose-500/20 group transition-all"
                onClick={handleDeny}
              >
                <X size={16} className="mr-2 group-hover:scale-110 transition-transform" />
                {t("deny")}
              </Button>
              <Button
                className={cn(
                  "flex-1 h-12 text-white shadow-lg group transition-all",
                  isEditing ? "bg-emerald-600 hover:bg-emerald-500 shadow-emerald-500/20" : "bg-primary hover:bg-primary/90 shadow-primary/20"
                )}
                onClick={handleApprove}
              >
                {isEditing ? (
                  <Save size={16} className="mr-2 group-hover:scale-110 transition-transform" />
                ) : (
                  <Check size={16} className="mr-2 group-hover:scale-110 transition-transform" />
                )}
                {isEditing ? t("save_and_allow") : t("allow_execution")}
              </Button>
            </CardFooter>
          </Card>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
