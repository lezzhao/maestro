import { motion, AnimatePresence } from "framer-motion";
import { useChatStore } from "../../stores/chatStore";
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from "../ui/card";
import { Button } from "../ui/button";
import { ShieldAlert, Terminal, Check, X, AlertTriangle } from "lucide-react";
import { useTranslation } from "../../i18n";

export function PermissionDialog() {
  const { t } = useTranslation();
  const pendingPermissionRequest = useChatStore((state) => state.pendingPermissionRequest);
  const resolvePermission = useChatStore((state) => state.resolvePermission);

  if (!pendingPermissionRequest) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/60 backdrop-blur-md"
          onClick={() => resolvePermission(false)}
        />

        {/* Dialog Content */}
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          transition={{ type: "spring", damping: 20, stiffness: 300 }}
          className="relative w-full max-w-md"
        >
          <Card className="border-2 border-primary/20 shadow-2xl shadow-primary/10 bg-bg-surface overflow-hidden">
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
                <div className="flex items-center gap-2">
                  <Terminal size={14} className="text-sky-400" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-text-muted">{t("tool_call_label")}</span>
                </div>
                <div className="font-mono text-sm font-bold text-primary px-2 py-1 rounded bg-primary/5 border border-primary/10 inline-block">
                  {pendingPermissionRequest.toolName}
                </div>
                <p className="text-sm leading-relaxed text-text-main/90 font-medium italic border-l-2 border-primary/40 pl-3">
                  &quot;{pendingPermissionRequest.message}&quot;
                </p>
                <div className="mt-2 text-[11px] font-mono text-text-muted/60 break-all bg-black/20 p-2 rounded border border-white/5">
                  <span className="text-text-muted/40 uppercase text-[9px] block mb-1">{t("input_params_label")}</span>
                  {pendingPermissionRequest.toolInput}
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/5 border border-amber-500/10">
                <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
                <p className="text-[11px] text-amber-500/80 leading-snug">
                  {t("permission_warning")}
                </p>
              </div>
            </CardContent>

            <CardFooter className="flex gap-3 pb-8 px-6">
              <Button
                variant="outline"
                className="flex-1 h-12 border-border-muted/20 hover:bg-rose-500/10 hover:text-rose-500 hover:border-rose-500/20 group transition-all"
                onClick={() => resolvePermission(false)}
              >
                <X size={16} className="mr-2 group-hover:scale-110 transition-transform" />
                {t("deny")}
              </Button>
              <Button
                className="flex-1 h-12 bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/20 group transition-all"
                onClick={() => resolvePermission(true)}
              >
                <Check size={16} className="mr-2 group-hover:scale-110 transition-transform" />
                {t("allow_execution")}
              </Button>
            </CardFooter>
          </Card>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
