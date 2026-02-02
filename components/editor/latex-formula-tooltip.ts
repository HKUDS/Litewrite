/**
 * LaTeX live preview extension
 *
 * Features:
 * 1. Formulas: live preview at cursor (StateField + showTooltip)
 * 2. Tables/images: hover preview (hoverTooltip)
 * 3. Smart boundary detection (bidirectional scan + safety thresholds), supports nested environments
 * 4. Excludes comment regions
 */

import { hoverTooltip, showTooltip, EditorView, Tooltip } from "@codemirror/view";
import { StateField, StateEffect, EditorState, Text, Extension } from "@codemirror/state";
import katex from "katex";

type TranslateFunction = (key: string, params?: Record<string, string | number>) => string;

type PreviewI18n = {
  formulaDisplayTitle: string;
  inlineFormulaTitle: string;
  renderError: (message: string) => string;
  tableTitle: string;
  compiling: string;
  tableUnavailable: string;
  checkPdfHint: string;
  imageTitle: string;
  imageLoadFailed: string;
};

function createPreviewI18n(t?: TranslateFunction): PreviewI18n {
  return {
    formulaDisplayTitle: t?.("livePreview.formulaDisplayTitle") ?? "Formula preview",
    inlineFormulaTitle: t?.("livePreview.inlineFormulaTitle") ?? "Inline formula",
    renderError: (message: string) =>
      t?.("livePreview.renderError", { message }) ?? `Render error: ${message}`,
    tableTitle: t?.("livePreview.tableTitle") ?? "Table preview",
    compiling: t?.("livePreview.compiling") ?? "Compiling...",
    tableUnavailable: t?.("livePreview.tableUnavailable") ?? "Table preview is temporarily unavailable",
    checkPdfHint: t?.("livePreview.checkPdfHint") ?? "Please check the PDF on the right",
    imageTitle: t?.("livePreview.imageTitle") ?? "Image preview",
    imageLoadFailed: t?.("livePreview.imageLoadFailed") ?? "Image failed to load",
  };
}

// ============== Constants ==============

/** Max line window for smart scanning */
const MAX_SEARCH_LINES = 500;

// ============== Security helpers ==============

/**
 * Escape HTML special characters to prevent XSS.
 */
function escapeHtml(text: string): string {
  const htmlEscapes: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };
  return text.replace(/[&<>"']/g, char => htmlEscapes[char]);
}

/** Compile server URL */
const COMPILE_SERVER_URL = process.env.NEXT_PUBLIC_COMPILE_SERVER_URL || "http://localhost:3002";

// ============== Types ==============

interface PreviewMatch {
  type: "formula" | "table" | "image";
  content: string;
  start: number;
  end: number;
  displayMode?: boolean;
  imagePath?: string;
  caption?: string;
  rawLatex?: string;
}

interface CommentRange {
  from: number;
  to: number;
}

// ============== StateField ==============

const setProjectId = StateEffect.define<string>();

export const projectIdField = StateField.define<string>({
  create() { return ""; },
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setProjectId)) return e.value;
    return value;
  },
});

export function setProjectIdEffect(projectId: string) {
  return setProjectId.of(projectId);
}

// ============== Environment lists ==============

// Math environments (KaTeX-supported)
const MATH_ENVS = new Set([
  "equation", "equation*", "align", "align*", "gather", "gather*",
  "displaymath", "multline", "multline*", "eqnarray", "eqnarray*",
  "flalign", "flalign*", "split", "cases", "matrix", "pmatrix",
  "bmatrix", "vmatrix", "Vmatrix", "smallmatrix", "array",
  "aligned", "gathered", "CD"
]);

// Table container environments (caption wrapper)
const TABLE_CONTAINER_ENVS = new Set(["table", "table*"]);

// Table content environments (actual table body)
const TABLE_CONTENT_ENVS = new Set(["tabular", "tabular*", "tabularx"]);

// All table-related environments (generic detection)
const TABLE_ENVS = new Set([...TABLE_CONTAINER_ENVS, ...TABLE_CONTENT_ENVS]);

// Figure environments
const FIGURE_ENVS = new Set(["figure", "figure*"]);

// ============== Comment region detection ==============

