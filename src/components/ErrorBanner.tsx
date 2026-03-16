import { useTranslation } from "../i18n";

type Props = {
  message: string | null;
  onClose: () => void;
};

export function ErrorBanner({ message, onClose }: Props) {
  const { t } = useTranslation();
  if (!message) return null;
  return (
    <div className="mx-4 my-2 px-4 py-3 bg-rose-500/10 border border-rose-500/20 rounded-lg flex items-start justify-between gap-3 shadow-sm backdrop-blur-sm animate-in fade-in slide-in-from-top-2 duration-200">
      <div className="flex flex-col gap-1 min-w-0 flex-1">
        <span className="text-[12px] font-bold text-rose-500 truncate">System Error</span>
        <span className="text-[11px] text-rose-500/80 leading-snug wrap-break-word">
          {message}
        </span>
      </div>
      <button 
        onClick={onClose}
        className="shrink-0 text-rose-500/50 hover:text-rose-500 hover:bg-rose-500/10 p-1 rounded-md transition-colors"
        title={t("close") || "Close"}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </div>
  );
}
