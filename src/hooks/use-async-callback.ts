import { useState, useCallback } from "react";
import { toast } from "sonner";
import { useTranslation } from "../i18n";

interface UseAsyncCallbackOptions<T> {
  /** Optional success message or translation key. */
  onSuccessMessage?: string;
  /** Optional specific error message or translation key prefix. */
  errorMessagePrefix?: string;
  /** Callback to run on success. */
  onSuccess?: (result: T) => void;
  /** Callback to run on error. */
  onError?: (error: unknown) => void;
  /** Whether to show a success toast. Defaults to true. */
  showSuccessToast?: boolean;
}

/**
 * A robust hook to wrap any asynchronous operation with loading/error states and automatic Toast feedback.
 * Standardizes the "Patch-on-Patch" async logic into a single reusable pattern.
 */
export function useAsyncCallback<Args extends unknown[], T>(
  asyncFn: (...args: Args) => Promise<T>,
  options: UseAsyncCallbackOptions<T> = {}
) {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(
    async (...args: Args): Promise<T | undefined> => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await asyncFn(...args);
        if (options.onSuccessMessage && options.showSuccessToast !== false) {
          toast.success(t(options.onSuccessMessage as never) || options.onSuccessMessage);
        }
        options.onSuccess?.(result);
        return result;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        
        // Skip toast for user-cancelled operations (common in pickers)
        const isCancelled = /user cancelled|canceled|aborted/i.test(message);
        
        if (!isCancelled) {
          const prefix = options.errorMessagePrefix ? (t(options.errorMessagePrefix as never) || options.errorMessagePrefix) : "";
          const displayMessage = prefix ? `${prefix}: ${message}` : message;
          
          setError(displayMessage);
          toast.error(displayMessage);
        }
        
        options.onError?.(err);
        // We don't re-throw by default to allow components to handle it via the 'error' state
        return undefined;
      } finally {
        setIsLoading(false);
      }
    },
    [asyncFn, options, t]
  );

  return {
    execute,
    isLoading,
    error,
    setIsLoading,
    setError,
  };
}