function buildCommentRanges(doc: Text): CommentRange[] {
  const ranges: CommentRange[] = [];
  const text = doc.toString();

  // Line comments
  const lineCommentRegex = /(?<!\\)%.*$/gm;
  let match;
  while ((match = lineCommentRegex.exec(text)) !== null) {
    ranges.push({ from: match.index, to: match.index + match[0].length });
  }

  // \iffalse...\fi
  const iffalseRegex = /\\iffalse[\s\S]*?\\fi/g;
  while ((match = iffalseRegex.exec(text)) !== null) {
    ranges.push({ from: match.index, to: match.index + match[0].length });
  }

  // \begin{comment}...\end{comment}
  const commentEnvRegex = /\\begin\{comment\}[\s\S]*?\\end\{comment\}/g;
  while ((match = commentEnvRegex.exec(text)) !== null) {
    ranges.push({ from: match.index, to: match.index + match[0].length });
  }

  ranges.sort((a, b) => a.from - b.from);
  return ranges;
}

function isInCommentRegion(commentRanges: CommentRange[], pos: number): boolean {
  let left = 0, right = commentRanges.length - 1;
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const range = commentRanges[mid];
    if (pos >= range.from && pos <= range.to) return true;
    if (pos < range.from) right = mid - 1;
    else left = mid + 1;
  }
  return false;
}

function isRangeInComment(commentRanges: CommentRange[], from: number, to: number): boolean {
  for (const range of commentRanges) {
    if (from >= range.from && to <= range.to) return true;
    if (range.from > to) break;
  }
  return false;
}

// ============== Helper: nested brace parsing ==============

/**
 * Starting from a given position, extract the full braced content (supports nesting).
 * @param text Full text
 * @param startIndex Start index of the opening brace ('{')
 * @returns The content inside the braces (without outer braces), or null
 */
function extractBracedContent(text: string, startIndex: number): string | null {
  if (text[startIndex] !== '{') return null;

  let depth = 1;
  let i = startIndex + 1;

  while (i < text.length && depth > 0) {
    const char = text[i];
    // Skip escaped characters
    if (char === '\\' && i + 1 < text.length) {
      i += 2;
      continue;
    }
    if (char === '{') depth++;
    else if (char === '}') depth--;
    i++;
  }

  if (depth === 0) {
    return text.substring(startIndex + 1, i - 1);
  }
  return null;
}

/**
 * Bidirectional caption lookup: search \caption{...} around current content.
 * @param fullContent Full environment content
 * @returns Caption content (with \label removed), or undefined
 */
function extractCaptionBidirectional(fullContent: string): string | undefined {
  // Find all \caption positions
  const captionRegex = /\\caption\s*\{/g;
  let match;
  const captionPositions: number[] = [];

  while ((match = captionRegex.exec(fullContent)) !== null) {
    captionPositions.push(match.index);
  }

  if (captionPositions.length === 0) return undefined;

  // Take the first caption (usually the main caption)
  const captionStart = captionPositions[0];
  const braceStart = fullContent.indexOf('{', captionStart);

  if (braceStart === -1) return undefined;

  const captionContent = extractBracedContent(fullContent, braceStart);
  if (!captionContent) return undefined;

  // Remove \label{...} and trim
  return captionContent.replace(/\\label\s*\{[^}]*\}/g, '').trim();
}

/**
 * Environments that can be safely unwrapped by removing \begin{...}/\end{...}.
 * These do not use alignment markers (&) or other special syntax inside.
 */
const STRIPPABLE_ENVS = new Set([
  "equation", "equation*", "displaymath"
]);

/**
 * Remove \label and equation numbering markers from math content.
 * @param content Math content
 * @returns Cleaned content
 */
function cleanMathContent(content: string): string {
  let processed = content;

  // Only unwrap certain simple environments.
  // For align/gather/matrix and other environments using alignment markers (&), we must keep the wrapper,
  // otherwise KaTeX can't parse & and \\ correctly.
  const envMatch = processed.match(/^\\begin\{([a-zA-Z*]+)\}([\s\S]*)\\end\{\1\}$/);
  if (envMatch && STRIPPABLE_ENVS.has(envMatch[1])) {
    processed = envMatch[2]; // Extract inner content only for safe-to-unwrap envs
  }

  const result = processed
    // Remove \label{...}
    .replace(/\\label\s*\{[^}]*\}/g, '')
    // Remove \tag{...} and \tag*{...}
    .replace(/\\tag\*?\s*\{[^}]*\}/g, '')
    // Remove \notag and \nonumber
    .replace(/\\(notag|nonumber)/g, '')
    // Collapse extra blank lines
    .replace(/\n\s*\n/g, '\n')
    .trim();
  return result;
}

