/**
 * BibTeX parser and search utilities.
 * Parses .bib files and supports fuzzy citation search.
 */

/**
 * BibTeX entry types.
 */
export type BibEntryType =
  | "article"
  | "inproceedings"
  | "book"
  | "incollection"
  | "phdthesis"
  | "mastersthesis"
  | "techreport"
  | "misc"
  | "unpublished";

/**
 * BibTeX citation entry.
 */
export interface BibEntry {
  /** Citation key (e.g. "smith2024") */
  key: string;
  /** Entry type (e.g. "article") */
  type: BibEntryType | string;
  /** Title */
  title: string;
  /** Authors (raw format) */
  author: string;
  /** Parsed author list */
  authors: string[];
  /** Year */
  year: string;
  /** Journal name (article) */
  journal?: string;
  /** Conference name (inproceedings) */
  booktitle?: string;
  /** Publisher */
  publisher?: string;
  /** Volume */
  volume?: string;
  /** Issue number */
  number?: string;
  /** Pages */
  pages?: string;
  /** DOI */
  doi?: string;
  /** URL */
  url?: string;
  /** Source filename */
  sourceFile?: string;
  /** Raw BibTeX content */
  raw?: string;
}

/**
 * Search result.
 */
export interface BibSearchResult extends BibEntry {
  /** Match score (higher is more relevant) */
  score: number;
  /** Matched fields */
  matchedFields: string[];
}

/**
 * Parse a BibTeX string and extract all citation entries.
 * @param content BibTeX file content
 * @param sourceFile Source filename (optional)
 * @returns Parsed citation entries
 */
export function parseBibTeX(content: string, sourceFile?: string): BibEntry[] {
  const entries: BibEntry[] = [];

  // Regex that matches BibTeX entries.
  // Format: @type{key, field1 = {value1}, field2 = "value2", ...}
  // Note: [\s\S]*? matches any character including @ (needed for emails, URLs, etc.)
  const entryRegex = /@(\w+)\s*\{\s*([^,\s]+)\s*,([\s\S]*?)(?=\n\s*@|\n*$)/g;

  let match;
  while ((match = entryRegex.exec(content)) !== null) {
    const [raw, type, key, fieldsStr] = match;

    // Parse fields
    const fields = parseFields(fieldsStr);

    // Parse authors
    const authorStr = fields.author || "";
    const authors = parseAuthors(authorStr);

    const entry: BibEntry = {
      key: key.trim(),
      type: type.toLowerCase(),
      title: cleanValue(fields.title || ""),
      author: authorStr,
      authors,
      year: fields.year || "",
      journal: fields.journal ? cleanValue(fields.journal) : undefined,
      booktitle: fields.booktitle ? cleanValue(fields.booktitle) : undefined,
      publisher: fields.publisher ? cleanValue(fields.publisher) : undefined,
      volume: fields.volume,
      number: fields.number,
      pages: fields.pages,
      doi: fields.doi,
      url: fields.url,
      sourceFile,
      raw: raw.trim(),
    };

    entries.push(entry);
  }

  return entries;
}

/**
 * Parse BibTeX fields.
 */
function parseFields(fieldsStr: string): Record<string, string> {
  const fields: Record<string, string> = {};

  // Regex that matches fields.
  // Supports field = {value}, field = "value", or field = value
  const fieldRegex = /(\w+)\s*=\s*(?:\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}|"([^"]*)"|(\d+))/g;

  let match;
  while ((match = fieldRegex.exec(fieldsStr)) !== null) {
    const [, name, bracedValue, quotedValue, numberValue] = match;
    const value = bracedValue ?? quotedValue ?? numberValue ?? "";
    fields[name.toLowerCase()] = value.trim();
  }

  return fields;
}

/**
 * Parse an author string into a list of authors.
 * Supports multi-author format separated by "and".
 */
