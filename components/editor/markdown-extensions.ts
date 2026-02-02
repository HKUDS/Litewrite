/**
 * Markdown CodeMirror extension configuration.
 */

import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { tags } from "@lezer/highlight";
import type { Completion } from "@codemirror/autocomplete";

type TranslateFunction = (key: string, params?: Record<string, string | number>) => string;

function createMarkdownCompletions(t: TranslateFunction): Completion[] {
  const info = (key: string) => t(`markdownCompletion.${key}`);
  return [
    { label: "# ", type: "keyword", info: info("h1") },
    { label: "## ", type: "keyword", info: info("h2") },
    { label: "### ", type: "keyword", info: info("h3") },
    { label: "**bold**", type: "text", info: info("bold") },
    { label: "*italic*", type: "text", info: info("italic") },
    { label: "~~strikethrough~~", type: "text", info: info("strikethrough") },
    { label: "`code`", type: "function", info: info("inlineCode") },
    { label: "```\n\n```", type: "function", info: info("codeBlock") },
    { label: "[text](url)", type: "function", info: info("link") },
    { label: "![alt](url)", type: "function", info: info("image") },
    { label: "- ", type: "keyword", info: info("unorderedList") },
    { label: "1. ", type: "keyword", info: info("orderedList") },
    { label: "- [ ] ", type: "keyword", info: info("taskList") },
    { label: "> ", type: "keyword", info: info("quote") },
    { label: "---", type: "keyword", info: info("divider") },
    { label: "| | |\n|---|---|\n| | |", type: "function", info: info("table") },
  ];
}