// ============== Smart boundary detection ==============

interface EnvironmentMatch {
  envName: string;
  start: number;
  end: number;
  fullContent: string;
  caption?: string;
}

function findEnclosingEnvironmentSmart(
  state: EditorState,
  pos: number,
  commentRanges: CommentRange[]
): EnvironmentMatch | null {
  const doc = state.doc;
  const currentLine = doc.lineAt(pos);

  const startLineNum = Math.max(1, currentLine.number - MAX_SEARCH_LINES);
  const endLineNum = Math.min(doc.lines, currentLine.number + MAX_SEARCH_LINES);
  const scanFrom = doc.line(startLineNum).from;
  const scanTo = doc.line(endLineNum).to;

  const text = doc.sliceString(scanFrom, scanTo);
  const relPos = pos - scanFrom;

  const tagRegex = /\\(begin|end)\{([a-zA-Z0-9*]+)\}/g;
  const tags: { type: 'begin' | 'end'; name: string; index: number; length: number; absPos: number }[] = [];

  let match;
  while ((match = tagRegex.exec(text)) !== null) {
    const absPos = scanFrom + match.index;
    if (isInCommentRegion(commentRanges, absPos)) continue;
    tags.push({
      type: match[1] as 'begin' | 'end',
      name: match[2],
      index: match.index,
      length: match[0].length,
      absPos
    });
  }

  if (tags.length === 0) return null;

  let currentIndex = -1;
  for (let i = 0; i < tags.length; i++) {
    if (tags[i].index > relPos) break;
    currentIndex = i;
  }

  if (currentIndex === -1) return null;

  let depth = 0;
  let openIndex = -1;
  let envName = "";

  for (let i = currentIndex; i >= 0; i--) {
    const tag = tags[i];
    if (tag.type === 'end') {
      depth++;
    } else {
      if (depth > 0) depth--;
      else { openIndex = i; envName = tag.name; break; }
    }
  }

  if (openIndex === -1) return null;

  let closeIndex = -1;
  depth = 0;

  for (let i = openIndex + 1; i < tags.length; i++) {
    const tag = tags[i];
    if (tag.type === 'begin') depth++;
    else {
      if (depth > 0) depth--;
      else if (tag.name === envName) { closeIndex = i; break; }
      else return null;
    }
  }

  if (closeIndex === -1) return null;

  const startTag = tags[openIndex];
  const endTag = tags[closeIndex];

  if (relPos < startTag.index || relPos > endTag.index + endTag.length) return null;

  const fullContent = text.substring(startTag.index, endTag.index + endTag.length);

  // Extract caption using a bidirectional scan (supports nested braces)
  const caption = extractCaptionBidirectional(fullContent);

  return {
    envName,
    start: scanFrom + startTag.index,
    end: scanFrom + endTag.index + endTag.length,
    fullContent,
    caption
  };
}

/**
 * Find the outermost table environment (prefer table over tabular).
 * When cursor is inside a nested tabular, return the wrapping table environment.
 */
function findOuterTableEnvironment(
  state: EditorState,
  pos: number,
  commentRanges: CommentRange[]
): EnvironmentMatch | null {
  const doc = state.doc;
  const currentLine = doc.lineAt(pos);

  const startLineNum = Math.max(1, currentLine.number - MAX_SEARCH_LINES);
  const endLineNum = Math.min(doc.lines, currentLine.number + MAX_SEARCH_LINES);
  const scanFrom = doc.line(startLineNum).from;
  const scanTo = doc.line(endLineNum).to;

  const text = doc.sliceString(scanFrom, scanTo);
  const relPos = pos - scanFrom;

  // Find all begin/end tags for table/table*
  const tagRegex = /\\(begin|end)\{(table\*?)\}/g;
  const tags: { type: 'begin' | 'end'; name: string; index: number; length: number }[] = [];

  let match;
  while ((match = tagRegex.exec(text)) !== null) {
    const absPos = scanFrom + match.index;
    if (isInCommentRegion(commentRanges, absPos)) continue;
    tags.push({
      type: match[1] as 'begin' | 'end',
      name: match[2],
      index: match.index,
      length: match[0].length
    });
  }

  if (tags.length === 0) return null;

  // Find the outermost table environment enclosing current position
  let bestMatch: EnvironmentMatch | null = null;

  for (let i = 0; i < tags.length; i++) {
    const openTag = tags[i];
    if (openTag.type !== 'begin') continue;
    if (openTag.index > relPos) break;

    // Find the matching end tag
    let depth = 1;
    for (let j = i + 1; j < tags.length; j++) {
      if (tags[j].type === 'begin' && tags[j].name === openTag.name) depth++;
      else if (tags[j].type === 'end' && tags[j].name === openTag.name) {
        depth--;
        if (depth === 0) {
          const endTag = tags[j];
          // Check whether position is within this environment
          if (relPos >= openTag.index && relPos <= endTag.index + endTag.length) {
            const fullContent = text.substring(openTag.index, endTag.index + endTag.length);
            const caption = extractCaptionBidirectional(fullContent);
            bestMatch = {
              envName: openTag.name,
              start: scanFrom + openTag.index,
              end: scanFrom + endTag.index + endTag.length,
              fullContent,
              caption
            };
          }
          break;
        }
      }
    }
  }

  return bestMatch;
}

