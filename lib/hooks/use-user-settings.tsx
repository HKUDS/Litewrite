"use client";

import { useState, useEffect, useCallback, createContext, useContext, ReactNode } from "react";

// User settings stored on the server
export interface ServerSettings {
  autoComplete: boolean;
  autoCloseBrackets: boolean;
  keybindings: string;
  spellcheck: boolean;
  spellcheckLang: string;
  compiler: string;
  autoSaveVersion: boolean;
  pdfViewer: string;
  theme: string;
  fontSize: number;
  codeCheck: boolean;
}

// Local settings stored in localStorage
export interface LocalSettings {
  language: string;
  fontFamily: string;
}

// Full user settings type
export interface UserSettings extends ServerSettings, LocalSettings {}

// Default server-side settings
const defaultServerSettings: ServerSettings = {
  autoComplete: true,
  autoCloseBrackets: true,
  keybindings: "none",
  spellcheck: false,
  spellcheckLang: "en",
  compiler: "pdflatex",
  autoSaveVersion: true,
  pdfViewer: "litewrite",
  theme: "system",
  fontSize: 14,
  codeCheck: false,
};

// Default local settings
const defaultLocalSettings: LocalSettings = {
  language: "en",
  fontFamily: "jetbrains",
};

// Default full settings
const defaultSettings: UserSettings = {
  ...defaultServerSettings,
  ...defaultLocalSettings,
};

// Local settings key
const LOCAL_SETTINGS_KEY = "litewrite-local-settings";

// Read local settings
function getLocalSettings(): LocalSettings {
  if (typeof window === "undefined") return defaultLocalSettings;
  try {
    const stored = localStorage.getItem(LOCAL_SETTINGS_KEY);
    if (stored) {
      return { ...defaultLocalSettings, ...JSON.parse(stored) };
    }
  } catch {
    // ignore
  }
  return defaultLocalSettings;
}

// Persist local settings
function saveLocalSettings(settings: Partial<LocalSettings>) {
  if (typeof window === "undefined") return;
  try {
    const current = getLocalSettings();
    localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify({ ...current, ...settings }));
  } catch {
    // ignore
  }
}

interface UserSettingsContextValue {
  settings: UserSettings;
  isLoading: boolean;
  updateSettings: (updates: Partial<UserSettings>) => Promise<void>;
  refreshSettings: () => Promise<void>;
}

const UserSettingsContext = createContext<UserSettingsContextValue | null>(null);

// Provider component
export function UserSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<UserSettings>(() => ({
    ...defaultServerSettings,
    ...getLocalSettings(),
  }));
  const [isLoading, setIsLoading] = useState(true);

  // Load settings
  const loadSettings = useCallback(async () => {
    try {
      const response = await fetch("/api/user/settings");
      if (response.ok) {
        const data = await response.json();
        // Merge server settings with local settings
        const localSettings = getLocalSettings();
        setSettings({ ...defaultServerSettings, ...data.settings, ...localSettings });
      }
    } catch (error) {
      console.error("Failed to load settings:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Update settings
  const updateSettings = useCallback(async (updates: Partial<UserSettings>) => {
    // Split server settings from local settings
    const localUpdates: Partial<LocalSettings> = {};
    const serverUpdates: Partial<ServerSettings> = {};

    for (const [key, value] of Object.entries(updates)) {
      if (key === "language" || key === "fontFamily") {
        localUpdates[key as keyof LocalSettings] = value as string;
      } else {
        serverUpdates[key as keyof ServerSettings] = value as never;
      }
    }

    // Update local settings
    if (Object.keys(localUpdates).length > 0) {
      saveLocalSettings(localUpdates);
      setSettings((prev) => ({ ...prev, ...localUpdates }));
    }

    // Update server settings
    if (Object.keys(serverUpdates).length > 0) {
      // Optimistic update
      setSettings((prev) => ({ ...prev, ...serverUpdates }));

      try {
        const response = await fetch("/api/user/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(serverUpdates),
        });

        if (!response.ok) {
          // Roll back server settings
          await loadSettings();
          throw new Error("Failed to update settings");
        }

        const data = await response.json();
        const localSettings = getLocalSettings();
        setSettings({ ...defaultServerSettings, ...data.settings, ...localSettings });
      } catch (error) {
        console.error("Failed to update settings:", error);
        throw error;
      }
    }
  }, [loadSettings]);

  // Refresh settings
  const refreshSettings = useCallback(async () => {
    await loadSettings();
  }, [loadSettings]);

  // Initial load
  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  return (
    <UserSettingsContext.Provider value={{ settings, isLoading, updateSettings, refreshSettings }}>
      {children}
    </UserSettingsContext.Provider>
  );
}

// Hook to use settings
export function useUserSettings(): UserSettingsContextValue {
  const context = useContext(UserSettingsContext);

  // If there is no Provider, use an isolated state (backward compatibility)
  const [fallbackSettings, setFallbackSettings] = useState<UserSettings>(() => ({
    ...defaultServerSettings,
    ...getLocalSettings(),
  }));
  const [fallbackLoading, setFallbackLoading] = useState(true);

  const loadFallbackSettings = useCallback(async () => {
    try {
      const response = await fetch("/api/user/settings");
      if (response.ok) {
        const data = await response.json();
        const localSettings = getLocalSettings();
        setFallbackSettings({ ...defaultServerSettings, ...data.settings, ...localSettings });
      }
    } catch (error) {
      console.error("Failed to load settings:", error);
    } finally {
      setFallbackLoading(false);
    }
  }, []);

  const updateFallbackSettings = useCallback(async (updates: Partial<UserSettings>) => {
    const localUpdates: Partial<LocalSettings> = {};
    const serverUpdates: Partial<ServerSettings> = {};

    for (const [key, value] of Object.entries(updates)) {
      if (key === "language" || key === "fontFamily") {
        localUpdates[key as keyof LocalSettings] = value as string;
      } else {
        serverUpdates[key as keyof ServerSettings] = value as never;
      }
    }

    if (Object.keys(localUpdates).length > 0) {
      saveLocalSettings(localUpdates);
      setFallbackSettings((prev) => ({ ...prev, ...localUpdates }));
    }

    if (Object.keys(serverUpdates).length > 0) {
      setFallbackSettings((prev) => ({ ...prev, ...serverUpdates }));

      try {
        const response = await fetch("/api/user/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(serverUpdates),
        });

        if (!response.ok) {
          await loadFallbackSettings();
          throw new Error("Failed to update settings");
        }

        const data = await response.json();
        const localSettings = getLocalSettings();
        setFallbackSettings({ ...defaultServerSettings, ...data.settings, ...localSettings });
      } catch (error) {
        console.error("Failed to update settings:", error);
        throw error;
      }
    }
  }, [loadFallbackSettings]);

  useEffect(() => {
    if (!context) {
      loadFallbackSettings();
    }
  }, [context, loadFallbackSettings]);

  if (context) {
    return context;
  }

  return {
    settings: fallbackSettings,
    isLoading: fallbackLoading,
    updateSettings: updateFallbackSettings,
    refreshSettings: loadFallbackSettings,
  };
}