export function createMarkdownAutocomplete(t: TranslateFunction) {
  const markdownCompletions = createMarkdownCompletions(t);

  return (context: {
    matchBefore: (regex: RegExp) => { from: number; text: string } | null;
  }) => {
    // Match Markdown syntax at the start of the line
    const lineStart = context.matchBefore(/^[#\-\*>\d\[\]`~\|]*/);
    if (lineStart && lineStart.text.length > 0) {
      return {
        from: lineStart.from,
        options: markdownCompletions.filter((c) =>
          c.label.toLowerCase().startsWith(lineStart.text.toLowerCase())
        ),
      };
    }

    // Match starting special characters
    const special = context.matchBefore(/[\*\~\`\[\!]+/);
    if (special && special.text.length >= 1) {
      return {
        from: special.from,
        options: markdownCompletions.filter((c) =>
          c.label.includes(special.text)
        ),
      };
    }

    return null;
  };
}

// ============== VS Code-style Markdown highlight theme ==============

// VS Code light theme palette
const vscodeLight = {
  heading: "#0451A5",      // Blue - headings
  strong: "#0000FF",       // Blue - bold
  emphasis: "#0000FF",     // Blue - italic
  code: "#A31515",         // Brown-red - code
  link: "#0451A5",         // Blue - link text
  url: "#0000FF",          // Blue - URL
  list: "#0451A5",         // Blue - list markers
  quote: "#008000",        // Green - blockquote
  comment: "#008000",      // Green - comments
  meta: "#800000",         // Brown - metadata
  separator: "#000000",    // Black - separator
  strikethrough: "#808080" // Gray - strikethrough
};

// VS Code dark theme palette
const vscodeDark = {
  heading: "#569CD6",      // Light blue - headings
  strong: "#569CD6",       // Light blue - bold
  emphasis: "#569CD6",     // Light blue - italic
  code: "#CE9178",         // Orange-brown - code
  link: "#4FC1FF",         // Light blue - link text
  url: "#3794FF",          // Blue - URL
  list: "#569CD6",         // Light blue - list markers
  quote: "#6A9955",        // Green - blockquote
  comment: "#6A9955",      // Green - comments
  meta: "#CE9178",         // Orange-brown - metadata
  separator: "#808080",    // Gray - separator
  strikethrough: "#808080" // Gray - strikethrough
};

// Default to the light theme
const mdColors = vscodeLight;

// Markdown highlight theme (VS Code-style)
export const markdownHighlightStyle = HighlightStyle.define([
  // Headings - blue + bold
  { tag: tags.heading1, color: mdColors.heading, fontWeight: "700", fontSize: "1.5em" },
  { tag: tags.heading2, color: mdColors.heading, fontWeight: "600", fontSize: "1.3em" },
  { tag: tags.heading3, color: mdColors.heading, fontWeight: "600", fontSize: "1.15em" },
  { tag: tags.heading4, color: mdColors.heading, fontWeight: "600" },
  { tag: tags.heading5, color: mdColors.heading, fontWeight: "500" },
  { tag: tags.heading6, color: mdColors.heading, fontWeight: "500" },
  // Emphasis
  { tag: tags.strong, fontWeight: "700", color: mdColors.strong },
  { tag: tags.emphasis, fontStyle: "italic", color: mdColors.emphasis },
  { tag: tags.strikethrough, textDecoration: "line-through", color: mdColors.strikethrough },
  // Code - brown-red monospace
  { tag: tags.monospace, color: mdColors.code, fontFamily: '"JetBrains Mono", "Fira Code", monospace' },
  // Links
  { tag: tags.link, color: mdColors.link, textDecoration: "underline" },
  { tag: tags.url, color: mdColors.url },
  // Lists
  { tag: tags.list, color: mdColors.list },
  // Blockquote - green italic
  { tag: tags.quote, color: mdColors.quote, fontStyle: "italic" },
  // Metadata
  { tag: tags.meta, color: mdColors.meta },
  { tag: tags.processingInstruction, color: mdColors.meta },
  // Comments
  { tag: tags.comment, color: mdColors.comment, fontStyle: "italic" },
  // Separator
  { tag: tags.contentSeparator, color: mdColors.separator },
]);

// Dark theme highlight style
export const markdownHighlightStyleDark = HighlightStyle.define([
  // Headings - light blue
  { tag: tags.heading1, color: vscodeDark.heading, fontWeight: "700", fontSize: "1.5em" },
  { tag: tags.heading2, color: vscodeDark.heading, fontWeight: "600", fontSize: "1.3em" },
  { tag: tags.heading3, color: vscodeDark.heading, fontWeight: "600", fontSize: "1.15em" },
  { tag: tags.heading4, color: vscodeDark.heading, fontWeight: "600" },
  { tag: tags.heading5, color: vscodeDark.heading, fontWeight: "500" },
  { tag: tags.heading6, color: vscodeDark.heading, fontWeight: "500" },
  // Emphasis
  { tag: tags.strong, fontWeight: "700", color: vscodeDark.strong },
  { tag: tags.emphasis, fontStyle: "italic", color: vscodeDark.emphasis },
  { tag: tags.strikethrough, textDecoration: "line-through", color: vscodeDark.strikethrough },
  // Code - orange-brown
  { tag: tags.monospace, color: vscodeDark.code, fontFamily: '"JetBrains Mono", "Fira Code", monospace' },
  // Links
  { tag: tags.link, color: vscodeDark.link, textDecoration: "underline" },
  { tag: tags.url, color: vscodeDark.url },
  // Lists
  { tag: tags.list, color: vscodeDark.list },
  // Blockquote - green
  { tag: tags.quote, color: vscodeDark.quote, fontStyle: "italic" },
  // Metadata
  { tag: tags.meta, color: vscodeDark.meta },
  { tag: tags.processingInstruction, color: vscodeDark.meta },
  // Comments
  { tag: tags.comment, color: vscodeDark.comment, fontStyle: "italic" },
  // Separator
  { tag: tags.contentSeparator, color: vscodeDark.separator },
]);

// Create Markdown language extensions
export function createMarkdownExtensions() {
  return [
    markdown({
      base: markdownLanguage,
      codeLanguages: languages,
    }),
    syntaxHighlighting(markdownHighlightStyle),
  ];
}