// ============== Formula lookup (cursor-triggered live preview) ==============

function findMathAtCursor(state: EditorState, pos: number, commentRanges: CommentRange[]): PreviewMatch | null {
  // 1) Named math environments
  const env = findEnclosingEnvironmentSmart(state, pos, commentRanges);
  if (env && MATH_ENVS.has(env.envName)) {
    // Clean math content (remove \label, \tag, etc.)
    const cleanedContent = cleanMathContent(env.fullContent);
    return {
      type: "formula",
      content: cleanedContent,
      start: env.start,
      end: env.end,
      displayMode: true
    };
  }

  // 2) Inline/delimited math
  const doc = state.doc;
  const currentLine = doc.lineAt(pos);
  const startLineNum = Math.max(1, currentLine.number - MAX_SEARCH_LINES);
  const endLineNum = Math.min(doc.lines, currentLine.number + MAX_SEARCH_LINES);
  const scanFrom = doc.line(startLineNum).from;
  const scanTo = doc.line(endLineNum).to;
  const text = doc.sliceString(scanFrom, scanTo);
  const relPos = pos - scanFrom;

  const patterns: { regex: RegExp; displayMode: boolean }[] = [
    { regex: /\$\$([\s\S]+?)\$\$/g, displayMode: true },
    { regex: /\\\[([\s\S]+?)\\\]/g, displayMode: true },
    { regex: /\\\(([\s\S]+?)\\\)/g, displayMode: false },
    { regex: /\$([^$\n]+?)\$/g, displayMode: false }
  ];

  for (const { regex, displayMode } of patterns) {
    let match;
    while ((match = regex.exec(text)) !== null) {
      const absStart = scanFrom + match.index;
      const absEnd = scanFrom + match.index + match[0].length;

      if (isRangeInComment(commentRanges, absStart, absEnd)) continue;

      // Skip $ matches inside $$ blocks
      if (!displayMode && match[0].startsWith('$') && !match[0].startsWith('$$')) {
        if (text[match.index + match[0].length] === '$' ||
            (match.index > 0 && text[match.index - 1] === '$')) continue;
      }

      if (relPos >= match.index && relPos <= match.index + match[0].length) {
        // Clean math content
        const cleanedContent = cleanMathContent(match[1].trim());
        return {
          type: "formula",
          content: cleanedContent,
          start: absStart,
          end: absEnd,
          displayMode
        };
      }
    }
  }

  return null;
}

// ============== Table/image lookup (hover preview) ==============

