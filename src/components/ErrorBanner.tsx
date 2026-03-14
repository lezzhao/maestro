import { useTranslation } from "../i18n";

type Props = {
  message: string | null;
  onClose: () => void;
};

export function ErrorBanner({ message, onClose }: Props) {
  const { t } = useTranslation();
  if (!message) return null;
  return (
    <div className="error-banner">
      <span>{message}</span>
      <button onClick={onClose}>{t("close")}</button>
    </div>
  );
}
