"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BookOpen,
  Edit3,
  Sparkles,
  FileText,
  Users,
  FolderOpen,
  History,
  LayoutTemplate,
  Keyboard,
  Menu,
  X,
  Zap,
  MessageSquare,
  Compass,
  Search,
  Upload,
  Download,
  GitBranch,
  FileCode,
  Layers,
  Eye,
  MousePointer,
  Bot,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { LanguageSwitcher } from "@/components/language-switcher";
import { UserMenu } from "@/components/user-menu";
import { useTranslations } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// Section icons mapping
const sectionIcons = {
  quickstart: Zap,
  editor: Edit3,
  aiFeatures: Sparkles,
  pdfPreview: FileText,
  collaboration: Users,
  projectManagement: FolderOpen,
  versionHistory: History,
  templates: LayoutTemplate,
  shortcuts: Keyboard,
};

const sectionIds = [
  "quickstart",
  "editor",
  "aiFeatures",
  "pdfPreview",
  "collaboration",
  "projectManagement",
  "versionHistory",
  "templates",
  "shortcuts",
] as const;

type SectionId = typeof sectionIds[number];

// Helper function to split translation strings by colon
// Handles both ASCII colon (:) and Chinese full-width colon (：)
function splitByColon(str: string): [string, string] {
  const match = str.match(/^(.+?)[:：](.+)$/);
  if (match) {
    return [match[1], match[2]];
  }
  // Fallback: return the whole string as title and empty description
  return [str, ""];
}