function findTableOrImageAtPos(state: EditorState, pos: number, commentRanges: CommentRange[]): PreviewMatch | null {
  // 1) Prefer outer table environment (contains caption)
  const outerTable = findOuterTableEnvironment(state, pos, commentRanges);
  if (outerTable) {
    return {
      type: "table",
      content: outerTable.fullContent,
      rawLatex: outerTable.fullContent,
      start: outerTable.start,
      end: outerTable.end,
      caption: outerTable.caption
    };
  }

  // 2) Look for other environments (tabular, figure, etc.)
  const env = findEnclosingEnvironmentSmart(state, pos, commentRanges);

  if (env) {
    // Table content environment (standalone tabular)
    if (TABLE_CONTENT_ENVS.has(env.envName)) {
      return {
        type: "table",
        content: env.fullContent,
        rawLatex: env.fullContent,
        start: env.start,
        end: env.end,
        caption: env.caption
      };
    }

    // Figure environment
    if (FIGURE_ENVS.has(env.envName)) {
      const imgMatch = env.fullContent.match(/\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/);
      if (imgMatch) {
        return {
          type: "image",
          content: env.fullContent,
          imagePath: imgMatch[1].trim(),
          start: env.start,
          end: env.end,
          caption: env.caption
        };
      }
    }
  }

  // 3) Standalone \includegraphics
  const doc = state.doc;
  const currentLine = doc.lineAt(pos);
  const startLineNum = Math.max(1, currentLine.number - 10);
  const endLineNum = Math.min(doc.lines, currentLine.number + 10);
  const scanFrom = doc.line(startLineNum).from;
  const scanTo = doc.line(endLineNum).to;
  const text = doc.sliceString(scanFrom, scanTo);
  const relPos = pos - scanFrom;

  const imgRegex = /\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/g;
  let imgMatch;
  while ((imgMatch = imgRegex.exec(text)) !== null) {
    const absStart = scanFrom + imgMatch.index;
    const absEnd = scanFrom + imgMatch.index + imgMatch[0].length;
    if (isRangeInComment(commentRanges, absStart, absEnd)) continue;

    if (relPos >= imgMatch.index && relPos <= imgMatch.index + imgMatch[0].length) {
      return {
        type: "image",
        content: "",
        imagePath: imgMatch[1].trim(),
        start: absStart,
        end: absEnd
      };
    }
  }

  return null;
}

// ============== Table preview cache ==============

const tablePreviewCache = new Map<string, { imageUrl: string; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000;

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(16);
}

async function fetchTablePreview(snippet: string): Promise<string | null> {
  const hash = simpleHash(snippet);
  const cached = tablePreviewCache.get(hash);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) return cached.imageUrl;

  try {
    const response = await fetch(`${COMPILE_SERVER_URL}/preview-snippet`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snippet, type: "table" })
    });

    if (!response.ok) return null;
    const data = await response.json();

    if (data.success && data.image) {
      const imageUrl = `data:image/png;base64,${data.image}`;
      tablePreviewCache.set(hash, { imageUrl, timestamp: Date.now() });
      return imageUrl;
    }
    return null;
  } catch {
    return null;
  }
}

// ============== Pure frontend table rendering (fallback) ==============

/**
 * Parse simple LaTeX tabular content into an HTML table.
 * This is a lightweight frontend renderer that does not require the compile server.
 */
function renderTableToHTML(latexContent: string): string | null {
  try {
    // Extract tabular/tabularx environment content
    const tabularMatch = latexContent.match(/\\begin\{tabular[x]?\}\s*(?:\{[^}]*\}|\[[^\]]*\]\{[^}]*\})([\s\S]*?)\\end\{tabular[x]?\}/);
    if (!tabularMatch) return null;

    let content = tabularMatch[1];

    // Remove comments
    content = content.replace(/%.*$/gm, '');

    // Split rows (\\ or \\[...] separator)
    const rows = content.split(/\\\\(?:\[[^\]]*\])?/).filter(row => row.trim());

    if (rows.length === 0) return null;

    let html = '<table class="cm-html-table">';
    let isFirstDataRow = true;

    for (const row of rows) {
      const trimmedRow = row.trim();

      // Skip rule/separator commands
      if (/^\\(hline|toprule|midrule|bottomrule|cline\{[^}]*\})$/.test(trimmedRow)) {
        continue;
      }

      // Remove inline rule/separator commands
      const cleanRow = trimmedRow
        .replace(/\\(hline|toprule|midrule|bottomrule|cline\{[^}]*\})/g, '')
        .trim();

      if (!cleanRow) continue;

      // Split cells
      const cells = cleanRow.split('&').map(cell => {
        let cellContent = cell.trim();

        // Handle \multicolumn
        const multicolMatch = cellContent.match(/\\multicolumn\{(\d+)\}\{[^}]*\}\{([^}]*)\}/);
        if (multicolMatch) {
          return { content: escapeHtml(multicolMatch[2]), colspan: parseInt(multicolMatch[1]) };
        }

        // First handle LaTeX sequences by storing placeholders
        const placeholders: { key: string; value: string }[] = [];
        let placeholderIndex = 0;

        const savePlaceholder = (value: string): string => {
          const key = `\x00PH${placeholderIndex++}\x00`;
          placeholders.push({ key, value });
          return key;
        };

        // Extract LaTeX command content and create placeholders (content will be escaped)
        cellContent = cellContent
          .replace(/\\textbf\{([^}]*)\}/g, (_, text) => savePlaceholder(`<strong>${escapeHtml(text)}</strong>`))
          .replace(/\\textit\{([^}]*)\}/g, (_, text) => savePlaceholder(`<em>${escapeHtml(text)}</em>`))
          .replace(/\\emph\{([^}]*)\}/g, (_, text) => savePlaceholder(`<em>${escapeHtml(text)}</em>`))
          .replace(/\\text\{([^}]*)\}/g, (_, text) => savePlaceholder(escapeHtml(text)))
          .replace(/\$([^$]+)\$/g, (_, math) => savePlaceholder(`<code>${escapeHtml(math)}</code>`))
          .replace(/\\cite\{[^}]*\}/g, '[ref]')
          .replace(/\\ref\{[^}]*\}/g, '[ref]')
          .replace(/\\label\{[^}]*\}/g, '')
          .replace(/\\\\/g, savePlaceholder('<br>'))
          .replace(/\\&/g, '&')
          .replace(/\\_/g, '_')
          .replace(/\\%/g, '%');

        // Escape remaining plain text
        cellContent = escapeHtml(cellContent);

        // Restore placeholders to HTML
        for (const { key, value } of placeholders) {
          cellContent = cellContent.replace(key, value);
        }

        return { content: cellContent, colspan: 1 };
      });

      const tag = isFirstDataRow ? 'th' : 'td';
      html += '<tr>';
      for (const cell of cells) {
        const colspanAttr = cell.colspan > 1 ? ` colspan="${cell.colspan}"` : '';
        html += `<${tag}${colspanAttr}>${cell.content}</${tag}>`;
      }
      html += '</tr>';
      isFirstDataRow = false;
    }

    html += '</table>';
    return html;
  } catch {
    return null;
  }
}

