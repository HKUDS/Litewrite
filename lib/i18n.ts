"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

// Locale type
export type Locale = "zh" | "en";

// Supported locales
export const locales: Locale[] = ["zh", "en"];
export const defaultLocale: Locale = "en";

// Locale name mapping
export const localeNames: Record<Locale, string> = {
  zh: "Chinese",
  en: "English",
};

// Translation messages type
type Messages = Record<string, unknown>;

// Context type
interface I18nContextType {
  locale: Locale;
  messages: Messages;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

// Create context
const I18nContext = createContext<I18nContextType | null>(null);

// Get value from a nested object
function getNestedValue(obj: unknown, path: string): string | undefined {
  const keys = path.split(".");
  let current: unknown = obj;

  for (const key of keys) {
    if (current && typeof current === "object" && key in current) {
      current = (current as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }

  return typeof current === "string" ? current : undefined;
}

// Provider component
interface I18nProviderProps {
  children: React.ReactNode;
  initialLocale?: Locale;
}

// Preloaded translations
const messagesCache: Record<Locale, Messages | null> = {
  zh: null,
  en: null,
};

// Get initial locale from localStorage
function getInitialLocale(initialLocale?: Locale): Locale {
  if (typeof window !== "undefined") {
    const savedLocale = localStorage.getItem("litewrite-locale") as Locale | null;
    if (savedLocale && locales.includes(savedLocale)) {
      return savedLocale;
    }
  }
  return initialLocale || defaultLocale;
}

export function I18nProvider({ children, initialLocale }: I18nProviderProps) {
  // Use localStorage value as initial state to avoid race conditions
  const [locale, setLocaleState] = useState<Locale>(() => getInitialLocale(initialLocale));
  const [messages, setMessages] = useState<Messages>({});
  const [isLoading, setIsLoading] = useState(true);

  // Load translations
  useEffect(() => {
    let isMounted = true;

    const loadMessages = async () => {
      setIsLoading(true);
      try {
        if (!messagesCache[locale]) {
          const langModule = await import(`@/messages/${locale}.json`);
          messagesCache[locale] = langModule.default;
        }
        // Only update state if the component is still mounted
        if (isMounted) {
          setMessages(messagesCache[locale] || {});
        }
      } catch (e) {
        console.error(`Failed to load messages for locale: ${locale}`, e);
        if (isMounted) {
          setMessages({});
        }
      }
      if (isMounted) {
        setIsLoading(false);
      }
    };

    loadMessages();

    return () => {
      isMounted = false;
    };
  }, [locale]);

  // Switch locale
  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    if (typeof window !== "undefined") {
      localStorage.setItem("litewrite-locale", newLocale);
    }
  }, []);

  // Translation function
  const t = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      let text = getNestedValue(messages, key);

      if (!text) {
        // Handle silently to avoid spamming the console
        return key;
      }

      // Replace parameters
      if (params) {
        Object.entries(params).forEach(([param, value]) => {
          text = text!.replace(new RegExp(`\\{${param}\\}`, "g"), String(value));
        });
      }

      return text;
    },
    [messages]
  );

  // Render
  return React.createElement(
    I18nContext.Provider,
    { value: { locale, messages, setLocale, t } },
    isLoading ? null : children
  );
}

// Hook
export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return context;
}

// Simplified translation hook
export function useTranslations(namespace?: string) {
  const { t, locale } = useI18n();

  const translate = useCallback(
    (key: string, params?: Record<string, string | number>) => {
      const fullKey = namespace ? `${namespace}.${key}` : key;
      return t(fullKey, params);
    },
    [t, namespace]
  );

  return { t: translate, locale };
}
