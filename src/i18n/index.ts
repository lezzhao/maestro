import { useCallback } from "react";
import { useLanguageState } from "../hooks/use-app-store-selectors";
import { zh } from "./zh";
import { en } from "./en";

export const translations = { zh, en };
export type TranslationFn = (key: keyof typeof en, params?: Record<string, string | number>) => string;

export function useTranslation() {
  const lang = useLanguageState();

  const t = useCallback(
    (key: keyof typeof en, params?: Record<string, string | number>) => {
      const dict = (translations[lang as keyof typeof translations] || translations.en) as Record<string, string>;
      let text = dict[key] || (translations.en as Record<string, string>)[key] || key;

      if (params) {
        Object.entries(params).forEach(([k, v]) => {
          text = text.replace(`{${k}}`, String(v));
        });
      }
      return text;
    },
    [lang]
  );

  return { t, lang };
}
