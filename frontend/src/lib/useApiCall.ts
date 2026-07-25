import { useState, useCallback } from "react";
import { translateError, createRetryableError } from "./errorTranslator";
import { useNotifications } from "@/components/notifications";

interface FetchOptions extends RequestInit {
  retries?: number;
  retryDelay?: number;
}

interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export function useApiCall<T = unknown>() {
  const [state, setState] = useState<ApiState<T>>({
    data: null,
    loading: false,
    error: null,
  });
  const { toast } = useNotifications();

  const fetchWithRetry = useCallback(
    async (url: string, options: FetchOptions = {}) => {
      const { retries = 3, retryDelay = 1000, ...fetchOptions } = options;
      let lastError: unknown;

      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          setState((prev) => ({ ...prev, loading: true, error: null }));

          const response = await fetch(url, fetchOptions);

          if (!response.ok) {
            throw response;
          }

          const data = await response.json();
          setState((prev) => ({ ...prev, data, loading: false, error: null }));
          return data;
        } catch (error) {
          lastError = error;

          const isRetryable = createRetryableError(error);
          const isLastAttempt = attempt === retries;

          if (!isRetryable || isLastAttempt) {
            const errorInfo = translateError(error);
            setState((prev) => ({
              ...prev,
              loading: false,
              error: errorInfo.message,
            }));
            toast("error", errorInfo.title, errorInfo.message);
            throw error;
          }

          const delay = retryDelay * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      throw lastError;
    },
    [toast]
  );

  const reset = useCallback(() => {
    setState({ data: null, loading: false, error: null });
  }, []);

  return { ...state, fetchWithRetry, reset };
}
