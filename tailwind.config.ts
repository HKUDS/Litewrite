import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar))",
          foreground: "hsl(var(--sidebar-foreground))",
          border: "hsl(var(--sidebar-border))",
        },
        // Glassmorphism colors
        glass: {
          DEFAULT: "var(--glass-bg)",
          border: "var(--glass-border)",
          hover: "var(--glass-hover)",
        },
        // Litewrite brand colors - elegant, subdued palette (lower saturation)
        litewrite: {
          blue: {
            light: "#9ecfe8",
            DEFAULT: "#5a9fc8",
            dark: "#3d7f9e",
          },
          cyan: {
            light: "#6ac5d6",
            DEFAULT: "#4da8bc",
            dark: "#4295a8",
          },
          teal: {
            light: "#a8ddd2",
            DEFAULT: "#72cfc2",
            dark: "#5bbfc0",
          },
          mint: {
            light: "#a6dde0",
            DEFAULT: "#8ed4da",
            dark: "#85cdd2",
          },
          warm: {
            light: "#f5d0a0",
            DEFAULT: "#e8a87a",
            dark: "#d89468",
          },
        },
        // AI gradient colors - more subdued purple tones
        ai: {
          purple: "#9580e8",
          indigo: "#7078e0",
          blue: "#5558d8",
        },
      },
      // Gradient backgrounds - softer and more elegant
      backgroundImage: {
        "gradient-primary": "linear-gradient(135deg, #5a9fc8 0%, #4da8bc 50%, #72cfc2 100%)",
        "gradient-ai": "linear-gradient(135deg, #9580e8 0%, #7078e0 50%, #5558d8 100%)",
        "gradient-warm": "linear-gradient(135deg, #f5d0a0 0%, #e8a87a 100%)",
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-conic": "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
        "shimmer": "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.3) 50%, transparent 100%)",
      },
      // Glass blur
      backdropBlur: {
        xs: "2px",
        "2xl": "40px",
        "3xl": "64px",
      },
      // Shadows - softer and more refined
      boxShadow: {
        "glass": "0 8px 32px rgba(0, 0, 0, 0.06)",
        "glass-lg": "0 16px 48px rgba(0, 0, 0, 0.1)",
        "glow": "0 0 24px rgba(77, 168, 188, 0.25)",
        "glow-lg": "0 0 40px rgba(77, 168, 188, 0.35)",
        "glow-ai": "0 0 24px rgba(112, 120, 224, 0.25)",
        "inner-glow": "inset 0 0 20px rgba(255, 255, 255, 0.08)",
        // iOS-style multi-layer shadow system — adds depth and texture
        "elevation-1": "0 1px 2px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.08)",
        "elevation-2": "0 2px 4px rgba(0,0,0,0.04), 0 4px 8px rgba(0,0,0,0.08)",
        "elevation-3": "0 4px 8px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.12)",
        "elevation-4": "0 8px 16px rgba(0,0,0,0.06), 0 16px 32px rgba(0,0,0,0.12)",
        // Button shadows
        "btn": "0 1px 2px rgba(0,0,0,0.05), 0 2px 4px rgba(0,0,0,0.05)",
        "btn-hover": "0 2px 4px rgba(0,0,0,0.06), 0 4px 8px rgba(0,0,0,0.08)",
        "btn-active": "0 1px 1px rgba(0,0,0,0.04)",
        // Input inset shadows
        "input-inset": "inset 0 1px 2px rgba(0,0,0,0.05)",
        "input-focus": "inset 0 1px 2px rgba(0,0,0,0.03), 0 0 0 3px rgba(85, 179, 202, 0.15)",
      },
      // Spring-like easing curves
      transitionTimingFunction: {
        "spring": "cubic-bezier(0.34, 1.56, 0.64, 1)",
        "spring-gentle": "cubic-bezier(0.25, 1.15, 0.5, 1)",
        "out-expo": "cubic-bezier(0.19, 1, 0.22, 1)",
        "in-out-emphasis": "cubic-bezier(0.4, 0, 0.2, 1)",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)"],
        mono: ["var(--font-geist-mono)"],
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "fade-in-up": {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in-down": {
          from: { opacity: "0", transform: "translateY(-10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in-left": {
          from: { transform: "translateX(-100%)" },
          to: { transform: "translateX(0)" },
        },
        "slide-in-right": {
          from: { transform: "translateX(100%)" },
          to: { transform: "translateX(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.95)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        pulse: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
        // Button shimmer
        "btn-shimmer": {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
        // Button glow
        "btn-glow": {
          "0%, 100%": { boxShadow: "0 0 20px rgba(85, 179, 202, 0.3)" },
          "50%": { boxShadow: "0 0 30px rgba(85, 179, 202, 0.5)" },
        },
        // Subtle bounce
        "btn-bounce": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-2px)" },
        },
        // Floating
        "float": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },
        // Blob movement
        "blob": {
          "0%": { transform: "translate(0px, 0px) scale(1)" },
          "33%": { transform: "translate(30px, -50px) scale(1.1)" },
          "66%": { transform: "translate(-20px, 20px) scale(0.9)" },
          "100%": { transform: "translate(0px, 0px) scale(1)" },
        },
        // Rotating gradient border
        "border-rotate": {
          "0%": { backgroundPosition: "0% 50%" },
          "50%": { backgroundPosition: "100% 50%" },
          "100%": { backgroundPosition: "0% 50%" },
        },
        // AI pulse
        "ai-pulse": {
          "0%, 100%": { boxShadow: "0 0 20px rgba(129, 140, 248, 0.3)" },
          "50%": { boxShadow: "0 0 35px rgba(129, 140, 248, 0.6)" },
        },
        // Typewriter (for AI)
        "typewriter": {
          from: { width: "0" },
          to: { width: "100%" },
        },
        // Breathing glow
        "breathe": {
          "0%, 100%": { opacity: "0.6" },
          "50%": { opacity: "1" },
        },
        // Card hover
        "card-hover": {
          "0%": { transform: "translateY(0)" },
          "100%": { transform: "translateY(-4px)" },
        },
        // iOS-style dialog enter — spring overshoot (scale/opacity only; translate handled by CSS classes)
        "dialog-in": {
          "0%": { opacity: "0", transform: "translate(-50%, -50%) scale(0.96)" },
          "60%": { opacity: "1", transform: "translate(-50%, -50%) scale(1.02)" },
          "100%": { opacity: "1", transform: "translate(-50%, -50%) scale(1)" },
        },
        "dialog-out": {
          "0%": { opacity: "1", transform: "translate(-50%, -50%) scale(1)" },
          "100%": { opacity: "0", transform: "translate(-50%, -50%) scale(0.96)" },
        },
        // iOS-style dropdown enter
        "dropdown-in": {
          "0%": { opacity: "0", transform: "scale(0.96) translateY(-4px)" },
          "60%": { opacity: "1", transform: "scale(1.01) translateY(0)" },
          "100%": { opacity: "1", transform: "scale(1) translateY(0)" },
        },
        "dropdown-out": {
          "0%": { opacity: "1", transform: "scale(1)" },
          "100%": { opacity: "0", transform: "scale(0.97)" },
        },
        // Overlay fade in
        "overlay-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "overlay-out": {
          "0%": { opacity: "1" },
          "100%": { opacity: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.3s ease-out",
        "fade-in-up": "fade-in-up 0.4s ease-out",
        "fade-in-down": "fade-in-down 0.4s ease-out",
        "slide-in-left": "slide-in-left 0.3s ease-out",
        "slide-in-right": "slide-in-right 0.3s ease-out",
        "scale-in": "scale-in 0.2s ease-out",
        pulse: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "btn-shimmer": "btn-shimmer 2s linear infinite",
        "btn-glow": "btn-glow 2s ease-in-out infinite",
        "btn-bounce": "btn-bounce 0.3s ease-out",
        "float": "float 6s ease-in-out infinite",
        "blob": "blob 7s infinite",
        "border-rotate": "border-rotate 4s ease infinite",
        "ai-pulse": "ai-pulse 2s ease-in-out infinite",
        "breathe": "breathe 3s ease-in-out infinite",
        "card-hover": "card-hover 0.3s ease-out forwards",
        // iOS-style animations
        "dialog-in": "dialog-in 250ms cubic-bezier(0.34, 1.56, 0.64, 1)",
        "dialog-out": "dialog-out 150ms ease-out",
        "dropdown-in": "dropdown-in 200ms cubic-bezier(0.34, 1.56, 0.64, 1)",
        "dropdown-out": "dropdown-out 120ms ease-out",
        "overlay-in": "overlay-in 200ms ease-out",
        "overlay-out": "overlay-out 150ms ease-in",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
