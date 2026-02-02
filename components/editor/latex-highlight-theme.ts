/**
 * Enhanced LaTeX syntax highlighting theme.
 *
 * Design: a blue/cyan/purple/green color palette.
 *
 * Palette:
 * - Light: classic LaTeX editor colors
 * - Dark: consistent tones for dark mode
 */

import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { EditorView } from "@codemirror/view";

// ============== Light palette ==============
const lightColors = {
  // LaTeX commands (\section, \textbf) - blue
  command: "#0066CC",
  structure: "#0066CC",
  format: "#0066CC",
  // Environment names (equation, figure) - cyan
  environment: "#008080",
  // Math symbols and formulas - purple
  math: "#9932CC",
  // Variables / Greek letters - purple
  variable: "#9932CC",
  // Comments - green
  comment: "#6B8E23",
  // Reference keys - cyan
  reference: "#008080",
  // Strings / text content - near black
  string: "#333333",
  // Brackets - dark gray
  bracket: "#24292E",
  // Numbers - purple
  number: "#9932CC",
  // Keywords - blue
  keyword: "#0066CC",
  // Operators - blue
  operator: "#0066CC",
  // Special characters - cyan
  special: "#008080",
  // Params / attributes - cyan
  attribute: "#008080"
};

// ============== Dark palette ==============
const darkColors = {
  // LaTeX commands - bright blue
  command: "#6CB6FF",
  structure: "#6CB6FF",
  format: "#6CB6FF",
  // Environment names - bright cyan
  environment: "#56D4DD",
  // Math symbols - bright purple
  math: "#CDA8F0",
  // Variables / Greek letters - bright purple
  variable: "#CDA8F0",
  // Comments - bright green
  comment: "#98C379",
  // Reference keys - cyan
  reference: "#56D4DD",
  // Strings - light gray
  string: "#D4D4D4",
  // Brackets - white-ish
  bracket: "#CCCCCC",
  // Numbers - bright purple
  number: "#CDA8F0",
  // Keywords - bright blue
  keyword: "#6CB6FF",
  // Operators - bright blue
  operator: "#6CB6FF",
  // Special characters - bright cyan
  special: "#56D4DD",
  // Params / attributes - bright cyan
  attribute: "#56D4DD"
};

// ============== Light theme highlight styles ==============
export const latexHighlightStyleLight = HighlightStyle.define([
  // Keywords (\documentclass, \usepackage)
  { tag: tags.keyword, color: lightColors.keyword, fontWeight: "bold" },

  // Structural commands (\section, \chapter)
  { tag: tags.heading, color: lightColors.structure, fontWeight: "bold", fontSize: "1.1em" },

  // Comments
  { tag: tags.comment, color: lightColors.comment, fontStyle: "italic" },

  // Strings (content inside {...})
  { tag: tags.string, color: lightColors.string },

  // Operators (=, +, ^, _)
  { tag: tags.operator, color: lightColors.operator },
  { tag: tags.arithmeticOperator, color: lightColors.operator },
  { tag: tags.logicOperator, color: lightColors.operator },

  // Brackets
  { tag: tags.bracket, color: lightColors.bracket },
  { tag: tags.squareBracket, color: lightColors.bracket },
  { tag: tags.brace, color: lightColors.bracket },

  // Meta
  { tag: tags.meta, color: lightColors.structure },

  // Math-related
  { tag: tags.atom, color: lightColors.math }, // Symbols
  { tag: tags.variableName, color: lightColors.variable }, // Variables

  // Numbers
  { tag: tags.number, color: lightColors.number },

  // LaTeX commands (Function)
  { tag: tags.function(tags.variableName), color: lightColors.format },

  // Environment definitions (\begin{...})
  { tag: tags.definition(tags.variableName), color: lightColors.environment, fontWeight: "bold" },
  { tag: tags.typeName, color: lightColors.environment, fontWeight: "bold" }, // Environment name
  { tag: tags.tagName, color: lightColors.keyword, fontWeight: "bold" }, // \begin, \end

  // Attributes / params
  { tag: tags.attributeName, color: lightColors.attribute },

  // Special / escaped characters
  { tag: tags.special(tags.string), color: lightColors.special },

  // Links
  { tag: tags.link, color: lightColors.reference, textDecoration: "underline" },

  // Emphasis
  { tag: tags.emphasis, fontStyle: "italic", color: lightColors.format },
  { tag: tags.strong, fontWeight: "bold", color: lightColors.structure },
]);