// ============== DOM creation ==============

function createFormulaPreviewDOM(content: string, displayMode: boolean, i18n: PreviewI18n): HTMLElement {
  const container = document.createElement("div");
  container.className = "cm-latex-tooltip cm-formula-tooltip";

  const header = document.createElement("div");
  header.className = "cm-tooltip-header";
  header.textContent = displayMode ? i18n.formulaDisplayTitle : i18n.inlineFormulaTitle;
  container.appendChild(header);

  const preview = document.createElement("div");
  preview.className = "cm-preview-content";
  preview.style.padding = "12px";
  preview.style.display = "flex";
  preview.style.justifyContent = "center";

  try {
    katex.render(content, preview, {
      displayMode,
      throwOnError: false,
      output: "html",
      trust: false,
      strict: false
    });
  } catch (e) {
    const errorSpan = document.createElement("span");
    errorSpan.style.color = "red";
    errorSpan.textContent = i18n.renderError((e as Error).message);
    preview.appendChild(errorSpan);
  }

  container.appendChild(preview);
  return container;
}

function createTablePreviewDOM(rawLatex: string, caption: string | undefined, i18n: PreviewI18n): HTMLElement {
  const container = document.createElement("div");
  container.className = "cm-latex-tooltip cm-table-tooltip";

  const header = document.createElement("div");
  header.className = "cm-tooltip-header";
  header.textContent = i18n.tableTitle;
  container.appendChild(header);

  const preview = document.createElement("div");
  preview.className = "cm-preview-content";

  // First try pure frontend HTML rendering (fast; no compile server required)
  const htmlTable = renderTableToHTML(rawLatex);

  if (htmlTable) {
    // Frontend render succeeded; show HTML table directly
    preview.innerHTML = htmlTable;
  } else {
    // Frontend render failed; fall back to compile server
    preview.innerHTML = `
      <div class="cm-preview-loading">
        <div class="cm-loading-spinner"></div>
        <span>${i18n.compiling}</span>
      </div>
    `;

    fetchTablePreview(rawLatex).then(imageUrl => {
      preview.innerHTML = "";
      if (imageUrl) {
        const img = document.createElement("img");
        img.src = imageUrl;
        img.className = "cm-table-preview-image";
        preview.appendChild(img);
      } else {
        const fallback = document.createElement("div");
        fallback.className = "cm-preview-fallback";
        fallback.innerHTML = `
          <div class="cm-fallback-icon">📊</div>
          <div class="cm-fallback-text">${i18n.tableUnavailable}</div>
          <div class="cm-fallback-hint">${i18n.checkPdfHint}</div>
        `;
        preview.appendChild(fallback);
      }
    });
  }

  container.appendChild(preview);

  if (caption) {
    const captionEl = document.createElement("div");
    captionEl.className = "cm-preview-caption";
    const strongEl = document.createElement("strong");
    strongEl.textContent = "Table:";
    captionEl.appendChild(strongEl);
    captionEl.appendChild(document.createTextNode(" " + caption));
    container.appendChild(captionEl);
  }

  return container;
}

