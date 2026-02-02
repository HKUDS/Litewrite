/**
 * Shared compiler utilities for template handling.
 *
 * This module provides a single source of truth for:
 * - Valid LaTeX compilers
 * - Compiler inference from tex content
 */

export type Compiler = "pdflatex" | "xelatex" | "lualatex" | "latex";

export const VALID_COMPILERS = new Set<Compiler>(["pdflatex", "xelatex", "lualatex", "latex"]);

/**
 * Infers the appropriate LaTeX compiler from tex content.
 *
 * Returns "xelatex" if the content contains:
 * - Chinese thesis document classes (thuthesis, pkuthss, etc.)
 * - ctex-based document classes (ctex, ctexart, ctexrep, ctexbook)
 * - Packages requiring XeLaTeX (fontspec, xeCJK, ctex)
 * - TEX directive specifying xelatex
 *
 * Otherwise returns "pdflatex".
 */
export function inferTemplateCompilerFromTex(texContent: string): Compiler {
  // Check for TEX program directive first (highest priority - explicit user intent)
  // Use \s* instead of .* around = to prevent greedy matching issues
  // (e.g., "pdflatex" being incorrectly matched by the latex pattern)
  if (/%!TEX.*program\s*=\s*xelatex\b/i.test(texContent)) {
    return "xelatex";
  }
  if (/%!TEX.*program\s*=\s*lualatex\b/i.test(texContent)) {
    return "lualatex";
  }
  if (/%!TEX.*program\s*=\s*latex\b/i.test(texContent)) {
    return "latex";
  }
  if (/%!TEX.*program\s*=\s*pdflatex\b/i.test(texContent)) {
    return "pdflatex";
  }

  // Check for document classes and packages that require XeLaTeX
  const needsXelatex =
    /\\documentclass.*\{(thuthesis|pkuthss|fduthesis|hithesis|hustthesis|njuthesis|sysuthesis|uestcthesis|cquthesis|sduthesis|seuthesis|sjtuthesis|ustcthesis|zjuthesis|buaathesis|xjtuthesis|tongjithesis|whu-thesis|ctex|ctexart|ctexrep|ctexbook|awesome-cv|Dissertate|altacv)\}/i.test(texContent)
    || /\\usepackage.*\{(fontspec|xeCJK|ctex)\}/i.test(texContent);

  return needsXelatex ? "xelatex" : "pdflatex";
}
