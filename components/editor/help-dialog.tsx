"use client";

import { useState, useEffect } from "react";
import {
  Book,
  MessageCircleQuestion,
  Keyboard,
  FileText,
  ExternalLink,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/lib/i18n";

type HelpTab = "getting-started" | "faq" | "shortcuts" | "latex";

interface HelpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function HelpDialog({ open, onOpenChange }: HelpDialogProps) {
  const [activeTab, setActiveTab] = useState<HelpTab>("getting-started");
  const { t } = useTranslations("helpDialog");

  const tabs = [
    { id: "getting-started" as const, label: t("tabs.gettingStarted"), icon: Book },
    { id: "faq" as const, label: t("tabs.faq"), icon: MessageCircleQuestion },
    { id: "shortcuts" as const, label: t("tabs.shortcuts"), icon: Keyboard },
    { id: "latex" as const, label: t("tabs.latex"), icon: FileText },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-0 max-h-[80vh]">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-[400px] max-h-[60vh]">
          {/* Left navigation */}
          <div className="w-44 border-r bg-muted/30 p-2 shrink-0">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                  activeTab === tab.id
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                )}
                onClick={() => setActiveTab(tab.id)}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </button>
            ))}
          </div>

          {/* Right content */}
          <ScrollArea className="flex-1 p-6">
            {activeTab === "getting-started" && <GettingStartedContent />}
            {activeTab === "faq" && <FAQContent />}
            {activeTab === "shortcuts" && <ShortcutsContent />}
            {activeTab === "latex" && <LaTeXGuideContent />}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Getting started content
function GettingStartedContent() {
  const { t } = useTranslations("helpDialog");
  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-lg font-semibold mb-3">{t("gettingStarted.welcomeTitle")}</h3>
        <p className="text-sm text-muted-foreground mb-4">
          {t("gettingStarted.intro")}
        </p>
      </section>

      <section>
        <h4 className="font-medium mb-2">{t("gettingStarted.startWritingTitle")}</h4>
        <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
          <li>{t("gettingStarted.startWritingSteps.selectFile")}</li>
          <li>{t("gettingStarted.startWritingSteps.writeLatex")}</li>
          <li>
            {t("gettingStarted.startWritingSteps.saveCompilePrefix")}{" "}
            <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs">Ctrl+S</kbd>{" "}
            {t("gettingStarted.startWritingSteps.saveCompileSuffix")}
          </li>
          <li>{t("gettingStarted.startWritingSteps.previewPdf")}</li>
        </ol>
      </section>

      <section>
        <h4 className="font-medium mb-2">{t("gettingStarted.inviteTitle")}</h4>
        <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
          <li>{t("gettingStarted.inviteSteps.clickShare")}</li>
          <li>{t("gettingStarted.inviteSteps.generateLink")}</li>
          <li>{t("gettingStarted.inviteSteps.realTime")}</li>
        </ol>
      </section>

      <section>
        <h4 className="font-medium mb-2">{t("gettingStarted.chatTitle")}</h4>
        <p className="text-sm text-muted-foreground">
          {t("gettingStarted.chatText")}
        </p>
      </section>
    </div>
  );
}

// FAQ content
function FAQContent() {
  const { t } = useTranslations("helpDialog");
  const faqs = [
    {
      q: t("faq.uploadImages.q"),
      a: t("faq.uploadImages.a"),
    },
    {
      q: t("faq.compileFailed.q"),
      a: t("faq.compileFailed.a"),
    },
    {
      q: t("faq.chinese.q"),
      a: t("faq.chinese.a"),
    },
    {
      q: t("faq.bibliography.q"),
      a: t("faq.bibliography.a"),
    },
    {
      q: t("faq.conflicts.q"),
      a: t("faq.conflicts.a"),
    },
    {
      q: t("faq.downloadPdf.q"),
      a: t("faq.downloadPdf.a"),
    },
  ];

  return (
    <div className="space-y-4">
      {faqs.map((faq, index) => (
        <div key={index} className="rounded-lg border p-4">
          <h4 className="font-medium mb-2">{faq.q}</h4>
          <p className="text-sm text-muted-foreground">{faq.a}</p>
        </div>
      ))}
    </div>
  );
}