function parseAuthors(authorStr: string): string[] {
  if (!authorStr) return [];

  // Split by " and "
  return authorStr
    .split(/\s+and\s+/i)
    .map((author) => {
      // Handle "Last, First" format
      const parts = author.split(",").map((s) => s.trim());
      if (parts.length >= 2) {
        return `${parts[1]} ${parts[0]}`.trim();
      }
      return author.trim();
    })
    .filter((a) => a.length > 0);
}

/**
 * Clean a BibTeX value (remove braces, escapes, etc.).
 */
function cleanValue(value: string): string {
  return value
    .replace(/\{([^{}]*)\}/g, "$1") // Remove braces
    .replace(/\\[a-zA-Z]+\s*/g, "") // Remove LaTeX commands
    .replace(/\s+/g, " ") // Collapse extra whitespace
    .trim();
}

/**
 * Extract citations from all .bib files in a project file list.
 * @param files Project file list
 * @returns All citation entries
 */
export function extractBibEntries(files: ProjectFile[]): BibEntry[] {
  const entries: BibEntry[] = [];

  function traverse(fileList: ProjectFile[]) {
    for (const file of fileList) {
      if (file.type === "folder" && file.children) {
        traverse(file.children);
      } else if (file.name.endsWith(".bib") && file.content) {
        const fileEntries = parseBibTeX(file.content, file.name);
        entries.push(...fileEntries);
      }
    }
  }

  traverse(files);
  return entries;
}

/**
 * Project file type (simplified for this module).
 */
interface ProjectFile {
  id: string;
  name: string;
  type: "file" | "folder";
  content?: string;
  children?: ProjectFile[];
}

/**
 * Safely parse a year string to a number for sorting.
 * Returns the numeric year if parseable, otherwise returns -Infinity
 * to place entries with non-numeric years (e.g., "forthcoming", "in press", "n.d.") at the end.
 */
function parseYearForSort(year: string | undefined): number {
  if (!year) return -Infinity;
  const parsed = parseInt(year, 10);
  return Number.isNaN(parsed) ? -Infinity : parsed;
}

/**
 * Search citation entries.
 * @param entries Entry list
 * @param query Search query
 * @param maxResults Max number of results
 * @returns Matched entries (sorted by relevance)
 */