function createImagePreviewDOM(imagePath: string, caption: string | undefined, projectId: string, i18n: PreviewI18n): HTMLElement {
  const container = document.createElement("div");
  container.className = "cm-latex-tooltip cm-image-tooltip";

  const header = document.createElement("div");
  header.className = "cm-tooltip-header";
  header.textContent = i18n.imageTitle;
  container.appendChild(header);

  const imageContainer = document.createElement("div");
  imageContainer.className = "cm-preview-content cm-image-preview-content";

  const url = projectId ? `/api/projects/${projectId}/assets/${imagePath}` : imagePath;
  const img = document.createElement("img");
  img.src = url;
  img.className = "cm-image-preview";
  img.alt = caption || imagePath;
  img.onerror = () => {
    const fallback = document.createElement("div");
    fallback.className = "cm-preview-fallback";
    const iconDiv = document.createElement("div");
    iconDiv.className = "cm-fallback-icon";
    iconDiv.textContent = "🖼️";
    const textDiv = document.createElement("div");
    textDiv.className = "cm-fallback-text";
    textDiv.textContent = i18n.imageLoadFailed;
    const hintDiv = document.createElement("div");
    hintDiv.className = "cm-fallback-hint";
    hintDiv.textContent = imagePath;
    fallback.appendChild(iconDiv);
    fallback.appendChild(textDiv);
    fallback.appendChild(hintDiv);
    imageContainer.innerHTML = "";
    imageContainer.appendChild(fallback);
  };

  imageContainer.appendChild(img);
  container.appendChild(imageContainer);

  if (caption) {
    const captionEl = document.createElement("div");
    captionEl.className = "cm-preview-caption";
    const strongEl = document.createElement("strong");
    strongEl.textContent = "Figure:";
    captionEl.appendChild(strongEl);
    captionEl.appendChild(document.createTextNode(" " + caption));
    container.appendChild(captionEl);
  }

  return container;
}

// ============== Formula live preview (cursor-triggered) ==============

function createFormulaCursorTooltip(i18n: PreviewI18n) {
  return StateField.define<Tooltip | null>({
    create: () => null,
    update(tooltip, tr) {
      if (!tr.docChanged && !tr.selection) return tooltip;

      const state = tr.state;
      const { from, to } = state.selection.main;
      if (from !== to) return null; // Don't show when there is a selection

      const commentRanges = buildCommentRanges(state.doc);
      if (isInCommentRegion(commentRanges, from)) return null;

      const match = findMathAtCursor(state, from, commentRanges);
      if (!match) return null;

      return {
        pos: match.start,
        end: match.end,
        above: true,
        create: () => ({
          dom: createFormulaPreviewDOM(match.content, match.displayMode ?? false, i18n),
        }),
      };
    },
    provide: (f) => showTooltip.from(f),
  });
}

// ============== Table/image hover preview (mouse-triggered) ==============

function createTableImageHoverTooltip(i18n: PreviewI18n) {
  return hoverTooltip((view, pos) => {
    const state = view.state;
    const commentRanges = buildCommentRanges(state.doc);

    if (isInCommentRegion(commentRanges, pos)) return null;

    const match = findTableOrImageAtPos(state, pos, commentRanges);
    if (!match) return null;

    const projectId = state.field(projectIdField, false) || "";

    return {
      pos: match.start,
      end: match.end,
      above: true,
      create: () => {
        let dom: HTMLElement;
        if (match.type === "table") {
          dom = createTablePreviewDOM(match.rawLatex || match.content, match.caption, i18n);
        } else {
          dom = createImagePreviewDOM(match.imagePath || "", match.caption, projectId, i18n);
        }
        return { dom };
      },
    };
  }, { hoverTime: 300 });
}

// ============== Theme styles ==============

