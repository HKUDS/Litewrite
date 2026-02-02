"use client";

import { useState } from "react";
import {
  History,
  Search,
  Upload,
  Users,
  GitCompare,
  Plus,
  Check,
  User,
  Clock,
  FileText,
  BookOpen,
  Calendar,
  Github,
  FileArchive,
  ChevronDown,
  Printer,
  Layers
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/lib/i18n";

// ==================== Version History Demo ====================

interface VersionHistoryTranslations {
  badge: string;
  compareVersions: string;
  from: string;
  files: string;
  currentVersion: string;
}

function VersionHistoryDemo({ translations }: { translations: VersionHistoryTranslations }) {
  const [selectedFrom, setSelectedFrom] = useState("01/18, 10:23...");

  const versions = [
    { time: "01/18, 10:23 PM", user: "Alice", files: 24, isCurrent: false, isFrom: true },
    { time: "01/18, 10:20 PM", user: "Bob", files: 24, isCurrent: false },
    { time: "01/18, 09:45 PM", user: "Alice", files: 23, isCurrent: false },
    { time: "01/17, 03:20 PM", user: "Bob", files: 22, isCurrent: false },
  ];

  const diffLines = [
    { type: "removed", content: "Previous studies have explored various approaches..." },
    { type: "added", content: "Recent advances in neural retrieval have shown..." },
    { type: "context", content: "significant improvements in both accuracy and efficiency." },
    { type: "added", content: "Our approach builds upon these foundations while" },
    { type: "added", content: "introducing novel graph-based indexing mechanisms." },
  ];

  return (
    <div className="flex gap-4 h-[340px]">
      {/* Left: Version List */}
      <div className="w-[240px] rounded-xl overflow-hidden bg-[#1e1e2e] border border-[#313244] flex flex-col">
        <div className="flex items-center justify-between px-3 py-2.5 bg-[#181825] border-b border-[#313244]">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-[#6c7086]" />
            <span className="text-xs font-medium text-[#cdd6f4]">{translations.badge}</span>
          </div>
          <button
            className="p-1 hover:bg-[#313244] rounded transition-colors"
            aria-label="Create version"
            title="Create version"
          >
            <Plus className="h-3.5 w-3.5 text-[#6c7086]" />
          </button>
        </div>

        {/* Compare selector */}
        <div className="px-3 py-2 border-b border-[#313244] bg-[#181825]/50">
          <div className="flex items-center gap-2 text-[10px] text-[#6c7086] mb-1.5">
            <GitCompare className="h-3 w-3" />
            <span>{translations.compareVersions}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <select
              className="flex-1 bg-[#313244] text-[10px] text-[#cdd6f4] px-2 py-1 rounded border-none outline-none"
              aria-label="Compare from version"
              title="Compare from version"
            >
              <option>01/18, 10:23...</option>
            </select>
            <span className="text-[#6c7086] text-xs">→</span>
            <select
              className="flex-1 bg-[#313244] text-[10px] text-[#cdd6f4] px-2 py-1 rounded border-none outline-none"
              aria-label="Compare to version"
              title="Compare to version"
            >
              <option>{translations.currentVersion}</option>
            </select>
          </div>
        </div>

        {/* Version list */}
        <div className="flex-1 overflow-y-auto">
          {versions.map((version, idx) => (
            <div
              key={idx}
              className={cn(
                "px-3 py-2 border-b border-[#313244]/50 hover:bg-[#313244]/30 transition-colors cursor-pointer",
                version.isFrom && "bg-[#89b4fa]/10"
              )}
            >
              {version.isFrom && (
                <div className="flex items-center gap-1 mb-1">
                  <span className="px-1.5 py-0.5 rounded bg-[#89b4fa] text-[#1e1e2e] text-[9px] font-medium">{translations.from}</span>
                </div>
              )}
              <div className="text-[11px] text-[#cdd6f4] font-medium">{version.time}</div>
              <div className="flex items-center gap-2 mt-1 text-[10px] text-[#6c7086]">
                <User className="h-3 w-3" />
                <span>{version.user}</span>
                <span>• {version.files} {translations.files}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right: Diff View */}
      <div className="flex-1 rounded-xl overflow-hidden bg-[#1e1e2e] border border-[#313244] flex flex-col">
        <div className="flex items-center justify-between px-3 py-2.5 bg-[#181825] border-b border-[#313244]">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-[#89b4fa]" />
            <span className="text-xs font-medium text-[#cdd6f4]">main.tex</span>
          </div>
          <div className="flex items-center gap-2 text-[10px]">
            <span className="text-[#a6e3a1]">+12</span>
            <span className="text-[#f38ba8]">-5</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto font-mono text-xs">
          {diffLines.map((line, idx) => (
            <div
              key={idx}
              className={cn(
                "flex px-3 py-1",
                line.type === "removed" && "bg-[#f38ba8]/10",
                line.type === "added" && "bg-[#a6e3a1]/10"
              )}
            >
              <span className={cn(
                "w-5 flex-shrink-0 text-center select-none",
                line.type === "removed" && "text-[#f38ba8]/60",
                line.type === "added" && "text-[#a6e3a1]/60",
                line.type === "context" && "text-transparent"
              )}>
                {line.type === "removed" ? "-" : line.type === "added" ? "+" : " "}
              </span>
              <span className={cn(
                line.type === "removed" && "text-[#f38ba8]",
                line.type === "added" && "text-[#a6e3a1]",
                line.type === "context" && "text-[#6c7086]"
              )}>
                {line.content}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ==================== Reference Search Demo ====================

interface ReferenceSearchTranslations {
  badge: string;
  searchPlaceholder: string;
  citations: string;
  referencesInLibrary: string;
  toInsert: string;
}

function ReferenceSearchDemo({ translations }: { translations: ReferenceSearchTranslations }) {
  const references = [
    {
      title: "In search of needles in a 10m haystack: Recurrent memory finds what llms miss",
      authors: "Yuri Kuratov, Aydar Bulatov et al.",
      year: "2024",
      venue: "arXiv preprint",
      citations: 89,
      key: "kuratov2024search",
    },
    {
      title: "Attention is all you need",
      authors: "Ashish Vaswani, Noam Shazeer et al.",
      year: "2017",
      venue: "NeurIPS",
      citations: 95420,
      key: "vaswani2017attention",
    },
  ];

  return (
    <div className="rounded-xl overflow-hidden bg-[#1e1e2e] border border-[#313244] h-[340px] flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-[#181825] border-b border-[#313244]">
        <Search className="h-4 w-4 text-[#6c7086]" />
        <span className="text-xs font-medium text-[#cdd6f4]">{translations.badge}</span>
      </div>

      {/* Search input */}
      <div className="px-4 py-3 border-b border-[#313244]">
        <div className="flex items-center gap-2 px-3 py-2 bg-[#313244] rounded-lg">
          <Search className="h-4 w-4 text-[#6c7086]" />
          <span className="text-sm text-[#cdd6f4]">{translations.searchPlaceholder}</span>
          <div className="w-0.5 h-4 bg-[#cdd6f4] animate-pulse" />
        </div>
        {/* Progress bar */}
        <div className="mt-2 h-1 bg-[#313244] rounded-full overflow-hidden">
          <div className="h-full w-3/4 bg-[#89b4fa] rounded-full animate-pulse" />
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {references.map((ref, idx) => (
          <div
            key={idx}
            className={cn(
              "p-3 rounded-lg border cursor-pointer transition-all",
              idx === 0
                ? "border-[#89b4fa] bg-[#89b4fa]/10"
                : "border-[#313244] hover:border-[#89b4fa]/50"
            )}
          >
            <h4 className="text-xs font-medium text-[#cdd6f4] leading-tight mb-1.5">{ref.title}</h4>
            <div className="flex items-center gap-1.5 text-[10px] text-[#6c7086] mb-1">
              <User className="h-3 w-3" />
              <span>{ref.authors}</span>
            </div>
            <div className="flex items-center gap-3 text-[10px] text-[#6c7086]">
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {ref.year}
              </span>
              <span>{ref.venue}</span>
              <span className="text-[#89b4fa]">{ref.citations} {translations.citations}</span>
            </div>
            <div className="mt-2 pt-2 border-t border-[#313244]/50">
              <code className="text-[10px] font-mono text-[#89b4fa] bg-[#89b4fa]/10 px-1.5 py-0.5 rounded">
                \cite{"{" + ref.key + "}"}
              </code>
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-[#313244] bg-[#181825]/50 flex items-center justify-between text-[10px] text-[#6c7086]">
        <span>35 {translations.referencesInLibrary}</span>
        <span className="flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 rounded bg-[#313244] text-[9px]">Enter</kbd>
          {translations.toInsert}
        </span>
      </div>
    </div>
  );
}

// ==================== Project Import Demo ====================

interface ProjectImportTranslations {
  fileUpload: string;
  github: string;
  arxiv: string;
  arxivIdLabel: string;
  arxivPlaceholder: string;
  arxivHint: string;
  supportedFormats: string;
  arxivNote: string;
  dropFilesHere: string;
  supportsFiles: string;
  repoUrlLabel: string;
  repoPlaceholder: string;
  publicOnly: string;
}

function ProjectImportDemo({ translations }: { translations: ProjectImportTranslations }) {
  const [activeTab, setActiveTab] = useState<"file" | "github" | "arxiv">("arxiv");

  return (
    <div className="rounded-xl overflow-hidden bg-white dark:bg-[#0f172a] border border-[#e2e8f0] dark:border-[#334155] h-[340px] flex flex-col">
      {/* Tabs */}
      <div className="flex border-b border-[#e2e8f0] dark:border-[#334155]">
        <button
          onClick={() => setActiveTab("file")}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 px-4 py-3 text-xs font-medium transition-colors",
            activeTab === "file"
              ? "text-[#0ea5e9] border-b-2 border-[#0ea5e9] bg-[#0ea5e9]/5"
              : "text-[#64748b] hover:text-[#334155] dark:hover:text-[#94a3b8]"
          )}
        >
          <Upload className="h-4 w-4" />
          {translations.fileUpload}
        </button>
        <button
          onClick={() => setActiveTab("github")}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 px-4 py-3 text-xs font-medium transition-colors",
            activeTab === "github"
              ? "text-[#0ea5e9] border-b-2 border-[#0ea5e9] bg-[#0ea5e9]/5"
              : "text-[#64748b] hover:text-[#334155] dark:hover:text-[#94a3b8]"
          )}
        >
          <Github className="h-4 w-4" />
          {translations.github}
        </button>
        <button
          onClick={() => setActiveTab("arxiv")}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 px-4 py-3 text-xs font-medium transition-colors",
            activeTab === "arxiv"
              ? "text-[#0ea5e9] border-b-2 border-[#0ea5e9] bg-[#0ea5e9]/5"
              : "text-[#64748b] hover:text-[#334155] dark:hover:text-[#94a3b8]"
          )}
        >
          <BookOpen className="h-4 w-4" />
          {translations.arxiv}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 p-4">
        {activeTab === "arxiv" && (
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-[#334155] dark:text-[#94a3b8] mb-1.5 block">
                {translations.arxivIdLabel} <span className="text-[#ef4444]">*</span>
              </label>
              <input
                type="text"
                placeholder={translations.arxivPlaceholder}
                className="w-full px-3 py-2 rounded-lg border border-[#e2e8f0] dark:border-[#334155] bg-white dark:bg-[#1e293b] text-sm text-[#334155] dark:text-[#e2e8f0] placeholder:text-[#94a3b8]"
              />
              <p className="text-[10px] text-[#64748b] mt-1">
                {translations.arxivHint}
              </p>
            </div>

            <div className="p-3 rounded-lg bg-[#f8fafc] dark:bg-[#1e293b] border border-[#e2e8f0] dark:border-[#334155]">
              <p className="text-[11px] font-medium text-[#334155] dark:text-[#94a3b8] mb-2">{translations.supportedFormats}</p>
              <ul className="text-[10px] text-[#64748b] space-y-1">
                <li>• 2410.05779</li>
                <li>• https://arxiv.org/abs/2410.05779</li>
              </ul>
              <p className="text-[10px] text-[#f97316] mt-2">
                {translations.arxivNote}
              </p>
            </div>
          </div>
        )}

        {activeTab === "file" && (
          <div className="h-full flex flex-col items-center justify-center border-2 border-dashed border-[#e2e8f0] dark:border-[#334155] rounded-lg cursor-pointer hover:border-[#0ea5e9]/50 transition-colors">
            <FileArchive className="h-10 w-10 text-[#94a3b8] mb-3" />
            <p className="text-sm font-medium text-[#334155] dark:text-[#94a3b8]">{translations.dropFilesHere}</p>
            <p className="text-[10px] text-[#64748b] mt-1">{translations.supportsFiles}</p>
          </div>
        )}

        {activeTab === "github" && (
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-[#334155] dark:text-[#94a3b8] mb-1.5 block">
                {translations.repoUrlLabel} <span className="text-[#ef4444]">*</span>
              </label>
              <input
                type="text"
                placeholder={translations.repoPlaceholder}
                className="w-full px-3 py-2 rounded-lg border border-[#e2e8f0] dark:border-[#334155] bg-white dark:bg-[#1e293b] text-sm text-[#334155] dark:text-[#e2e8f0] placeholder:text-[#94a3b8]"
              />
            </div>
            <div className="p-3 rounded-lg bg-[#f8fafc] dark:bg-[#1e293b] border border-[#e2e8f0] dark:border-[#334155]">
              <p className="text-[10px] text-[#f97316]">
                {translations.publicOnly}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== Real-time Collaboration Demo ====================

interface CollaborationTranslations {
  editing: string;
  live: string;
}

function CollaborationDemo({ translations }: { translations: CollaborationTranslations }) {
  const collaborators = [
    { name: "Alice", color: "#a6e3a1", line: 12, section: "Introduction", isOnline: true },
    { name: "Bob", color: "#f9e2af", line: 28, section: "Methodology", isOnline: true },
    { name: "Carol", color: "#89b4fa", line: 45, section: "Results", isOnline: true },
  ];

  const codeLines = [
    { num: 10, content: "\\begin{document}", cursor: null },
    { num: 11, content: "", cursor: null },
    { num: 12, content: "\\section{Introduction}", cursor: { name: "Alice", color: "#a6e3a1" } },
    { num: 13, content: "", cursor: null },
    { num: 14, content: "Retrieval-Augmented Generation (RAG) has emerged", cursor: null },
    { num: 15, content: "as a promising paradigm for enhancing LLMs.", cursor: null },
    { num: 16, content: "", cursor: null },
    { num: 17, content: "\\section{Methodology}", cursor: { name: "Bob", color: "#f9e2af" } },
    { num: 18, content: "", cursor: null },
    { num: 19, content: "We propose a novel framework that combines:", cursor: null },
    { num: 20, content: "", cursor: null },
  ];

  return (
    <div className="h-[340px]">
      {/* Code Editor with multiple cursors */}
      <div className="h-full rounded-xl overflow-hidden bg-[#1e1e2e] border border-[#313244] flex flex-col">
        <div className="flex items-center justify-between px-3 py-2.5 bg-[#181825] border-b border-[#313244]">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-[#89b4fa]" />
            <span className="text-xs font-medium text-[#cdd6f4]">main.tex</span>
          </div>
          <div className="flex items-center gap-1">
            {collaborators.map((c, idx) => (
              <div
                key={idx}
                className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-medium text-[#1e1e2e] border-2 border-[#1e1e2e]"
                style={{ backgroundColor: c.color, marginLeft: idx > 0 ? "-8px" : "0" }}
              >
                {c.name[0]}
              </div>
            ))}
            <span className="text-[10px] text-[#6c7086] ml-2">3 {translations.editing}</span>
            <div className="flex items-center gap-1 ml-2 text-[#a6e3a1]">
              <div className="w-1.5 h-1.5 rounded-full bg-[#a6e3a1] animate-pulse" />
              <span className="text-[10px]">{translations.live}</span>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto font-mono text-xs pt-2">
          {codeLines.map((line, idx) => (
            <div key={idx} className="flex relative">
              <span className="w-8 text-right pr-3 text-[#6c7086] select-none flex-shrink-0 py-0.5">
                {line.num}
              </span>
              <span className="flex-1 py-0.5 text-[#cdd6f4] relative">
                {line.cursor && (
                  <>
                    {/* Cursor label */}
                    <span
                      className="absolute -top-4 left-0 px-1.5 py-0.5 rounded text-[9px] font-medium text-white whitespace-nowrap z-10"
                      style={{ backgroundColor: line.cursor.color }}
                    >
                      {line.cursor.name}
                    </span>
                    {/* Cursor line */}
                    <span
                      className="absolute left-0 top-0 bottom-0 w-0.5 animate-pulse"
                      style={{ backgroundColor: line.cursor.color }}
                    />
                  </>
                )}
                <span className={cn(
                  line.content.startsWith("\\") ? "text-[#89b4fa]" : "",
                  line.cursor && "pl-1"
                )}>
                  {line.content || "\u00A0"}
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ==================== Feature Data ====================

interface FeatureConfig {
  id: string;
  icon: React.ElementType;
}

const featureConfigs: FeatureConfig[] = [
  { id: "history", icon: History },
  { id: "reference", icon: Search },
  { id: "import", icon: Upload },
  { id: "collaboration", icon: Users },
];

// ==================== Main Component ====================

export function OtherFeatures() {
  const { t } = useTranslations("landing.otherFeatures");

  return (
    <section className="relative py-24 overflow-hidden">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        {/* Section header */}
        <div className="mx-auto max-w-2xl text-center mb-16">
          <div className="inline-flex items-center gap-2 px-4 py-2 mb-6 rounded-full bg-[var(--glass-bg)] backdrop-blur-sm border border-[var(--glass-border)]">
            <Layers className="h-4 w-4 text-litewrite-cyan" />
            <span className="text-sm font-medium text-muted-foreground">{t("badge")}</span>
          </div>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
            {t("title")}
            <span className="block text-gradient mt-1">{t("titleHighlight")}</span>
          </h2>
          <p className="mt-6 text-lg text-muted-foreground leading-relaxed">
            {t("description")}
          </p>
        </div>

        {/* Features with alternating layout */}
        <div className="space-y-24">
          {featureConfigs.map((feature, index) => {
            const isEven = index % 2 === 0;
            const Icon = feature.icon;

            // Render a different demo component based on feature.id.
            let demoComponent: React.ReactNode = null;
            if (feature.id === "history") {
              demoComponent = (
                <VersionHistoryDemo
                  translations={{
                    badge: t("history.badge"),
                    compareVersions: t("history.compareVersions"),
                    from: t("history.from"),
                    files: t("history.files"),
                    currentVersion: t("history.currentVersion"),
                  }}
                />
              );
            } else if (feature.id === "reference") {
              demoComponent = (
                <ReferenceSearchDemo
                  translations={{
                    badge: t("reference.badge"),
                    searchPlaceholder: t("reference.searchPlaceholder"),
                    citations: t("reference.citations"),
                    referencesInLibrary: t("reference.referencesInLibrary"),
                    toInsert: t("reference.toInsert"),
                  }}
                />
              );
            } else if (feature.id === "import") {
              demoComponent = (
                <ProjectImportDemo
                  translations={{
                    fileUpload: t("import.fileUpload"),
                    github: t("import.github"),
                    arxiv: t("import.arxiv"),
                    arxivIdLabel: t("import.arxivIdLabel"),
                    arxivPlaceholder: t("import.arxivPlaceholder"),
                    arxivHint: t("import.arxivHint"),
                    supportedFormats: t("import.supportedFormats"),
                    arxivNote: t("import.arxivNote"),
                    dropFilesHere: t("import.dropFilesHere"),
                    supportsFiles: t("import.supportsFiles"),
                    repoUrlLabel: t("import.repoUrlLabel"),
                    repoPlaceholder: t("import.repoPlaceholder"),
                    publicOnly: t("import.publicOnly"),
                  }}
                />
              );
            } else if (feature.id === "collaboration") {
              demoComponent = (
                <CollaborationDemo
                  translations={{
                    editing: t("collaboration.editing"),
                    live: t("collaboration.live"),
                  }}
                />
              );
            }

            return (
              <div
                key={feature.id}
                className={cn(
                  "flex flex-col lg:flex-row gap-8 lg:gap-16 items-center",
                  !isEven && "lg:flex-row-reverse"
                )}
              >
                {/* Text side */}
                <div className="w-full lg:w-1/3 text-center lg:text-left">
                  {/* Badge */}
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 mb-4 rounded-full bg-[var(--glass-bg)] backdrop-blur-sm border border-[var(--glass-border)]">
                    <Icon className="h-4 w-4 text-litewrite-cyan" />
                    <span className="text-xs font-medium text-muted-foreground">{t(`${feature.id}.badge`)}</span>
                  </div>

                  {/* Title */}
                  <h3 className="text-2xl font-bold mb-4 leading-tight">
                    {t(`${feature.id}.titleMain`)}
                    <span className="text-muted-foreground block sm:inline">
                      {" " + t(`${feature.id}.titleMuted`)}
                    </span>
                  </h3>

                  {/* Description */}
                  <p className="text-muted-foreground leading-relaxed">
                    {t(`${feature.id}.description`)}
                  </p>
                </div>

                {/* Demo side */}
                <div className="w-full lg:w-2/3">
                  {demoComponent}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