// Shortcuts content
function ShortcutsContent() {
  const { t } = useTranslations("helpDialog");
  const shortcuts = [
    { category: t("shortcuts.categories.editing"), items: [
      { keys: "Ctrl+S / ⌘S", action: t("shortcuts.actions.saveCompile") },
      { keys: "Ctrl+Z / ⌘Z", action: t("shortcuts.actions.undo") },
      { keys: "Ctrl+Shift+Z / ⌘⇧Z", action: t("shortcuts.actions.redo") },
      { keys: "Ctrl+F / ⌘F", action: t("shortcuts.actions.find") },
      { keys: "Ctrl+H / ⌘H", action: t("shortcuts.actions.findReplace") },
      { keys: "Ctrl+A / ⌘A", action: t("shortcuts.actions.selectAll") },
    ]},
    { category: t("shortcuts.categories.formatting"), items: [
      { keys: "Ctrl+B / ⌘B", action: t("shortcuts.actions.bold") },
      { keys: "Ctrl+I / ⌘I", action: t("shortcuts.actions.italic") },
      { keys: "Tab", action: t("shortcuts.actions.indent") },
      { keys: "Shift+Tab", action: t("shortcuts.actions.outdent") },
    ]},
    { category: t("shortcuts.categories.view"), items: [
      { keys: "Ctrl+\\ / ⌘\\", action: t("shortcuts.actions.toggleSidebar") },
      { keys: "Ctrl+Shift+P / ⌘⇧P", action: t("shortcuts.actions.togglePdfPreview") },
    ]},
  ];

  return (
    <div className="space-y-6">
      {shortcuts.map((group) => (
        <section key={group.category}>
          <h4 className="font-medium mb-3">{group.category}</h4>
          <div className="space-y-2">
            {group.items.map((item, index) => (
              <div key={index} className="flex justify-between items-center py-1">
                <span className="text-sm text-muted-foreground">{item.action}</span>
                <kbd className="px-2 py-1 bg-muted rounded text-xs font-mono">
                  {item.keys}
                </kbd>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// LaTeX guide content
function LaTeXGuideContent() {
  const { t } = useTranslations("helpDialog");
  return (
    <div className="space-y-6">
      <section>
        <h4 className="font-medium mb-3">{t("latexGuide.basicStructure")}</h4>
        <pre className="bg-muted p-3 rounded-md text-xs overflow-x-auto">
{`\\documentclass{article}
\\usepackage[utf8]{inputenc}

\\title{My Document}
\\author{Your Name}
\\date{\\today}

\\begin{document}
\\maketitle

Your content here...

\\end{document}`}
        </pre>
      </section>

      <section>
        <h4 className="font-medium mb-3">{t("latexGuide.commonCommands")}</h4>
        <div className="space-y-2 text-sm">
          <div className="flex gap-4">
            <code className="bg-muted px-2 py-1 rounded">\\textbf{"{text}"}</code>
            <span className="text-muted-foreground">{t("latexGuide.commandLabels.bold")}</span>
          </div>
          <div className="flex gap-4">
            <code className="bg-muted px-2 py-1 rounded">\\textit{"{text}"}</code>
            <span className="text-muted-foreground">{t("latexGuide.commandLabels.italic")}</span>
          </div>
          <div className="flex gap-4">
            <code className="bg-muted px-2 py-1 rounded">\\section{"{title}"}</code>
            <span className="text-muted-foreground">{t("latexGuide.commandLabels.section")}</span>
          </div>
          <div className="flex gap-4">
            <code className="bg-muted px-2 py-1 rounded">\\includegraphics{"{file}"}</code>
            <span className="text-muted-foreground">{t("latexGuide.commandLabels.includegraphics")}</span>
          </div>
        </div>
      </section>

      <section>
        <h4 className="font-medium mb-3">{t("latexGuide.moreResources")}</h4>
        <div className="space-y-2">
          <Button variant="link" className="h-auto p-0 text-sm" asChild>
            <a href="https://www.overleaf.com/learn" target="_blank" rel="noopener noreferrer">
              {t("latexGuide.links.overleaf")} <ExternalLink className="ml-1 h-3 w-3" />
            </a>
          </Button>
          <br />
          <Button variant="link" className="h-auto p-0 text-sm" asChild>
            <a href="https://www.latex-project.org/help/documentation/" target="_blank" rel="noopener noreferrer">
              {t("latexGuide.links.official")} <ExternalLink className="ml-1 h-3 w-3" />
            </a>
          </Button>
        </div>
      </section>
    </div>
  );
}