export function searchBibEntries(
  entries: BibEntry[],
  query: string,
  maxResults: number = 50
): BibSearchResult[] {
  if (!query.trim()) {
    // When query is empty, return all entries (sorted by year desc)
    return entries
      .map((entry) => ({
        ...entry,
        score: 0,
        matchedFields: [] as string[],
      }))
      .sort((a, b) => parseYearForSort(b.year) - parseYearForSort(a.year))
      .slice(0, maxResults);
  }

  const queryLower = query.toLowerCase().trim();
  const queryTerms = queryLower.split(/\s+/).filter((t) => t.length > 0);

  const results: BibSearchResult[] = [];

  for (const entry of entries) {
    const { score, matchedFields } = calculateMatchScore(entry, queryTerms);

    if (score > 0) {
      results.push({
        ...entry,
        score,
        matchedFields,
      });
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  return results.slice(0, maxResults);
}

/**
 * Compute match score.
 */
function calculateMatchScore(
  entry: BibEntry,
  queryTerms: string[]
): { score: number; matchedFields: string[] } {
  let score = 0;
  const matchedFields: string[] = [];

  // Field weights
  const fieldWeights: Record<string, number> = {
    key: 10,      // Citation key has the highest weight
    title: 8,     // Title has a high weight
    author: 6,    // Author
    year: 5,      // Year
    journal: 3,   // Journal
    booktitle: 3, // Conference
  };

  for (const term of queryTerms) {
    let termMatched = false;

    // Check citation key
    if (entry.key.toLowerCase().includes(term)) {
      score += fieldWeights.key * (entry.key.toLowerCase() === term ? 2 : 1);
      if (!matchedFields.includes("key")) matchedFields.push("key");
      termMatched = true;
    }

    // Check title
    if (entry.title.toLowerCase().includes(term)) {
      score += fieldWeights.title;
      if (!matchedFields.includes("title")) matchedFields.push("title");
      termMatched = true;
    }

    // Check author
    const authorStr = entry.author.toLowerCase();
    if (authorStr.includes(term)) {
      score += fieldWeights.author;
      if (!matchedFields.includes("author")) matchedFields.push("author");
      termMatched = true;
    }

    // Check year
    if (entry.year.includes(term)) {
      score += fieldWeights.year * (entry.year === term ? 2 : 1);
      if (!matchedFields.includes("year")) matchedFields.push("year");
      termMatched = true;
    }

    // Check journal
    if (entry.journal && entry.journal.toLowerCase().includes(term)) {
      score += fieldWeights.journal;
      if (!matchedFields.includes("journal")) matchedFields.push("journal");
      termMatched = true;
    }

    // Check conference/booktitle
    if (entry.booktitle && entry.booktitle.toLowerCase().includes(term)) {
      score += fieldWeights.booktitle;
      if (!matchedFields.includes("booktitle")) matchedFields.push("booktitle");
      termMatched = true;
    }

    // If a term doesn't match anywhere, sharply reduce the score
    if (!termMatched) {
      score *= 0.1;
    }
  }

  return { score, matchedFields };
}

/**
 * Highlight query terms in text.
 * @param text Original text
 * @param query Query string
 * @returns Text segments with highlight markers
 */
export function highlightMatch(
  text: string,
  query: string
): { text: string; isHighlight: boolean }[] {
  if (!query.trim() || !text) {
    return [{ text, isHighlight: false }];
  }

  const queryTerms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
  const result: { text: string; isHighlight: boolean }[] = [];

  let currentIndex = 0;
  const textLower = text.toLowerCase();

  // Find all match ranges
  const matches: { start: number; end: number }[] = [];

  for (const term of queryTerms) {
    let searchStart = 0;
    while (true) {
      const index = textLower.indexOf(term, searchStart);
      if (index === -1) break;
      matches.push({ start: index, end: index + term.length });
      searchStart = index + 1;
    }
  }

  // Sort by position and merge overlapping ranges
  matches.sort((a, b) => a.start - b.start);
  const mergedMatches: { start: number; end: number }[] = [];

  for (const match of matches) {
    if (mergedMatches.length === 0) {
      mergedMatches.push(match);
    } else {
      const last = mergedMatches[mergedMatches.length - 1];
      if (match.start <= last.end) {
        last.end = Math.max(last.end, match.end);
      } else {
        mergedMatches.push(match);
      }
    }
  }

  // Build result
  for (const match of mergedMatches) {
    if (currentIndex < match.start) {
      result.push({
        text: text.slice(currentIndex, match.start),
        isHighlight: false,
      });
    }
    result.push({
      text: text.slice(match.start, match.end),
      isHighlight: true,
    });
    currentIndex = match.end;
  }

  if (currentIndex < text.length) {
    result.push({
      text: text.slice(currentIndex),
      isHighlight: false,
    });
  }

  return result.length > 0 ? result : [{ text, isHighlight: false }];
}

/**
 * Format an author list for display.
 * @param authors Author list
 * @param maxAuthors Max authors to display
 * @returns Formatted author string
 */
export function formatAuthors(authors: string[], maxAuthors: number = 3): string {
  if (authors.length === 0) return "";
  if (authors.length <= maxAuthors) {
    return authors.join(", ");
  }
  return `${authors.slice(0, maxAuthors).join(", ")} et al.`;
}

/**
 * Get a display name for an entry type.
 */
export function getEntryTypeName(type: string): string {
  const typeNames: Record<string, string> = {
    article: "Article",
    inproceedings: "Conference",
    book: "Book",
    incollection: "Chapter",
    phdthesis: "PhD Thesis",
    mastersthesis: "Master's Thesis",
    techreport: "Tech Report",
    misc: "Misc",
    unpublished: "Unpublished",
  };
  return typeNames[type] || type;
}