export default function DocsPage() {
  const { t } = useTranslations("docs");
  const { t: tSections } = useTranslations("docs.sections");
  const { t: tQuickstart } = useTranslations("docs.quickstart");
  const { t: tEditor } = useTranslations("docs.editor");
  const { t: tAi } = useTranslations("docs.ai");
  const { t: tPdf } = useTranslations("docs.pdf");
  const { t: tCollab } = useTranslations("docs.collab");
  const { t: tProject } = useTranslations("docs.project");
  const { t: tVersion } = useTranslations("docs.version");
  const { t: tTemplates } = useTranslations("docs.templates");
  const { t: tShortcuts } = useTranslations("docs.shortcuts");

  const [activeSection, setActiveSection] = useState<SectionId>("quickstart");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Listen to scroll to update active section
  useEffect(() => {
    const handleScroll = () => {
      const scrollPosition = window.scrollY + 100;

      for (const sectionId of sectionIds) {
        const element = document.getElementById(sectionId);
        if (element) {
          const { offsetTop, offsetHeight } = element;
          if (scrollPosition >= offsetTop && scrollPosition < offsetTop + offsetHeight) {
            setActiveSection(sectionId);
            break;
          }
        }
      }
    };

    window.addEventListener("scroll", handleScroll);
    // Sync initial state with current scroll position (e.g. refresh while scrolled, or direct hash navigation)
    handleScroll();
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToSection = (id: SectionId) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
      setMobileMenuOpen(false);
    }
  };

  // Shortcut data
  const shortcuts = [
    { category: tShortcuts("editing"), keys: [
      { key: "Ctrl/Cmd + B", desc: tShortcuts("bold") },
      { key: "Ctrl/Cmd + I", desc: tShortcuts("italic") },
      { key: "Ctrl/Cmd + U", desc: tShortcuts("underline") },
      { key: "Ctrl/Cmd + Z", desc: tShortcuts("undo") },
      { key: "Ctrl/Cmd + Shift + Z", desc: tShortcuts("redo") },
      { key: "Tab", desc: tShortcuts("acceptTap") },
      { key: "Escape", desc: tShortcuts("dismissTap") },
    ]},
    { category: tShortcuts("search"), keys: [
      { key: "Ctrl/Cmd + F", desc: tShortcuts("find") },
      { key: "Ctrl/Cmd + H", desc: tShortcuts("findReplace") },
      { key: "Enter", desc: tShortcuts("nextMatch") },
      { key: "Shift + Enter", desc: tShortcuts("prevMatch") },
    ]},
    { category: tShortcuts("pdfPreview"), keys: [
      { key: "Ctrl/Cmd + Click", desc: tShortcuts("forwardSync") },
      { key: "Double-click PDF", desc: tShortcuts("reverseSync") },
    ]},
  ];

  // Template data
  const templateCategories = [
    { name: tTemplates("academic"), desc: tTemplates("academicDesc") },
    { name: tTemplates("thesis"), desc: tTemplates("thesisDesc") },
    { name: tTemplates("cv"), desc: tTemplates("cvDesc") },
    { name: tTemplates("presentation"), desc: tTemplates("presentationDesc") },
    { name: tTemplates("book"), desc: tTemplates("bookDesc") },
    { name: tTemplates("letter"), desc: tTemplates("letterDesc") },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex h-14 items-center justify-between px-6">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="sm" className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                {t("backToHome")}
              </Button>
            </Link>
            <div className="hidden md:flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-litewrite-cyan" />
              <span className="font-semibold">{t("title")}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeSwitcher />
            <LanguageSwitcher />
            <UserMenu />
            {/* Mobile menu button */}
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar - Desktop */}
        <aside className="hidden md:block w-64 shrink-0 border-r bg-muted/30">
          <nav className="sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto p-4">
            <div className="space-y-1">
              {sectionIds.map((sectionId) => {
                const Icon = sectionIcons[sectionId];
                return (
                  <button
                    key={sectionId}
                    onClick={() => scrollToSection(sectionId)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-colors text-left",
                      activeSection === sectionId
                        ? "bg-litewrite-cyan/10 text-litewrite-cyan-dark dark:text-litewrite-cyan font-medium"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {tSections(sectionId)}
                  </button>
                );
              })}
            </div>
          </nav>
        </aside>

        {/* Mobile sidebar */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-40 md:hidden">
            <div className="absolute inset-0 bg-black/50" onClick={() => setMobileMenuOpen(false)} />
            <aside className="absolute left-0 top-14 bottom-0 w-64 bg-background border-r overflow-y-auto">
              <nav className="p-4">
                <div className="space-y-1">
                  {sectionIds.map((sectionId) => {
                    const Icon = sectionIcons[sectionId];
                    return (
                      <button
                        key={sectionId}
                        onClick={() => scrollToSection(sectionId)}
                        className={cn(
                          "w-full flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-colors text-left",
                          activeSection === sectionId
                            ? "bg-litewrite-cyan/10 text-litewrite-cyan-dark dark:text-litewrite-cyan font-medium"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted"
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        {tSections(sectionId)}
                      </button>
                    );
                  })}
                </div>
              </nav>
            </aside>
          </div>
        )}

        {/* Main content */}
        <main className="flex-1 min-w-0">
          <div className="max-w-4xl mx-auto px-6 py-12">

            {/* Quick Start */}
            <section id="quickstart" className="mb-16 scroll-mt-20">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-lg bg-litewrite-cyan/10">
                  <Zap className="h-6 w-6 text-litewrite-cyan" />
                </div>
                <h2 className="text-3xl font-bold">{tQuickstart("title")}</h2>
              </div>

              <div className="prose prose-gray dark:prose-invert max-w-none">
                <p className="text-lg text-muted-foreground">
                  {tQuickstart("intro")}
                </p>

                <div className="grid gap-4 mt-6">
                  <div className="flex gap-4 p-4 rounded-lg border bg-card">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-litewrite-cyan text-white font-bold">1</div>
                    <div>
                      <h4 className="font-semibold mb-1">{tQuickstart("step1Title")}</h4>
                      <p className="text-sm text-muted-foreground">{tQuickstart("step1Desc")}</p>
                    </div>
                  </div>

                  <div className="flex gap-4 p-4 rounded-lg border bg-card">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-litewrite-cyan text-white font-bold">2</div>
                    <div>
                      <h4 className="font-semibold mb-1">{tQuickstart("step2Title")}</h4>
                      <p className="text-sm text-muted-foreground">{tQuickstart("step2Desc")}</p>
                    </div>
                  </div>

                  <div className="flex gap-4 p-4 rounded-lg border bg-card">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-litewrite-cyan text-white font-bold">3</div>
                    <div>
                      <h4 className="font-semibold mb-1">{tQuickstart("step3Title")}</h4>
                      <p className="text-sm text-muted-foreground">{tQuickstart("step3Desc")}</p>
                    </div>
                  </div>

                  <div className="flex gap-4 p-4 rounded-lg border bg-card">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-litewrite-cyan text-white font-bold">4</div>
                    <div>
                      <h4 className="font-semibold mb-1">{tQuickstart("step4Title")}</h4>
                      <p className="text-sm text-muted-foreground">{tQuickstart("step4Desc")}</p>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Editor */}
            <section id="editor" className="mb-16 scroll-mt-20">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-lg bg-litewrite-cyan/10">
                  <Edit3 className="h-6 w-6 text-litewrite-cyan" />
                </div>
                <h2 className="text-3xl font-bold">{tEditor("title")}</h2>
              </div>

              <div className="space-y-8">
                <div>
                  <h3 className="text-xl font-semibold mb-3 flex items-center gap-2">
                    <FileCode className="h-5 w-5 text-muted-foreground" />
                    {tEditor("latexTitle")}
                  </h3>
                  <p className="text-muted-foreground mb-4">
                    {tEditor("latexIntro")}
                  </p>
                  <ul className="list-disc list-inside space-y-2 text-muted-foreground">
                    <li><strong>{splitByColon(tEditor("syntaxHighlight"))[0]}:</strong> {splitByColon(tEditor("syntaxHighlight"))[1]}</li>
                    <li><strong>{splitByColon(tEditor("smartComplete"))[0]}:</strong> {splitByColon(tEditor("smartComplete"))[1]}</li>
                    <li><strong>{splitByColon(tEditor("bracketMatch"))[0]}:</strong> {splitByColon(tEditor("bracketMatch"))[1]}</li>
                    <li><strong>{splitByColon(tEditor("codeFold"))[0]}:</strong> {splitByColon(tEditor("codeFold"))[1]}</li>
                    <li><strong>{splitByColon(tEditor("lineNumbers"))[0]}:</strong> {splitByColon(tEditor("lineNumbers"))[1]}</li>
                    <li><strong>{splitByColon(tEditor("searchReplace"))[0]}:</strong> {splitByColon(tEditor("searchReplace"))[1]}</li>
                  </ul>
                </div>

                <div>
                  <h3 className="text-xl font-semibold mb-3 flex items-center gap-2">
                    <Layers className="h-5 w-5 text-muted-foreground" />
                    {tEditor("markdownTitle")}
                  </h3>
                  <p className="text-muted-foreground mb-4">
                    {tEditor("markdownIntro")}
                  </p>
                  <ul className="list-disc list-inside space-y-2 text-muted-foreground">
                    <li>{tEditor("markdownGfm")}</li>
                    <li>{tEditor("markdownCodeHighlight")}</li>
                    <li>{tEditor("markdownMath")}</li>
                    <li>{tEditor("markdownExtensions")}</li>
                  </ul>
                </div>

                <div>
                  <h3 className="text-xl font-semibold mb-3 flex items-center gap-2">
                    <Search className="h-5 w-5 text-muted-foreground" />
                    {tEditor("citationTitle")}
                  </h3>
                  <p className="text-muted-foreground">
                    {tEditor("citationDesc")}
                  </p>
                </div>
              </div>
            </section>

            {/* AI Features */}
            <section id="aiFeatures" className="mb-16 scroll-mt-20">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-lg bg-ai-purple/10">
                  <Sparkles className="h-6 w-6 text-ai-purple" />
                </div>
                <h2 className="text-3xl font-bold">{tAi("title")}</h2>
              </div>

              <div className="space-y-8">
                <div className="p-6 rounded-xl border bg-gradient-to-br from-litewrite-cyan/5 to-ai-purple/5">
                  <h3 className="text-xl font-semibold mb-3 flex items-center gap-2">
                    <Zap className="h-5 w-5 text-litewrite-cyan" />
                    {tAi("tapTitle")}
                  </h3>
                  <p className="text-muted-foreground mb-4">
                    {tAi("tapDesc")}
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted text-sm">
                      <kbd className="px-1.5 py-0.5 rounded bg-background text-xs">Tab</kbd>
                      <span>{tAi("tapAccept")}</span>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted text-sm">
                      <kbd className="px-1.5 py-0.5 rounded bg-background text-xs">Esc</kbd>
                      <span>{tAi("tapDismiss")}</span>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground mt-3">
                    {tAi("tapNote")}
                  </p>
                </div>

                <div className="grid md:grid-cols-2 gap-6">
                  <div className="p-6 rounded-xl border">
                    <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                      <MessageSquare className="h-5 w-5 text-muted-foreground" />
                      {tAi("askTitle")}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {tAi("askDesc")}
                    </p>
                  </div>

                  <div className="p-6 rounded-xl border">
                    <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                      <Bot className="h-5 w-5 text-muted-foreground" />
                      {tAi("agentTitle")}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {tAi("agentDesc")}
                    </p>
                  </div>
                </div>

                <div className="p-6 rounded-xl border bg-gradient-to-br from-ai-purple/5 to-ai-indigo/5">
                  <h3 className="text-xl font-semibold mb-3 flex items-center gap-2">
                    <Compass className="h-5 w-5 text-ai-purple" />
                    {tAi("deepResearchTitle")}
                  </h3>
                  <p className="text-muted-foreground mb-4">
                    {tAi("deepResearchDesc")}
                  </p>
                  <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
                    <li>{tAi("deepResearch1")}</li>
                    <li>{tAi("deepResearch2")}</li>
                    <li>{tAi("deepResearch3")}</li>
                    <li>{tAi("deepResearch4")}</li>
                  </ol>
                  <p className="text-sm text-muted-foreground mt-4">
                    {tAi("deepResearchNote")}
                  </p>
                </div>
              </div>
            </section>

            {/* PDF Preview */}
            <section id="pdfPreview" className="mb-16 scroll-mt-20">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-lg bg-litewrite-cyan/10">
                  <FileText className="h-6 w-6 text-litewrite-cyan" />
                </div>
                <h2 className="text-3xl font-bold">{tPdf("title")}</h2>
              </div>

              <div className="space-y-6">
                <p className="text-muted-foreground">
                  {tPdf("intro")}
                </p>

                <div className="grid md:grid-cols-2 gap-6">
                  <div className="p-5 rounded-xl border">
                    <h4 className="font-semibold mb-2 flex items-center gap-2">
                      <Eye className="h-4 w-4 text-muted-foreground" />
                      {tPdf("controlsTitle")}
                    </h4>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>• {tPdf("controlZoom")}</li>
                      <li>• {tPdf("controlPage")}</li>
                      <li>• {tPdf("controlCompile")}</li>
                    </ul>
                  </div>

                  <div className="p-5 rounded-xl border">
                    <h4 className="font-semibold mb-2 flex items-center gap-2">
                      <MousePointer className="h-4 w-4 text-muted-foreground" />
                      {tPdf("synctexTitle")}
                    </h4>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>• <strong>{splitByColon(tPdf("synctexForward"))[0]}:</strong> {splitByColon(tPdf("synctexForward"))[1]}</li>
                      <li>• <strong>{splitByColon(tPdf("synctexReverse"))[0]}:</strong> {splitByColon(tPdf("synctexReverse"))[1]}</li>
                    </ul>
                  </div>
                </div>

                <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <p className="text-sm text-amber-700 dark:text-amber-300">
                    <strong>{splitByColon(tPdf("errorTip"))[0]}:</strong> {splitByColon(tPdf("errorTip"))[1]}
                  </p>
                </div>
              </div>
            </section>

            {/* Collaboration */}
            <section id="collaboration" className="mb-16 scroll-mt-20">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-lg bg-litewrite-cyan/10">
                  <Users className="h-6 w-6 text-litewrite-cyan" />
                </div>
                <h2 className="text-3xl font-bold">{tCollab("title")}</h2>
              </div>

              <div className="space-y-6">
                <p className="text-muted-foreground">
                  {tCollab("intro")}
                </p>

                <div className="space-y-4">
                  <div className="p-5 rounded-xl border">
                    <h4 className="font-semibold mb-3">{tCollab("editingTitle")}</h4>
                    <ul className="text-sm text-muted-foreground space-y-2">
                      <li>• {tCollab("editing1")}</li>
                      <li>• {tCollab("editing2")}</li>
                      <li>• {tCollab("editing3")}</li>
                    </ul>
                  </div>

                  <div className="p-5 rounded-xl border">
                    <h4 className="font-semibold mb-3">{tCollab("inviteTitle")}</h4>
                    <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
                      <li>{tCollab("invite1")}</li>
                      <li>{tCollab("invite2")}</li>
                      <li>{tCollab("invite3")}</li>
                    </ol>
                  </div>

                  <div className="p-5 rounded-xl border">
                    <h4 className="font-semibold mb-3">{tCollab("permissionsTitle")}</h4>
                    <ul className="text-sm text-muted-foreground space-y-2">
                      <li>• <strong>{splitByColon(tCollab("permOwner"))[0]}:</strong> {splitByColon(tCollab("permOwner"))[1]}</li>
                      <li>• <strong>{splitByColon(tCollab("permEditor"))[0]}:</strong> {splitByColon(tCollab("permEditor"))[1]}</li>
                      <li>• <strong>{splitByColon(tCollab("permViewer"))[0]}:</strong> {splitByColon(tCollab("permViewer"))[1]}</li>
                    </ul>
                  </div>
                </div>
              </div>
            </section>

            {/* Project Management */}
            <section id="projectManagement" className="mb-16 scroll-mt-20">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-lg bg-litewrite-cyan/10">
                  <FolderOpen className="h-6 w-6 text-litewrite-cyan" />
                </div>
                <h2 className="text-3xl font-bold">{tProject("title")}</h2>
              </div>

              <div className="space-y-8">
                <div>
                  <h3 className="text-xl font-semibold mb-3">{tProject("filesTitle")}</h3>
                  <p className="text-muted-foreground mb-4">
                    {tProject("filesIntro")}
                  </p>
                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="p-4 rounded-lg border">
                      <h4 className="font-medium mb-2 flex items-center gap-2">
                        <Upload className="h-4 w-4" />
                        {tProject("uploadTitle")}
                      </h4>
                      <p className="text-sm text-muted-foreground">
                        {tProject("uploadDesc")}
                      </p>
                    </div>
                    <div className="p-4 rounded-lg border">
                      <h4 className="font-medium mb-2 flex items-center gap-2">
                        <Download className="h-4 w-4" />
                        {tProject("exportTitle")}
                      </h4>
                      <p className="text-sm text-muted-foreground">
                        {tProject("exportDesc")}
                      </p>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-xl font-semibold mb-3">{tProject("importTitle")}</h3>
                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="p-4 rounded-lg border">
                      <h4 className="font-medium mb-2">{tProject("importArxiv")}</h4>
                      <p className="text-sm text-muted-foreground">
                        {tProject("importArxivDesc")}
                      </p>
                    </div>
                    <div className="p-4 rounded-lg border">
                      <h4 className="font-medium mb-2">{tProject("importGithub")}</h4>
                      <p className="text-sm text-muted-foreground">
                        {tProject("importGithubDesc")}
                      </p>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-xl font-semibold mb-3">{tProject("tagsTitle")}</h3>
                  <p className="text-muted-foreground">
                    {tProject("tagsDesc")}
                  </p>
                </div>
              </div>
            </section>

            {/* Version History */}
            <section id="versionHistory" className="mb-16 scroll-mt-20">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-lg bg-litewrite-cyan/10">
                  <History className="h-6 w-6 text-litewrite-cyan" />
                </div>
                <h2 className="text-3xl font-bold">{tVersion("title")}</h2>
              </div>

              <div className="space-y-6">
                <p className="text-muted-foreground">
                  {tVersion("intro")}
                </p>

                <div className="space-y-4">
                  <div className="p-5 rounded-xl border">
                    <h4 className="font-semibold mb-2 flex items-center gap-2">
                      <GitBranch className="h-4 w-4" />
                      {tVersion("createTitle")}
                    </h4>
                    <p className="text-sm text-muted-foreground">
                      {tVersion("createDesc")}
                    </p>
                  </div>

                  <div className="p-5 rounded-xl border">
                    <h4 className="font-semibold mb-2">{tVersion("compareTitle")}</h4>
                    <p className="text-sm text-muted-foreground">
                      {tVersion("compareDesc")}
                    </p>
                  </div>

                  <div className="p-5 rounded-xl border">
                    <h4 className="font-semibold mb-2">{tVersion("restoreTitle")}</h4>
                    <p className="text-sm text-muted-foreground">
                      {tVersion("restoreDesc")}
                    </p>
                  </div>
                </div>
              </div>
            </section>

            {/* Templates */}
            <section id="templates" className="mb-16 scroll-mt-20">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-lg bg-litewrite-cyan/10">
                  <LayoutTemplate className="h-6 w-6 text-litewrite-cyan" />
                </div>
                <h2 className="text-3xl font-bold">{tTemplates("title")}</h2>
              </div>

              <div className="space-y-6">
                <p className="text-muted-foreground">
                  {tTemplates("intro")}
                </p>

                <div className="grid md:grid-cols-3 gap-4">
                  {templateCategories.map((tpl) => (
                    <div key={tpl.name} className="p-4 rounded-lg border">
                      <h4 className="font-medium mb-1">{tpl.name}</h4>
                      <p className="text-sm text-muted-foreground">{tpl.desc}</p>
                    </div>
                  ))}
                </div>

                <div className="p-5 rounded-xl border">
                  <h4 className="font-semibold mb-2">{tTemplates("customTitle")}</h4>
                  <p className="text-sm text-muted-foreground">
                    {tTemplates("customDesc")}
                  </p>
                </div>
              </div>
            </section>

            {/* Shortcuts */}
            <section id="shortcuts" className="mb-16 scroll-mt-20">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-lg bg-litewrite-cyan/10">
                  <Keyboard className="h-6 w-6 text-litewrite-cyan" />
                </div>
                <h2 className="text-3xl font-bold">{tShortcuts("title")}</h2>
              </div>

              <div className="space-y-6">
                {shortcuts.map((group) => (
                  <div key={group.category} className="p-5 rounded-xl border">
                    <h4 className="font-semibold mb-4">{group.category}</h4>
                    <div className="grid gap-2">
                      {group.keys.map((item) => (
                        <div key={item.key} className="flex items-center justify-between py-1">
                          <span className="text-sm text-muted-foreground">{item.desc}</span>
                          <kbd className="px-2 py-1 rounded bg-muted text-xs font-mono">{item.key}</kbd>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>

          </div>
        </main>
      </div>
    </div>
  );
}