export const latexTooltipTheme = EditorView.theme({
  ".cm-latex-tooltip": {
    backgroundColor: "hsl(var(--popover))",
    border: "1px solid hsl(var(--border))",
    borderRadius: "8px",
    boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
    zIndex: "100",
    overflow: "hidden",
    maxWidth: "400px",
    minWidth: "200px"
  },
  ".cm-tooltip-header": {
    backgroundColor: "hsl(var(--muted))",
    padding: "6px 12px",
    fontSize: "11px",
    fontWeight: "600",
    borderBottom: "1px solid hsl(var(--border))",
    color: "hsl(var(--muted-foreground))",
    textTransform: "uppercase",
    letterSpacing: "0.5px"
  },
  ".cm-preview-content": {
    padding: "12px",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    minHeight: "60px"
  },
  ".cm-preview-caption": {
    textAlign: "center",
    fontStyle: "italic",
    fontSize: "12px",
    color: "hsl(var(--muted-foreground))",
    padding: "8px 12px",
    borderTop: "1px solid hsl(var(--border))",
    lineHeight: "1.5",
    wordWrap: "break-word",
    overflowWrap: "break-word"
  },
  ".cm-preview-caption strong": {
    fontStyle: "normal",
    fontWeight: "600",
    color: "hsl(var(--foreground))"
  },
  ".cm-table-preview-image": {
    maxWidth: "100%",
    maxHeight: "300px",
    objectFit: "contain",
    borderRadius: "4px"
  },
  ".cm-image-preview-content": {
    padding: "8px",
    backgroundColor: "hsl(var(--muted) / 0.3)"
  },
  ".cm-image-preview": {
    maxWidth: "320px",
    maxHeight: "240px",
    objectFit: "contain",
    borderRadius: "4px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.1)"
  },
  ".cm-preview-loading": {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "8px",
    color: "hsl(var(--muted-foreground))",
    fontSize: "12px",
    padding: "20px"
  },
  ".cm-loading-spinner": {
    width: "24px",
    height: "24px",
    border: "2px solid hsl(var(--border))",
    borderTopColor: "hsl(var(--primary))",
    borderRadius: "50%",
    animation: "cm-spin 0.8s linear infinite"
  },
  ".cm-preview-fallback": {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "4px",
    color: "hsl(var(--muted-foreground))",
    padding: "16px",
    textAlign: "center"
  },
  ".cm-fallback-icon": {
    fontSize: "32px",
    opacity: "0.5"
  },
  ".cm-fallback-text": {
    fontSize: "13px",
    fontWeight: "500"
  },
  ".cm-fallback-hint": {
    fontSize: "11px",
    opacity: "0.7",
    maxWidth: "200px",
    wordBreak: "break-all"
  },
  // HTML table styles (frontend rendering fallback)
  ".cm-html-table": {
    borderCollapse: "collapse",
    fontSize: "12px",
    width: "100%",
    maxWidth: "350px"
  },
  ".cm-html-table th, .cm-html-table td": {
    border: "1px solid hsl(var(--border))",
    padding: "6px 10px",
    textAlign: "left"
  },
  ".cm-html-table th": {
    backgroundColor: "hsl(var(--muted))",
    fontWeight: "600",
    fontSize: "11px"
  },
  ".cm-html-table tr:nth-child(even)": {
    backgroundColor: "hsl(var(--muted) / 0.3)"
  },
  ".cm-html-table code": {
    fontFamily: "monospace",
    fontSize: "11px",
    backgroundColor: "hsl(var(--muted))",
    padding: "1px 4px",
    borderRadius: "3px"
  },
  "@keyframes cm-spin": {
    "0%": { transform: "rotate(0deg)" },
    "100%": { transform: "rotate(360deg)" }
  }
});

// ============== Exports ==============

const defaultI18n = createPreviewI18n();

export const formulaCursorTooltip = createFormulaCursorTooltip(defaultI18n);
export const tableImageHoverTooltip = createTableImageHoverTooltip(defaultI18n);

// Backward-compatible export
export const latexCursorTooltip = formulaCursorTooltip;

export function createLatexPreviewExtension(_projectId?: string, t?: TranslateFunction): Extension[] {
  const i18n = createPreviewI18n(t);
  return [
    projectIdField,
    createFormulaCursorTooltip(i18n),      // Formula: cursor-triggered live preview
    createTableImageHoverTooltip(i18n),    // Table/image: hover preview
    latexTooltipTheme,
  ];
}
