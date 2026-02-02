"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

// Theme type
export type Theme = "light" | "dark" | "system";

// Supported themes
export const themes: Theme[] = ["light", "dark", "system"];

// Theme icon mapping
export const themeIcons = {
  light: "Sun",
  dark: "Moon",
  system: "Monitor",
} as const;

// Context type
interface ThemeContextType {
  theme: Theme;
  resolvedTheme: "light" | "dark";
  setTheme: (theme: Theme) => void;
}

// Create context
const ThemeContext = createContext<ThemeContextType | null>(null);

// Storage key
const STORAGE_KEY = "litewrite-theme";

// Get system theme
function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

// Apply theme to DOM
function applyTheme(theme: "light" | "dark") {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(theme);
}

// Provider component
interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: Theme;
}

export function ThemeProvider({ children, defaultTheme = "light" }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(defaultTheme);
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("light");
  const [mounted, setMounted] = useState(false);

  // Initialize theme
  useEffect(() => {
    setMounted(true);

    // Read saved theme from localStorage
    const savedTheme = localStorage.getItem(STORAGE_KEY) as Theme | null;
    if (savedTheme && themes.includes(savedTheme)) {
      setThemeState(savedTheme);
    }
  }, []);

  // Resolve and apply theme
  useEffect(() => {
    if (!mounted) return;

    const resolved = theme === "system" ? getSystemTheme() : theme;
    setResolvedTheme(resolved);
    applyTheme(resolved);
  }, [theme, mounted]);

  // Listen for system theme changes
  useEffect(() => {
    if (!mounted || theme !== "system") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const handleChange = (e: MediaQueryListEvent) => {
      const newTheme = e.matches ? "dark" : "light";
      setResolvedTheme(newTheme);
      applyTheme(newTheme);
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [theme, mounted]);

  // Set theme
  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem(STORAGE_KEY, newTheme);
  }, []);

  // Prevent hydration mismatch: don't render until mounted
  if (!mounted) {
    return null;
  }

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

// Hook
export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}

// Script injected into head to avoid FOUC
export const themeScript = `
(function() {
  const storageKey = '${STORAGE_KEY}';
  const theme = localStorage.getItem(storageKey);

  function getSystemTheme() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  // Default to light unless the user explicitly chose another theme
  let resolvedTheme = 'light';
  if (theme === 'dark') {
    resolvedTheme = 'dark';
  } else if (theme === 'system') {
    resolvedTheme = getSystemTheme();
  }
  document.documentElement.classList.add(resolvedTheme);
})();
`;