// ============== Dark theme highlight styles ==============
export const latexHighlightStyleDark = HighlightStyle.define([
  // Keywords
  { tag: tags.keyword, color: darkColors.keyword, fontWeight: "bold" },

  // Structural commands
  { tag: tags.heading, color: darkColors.structure, fontWeight: "bold", fontSize: "1.1em" },

  // Comments
  { tag: tags.comment, color: darkColors.comment, fontStyle: "italic" },

  // Strings
  { tag: tags.string, color: darkColors.string },

  // Operators
  { tag: tags.operator, color: darkColors.operator },
  { tag: tags.arithmeticOperator, color: darkColors.operator },

  // Brackets
  { tag: tags.bracket, color: darkColors.bracket },
  { tag: tags.squareBracket, color: darkColors.bracket },
  { tag: tags.brace, color: darkColors.bracket },

  // Meta
  { tag: tags.meta, color: darkColors.structure },

  // Math-related
  { tag: tags.atom, color: darkColors.math },
  { tag: tags.variableName, color: darkColors.variable },

  // Numbers
  { tag: tags.number, color: darkColors.number },

  // LaTeX commands
  { tag: tags.function(tags.variableName), color: darkColors.format },

  // Environment definitions
  { tag: tags.definition(tags.variableName), color: darkColors.environment, fontWeight: "bold" },
  { tag: tags.typeName, color: darkColors.environment, fontWeight: "bold" },
  { tag: tags.tagName, color: darkColors.keyword, fontWeight: "bold" },

  // Attributes
  { tag: tags.attributeName, color: darkColors.attribute },

  // Special characters
  { tag: tags.special(tags.string), color: darkColors.special },

  // Links
  { tag: tags.link, color: darkColors.reference, textDecoration: "underline" },

  // Emphasis
  { tag: tags.emphasis, fontStyle: "italic", color: darkColors.format },
  { tag: tags.strong, fontWeight: "bold", color: darkColors.structure },
]);

// ============== Editor theme styles ==============

// Light editor theme
export const latexEditorThemeLight = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "14px",
    backgroundColor: "#FFFFFF",
    color: "#24292E",
  },
  ".cm-content": {
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    padding: "16px 0",
    caretColor: "#24292E",
  },
  ".cm-line": {
    padding: "0 16px",
  },
  ".cm-gutters": {
    backgroundColor: "#F6F8FA",
    borderRight: "1px solid #E1E4E8",
    color: "#6A737D",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "#E8F4FD",
    color: "#005CC5",
  },
  ".cm-activeLine": {
    backgroundColor: "#F6F8FA",
  },
  ".cm-cursor": {
    borderLeftColor: "#005CC5",
    borderLeftWidth: "2px",
  },
  ".cm-matchingBracket": {
    backgroundColor: "rgba(0, 92, 197, 0.2)",
    outline: "1px solid #005CC5",
  },
  ".cm-selectionMatch": {
    backgroundColor: "rgba(0, 92, 197, 0.15)",
  },
  ".cm-tooltip": {
    backgroundColor: "#FFFFFF",
    border: "1px solid #E1E4E8",
    borderRadius: "6px",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "#E8F4FD",
  },
}, { dark: false });

// Dark editor theme (Material Palenight)
export const latexEditorThemeDark = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "14px",
    backgroundColor: "#292D3E", // Palenight Background
    color: "#A6ACCD", // Palenight Foreground
  },
  ".cm-content": {
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    padding: "16px 0",
    caretColor: "#82AAFF",
  },
  ".cm-line": {
    padding: "0 16px",
  },
  ".cm-gutters": {
    backgroundColor: "#292D3E",
    borderRight: "1px solid #2F334D",
    color: "#676E95",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "#343952", // Lighter background
    color: "#82AAFF",
  },
  ".cm-activeLine": {
    backgroundColor: "#303652", // Selection color like
  },
  ".cm-cursor": {
    borderLeftColor: "#82AAFF",
    borderLeftWidth: "2px",
  },
  ".cm-matchingBracket": {
    backgroundColor: "rgba(130, 170, 255, 0.2)",
    outline: "1px solid #82AAFF",
  },
  ".cm-selectionMatch": {
    backgroundColor: "rgba(130, 170, 255, 0.15)",
  },
  ".cm-tooltip": {
    backgroundColor: "#292D3E",
    border: "1px solid #454545",
    borderRadius: "6px",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.4)",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "#343952",
    // Do not change font color; keep it consistent with other options.
  },
}, { dark: true });

// ... Keep the original exported helpers unchanged ...
export function getLatexHighlightExtension(isDark: boolean) {
  return isDark
    ? syntaxHighlighting(latexHighlightStyleDark)
    : syntaxHighlighting(latexHighlightStyleLight);
}

export function getLatexEditorTheme(isDark: boolean) {
  return isDark ? latexEditorThemeDark : latexEditorThemeLight;
}

export function getLatexTheme(isDark: boolean) {
  return [
    getLatexHighlightExtension(isDark),
    getLatexEditorTheme(isDark),
  ];
}

export { lightColors, darkColors };
