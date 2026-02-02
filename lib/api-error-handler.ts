/**
 * Frontend API error handling utilities.
 *
 * Converts API error codes into translated, user-friendly messages.
 */

type TranslateFunction = (key: string, params?: Record<string, string | number>) => string;

/**
 * API error response type.
 */
export interface ApiErrorResponse {
  error: {
    code: string;
    [key: string]: unknown;
  } | string;
}

/**
 * Get a translated error message from an API response.
 *
 * @param response API response payload
 * @param t Translation function (the `t` returned by useTranslations)
 * @param fallbackKey Fallback translation key when the error code is missing
 * @returns Translated error message
 *
 * @example
 * ```tsx
 * const { t } = useTranslations();
 *
 * try {
 *   const response = await fetch('/api/auth/register', { ... });
 *   const data = await response.json();
 *
 *   if (!response.ok) {
 *     const errorMessage = getApiErrorMessage(data, t);
 *     setError(errorMessage);
 *   }
 * } catch {
 *   setError(t('common.error'));
 * }
 * ```
 */
export function getApiErrorMessage(
  response: ApiErrorResponse | unknown,
  t: TranslateFunction,
  fallbackKey: string = "common.error"
): string {
  // Handle empty response
  if (!response) {
    return t(fallbackKey);
  }

  // Type assertion
  const errorResponse = response as ApiErrorResponse;

  // Handle the new format: { error: { code: "auth.emailRequired" } }
  if (
    errorResponse.error &&
    typeof errorResponse.error === "object" &&
    "code" in errorResponse.error
  ) {
    const code = errorResponse.error.code;
    const translationKey = `apiErrors.${code}`;
    const translated = t(translationKey);

    // If the translation key does not exist, return fallback message
    if (translated === translationKey) {
      console.warn(`Missing translation for API error code: ${code}`);
      // Prefer server-provided message if present
      const message = (errorResponse.error as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) {
        return message;
      }
      return t(fallbackKey);
    }

    return translated;
  }

  // Handle the legacy format: { error: "some error message" }
  // Return it directly, but this format should be gradually replaced
  if (typeof errorResponse.error === "string") {
    // Try to keep backward compatibility by returning legacy messages as-is
    return errorResponse.error;
  }

  return t(fallbackKey);
}

/**
 * Check whether a response is an API error.
 */
export function isApiError(response: unknown): response is ApiErrorResponse {
  return (
    response !== null &&
    typeof response === "object" &&
    "error" in response
  );
}

/**
 * Get API error code (if present).
 */
export function getApiErrorCode(response: unknown): string | null {
  if (!isApiError(response)) {
    return null;
  }

  if (
    typeof response.error === "object" &&
    response.error !== null &&
    "code" in response.error
  ) {
    return response.error.code as string;
  }

  return null;
}

/**
 * Create a normalized fetch error handler.
 *
 * @example
 * ```tsx
 * const { t } = useTranslations();
 * const handleError = createApiErrorHandler(t);
 *
 * try {
 *   const response = await fetch('/api/...');
 *   const data = await response.json();
 *
 *   if (!response.ok) {
 *     throw handleError(data);
 *   }
 * } catch (error) {
 *   if (error instanceof ApiError) {
 *     setError(error.message);
 *   }
 * }
 * ```
 */
export function createApiErrorHandler(t: TranslateFunction) {
  return (response: unknown): ApiError => {
    const message = getApiErrorMessage(response, t);
    const code = getApiErrorCode(response);
    return new ApiError(message, code);
  };
}

/**
 * Custom API error class.
 */
export class ApiError extends Error {
  public readonly code: string | null;

  constructor(message: string, code: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}
