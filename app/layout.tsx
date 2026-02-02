import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { I18nProvider } from "@/lib/i18n";
import { ThemeProvider, themeScript } from "@/lib/theme";
import { SessionProvider } from "@/components/providers/session-provider";
import { UserSettingsProvider } from "@/lib/hooks/use-user-settings";

const inter = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Litewrite - Write in Vibe",
  description: "A modern online LaTeX writing and real-time collaboration platform.",
  icons: {
    icon: "/logo.svg",
    apple: "/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* Inject theme script to avoid FOUC */}
        <script
          dangerouslySetInnerHTML={{ __html: themeScript }}
        />
      </head>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} antialiased`}
      >
        <SessionProvider>
          <UserSettingsProvider>
            <ThemeProvider>
              <I18nProvider>
                {children}
                <Toaster />
              </I18nProvider>
            </ThemeProvider>
          </UserSettingsProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
