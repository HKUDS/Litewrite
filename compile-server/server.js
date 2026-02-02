/**
 * Litewrite LaTeX compile server
 *
 * Receives LaTeX project files, compiles with TeXLive, and returns a PDF.
 */

const express = require('express');
const cors = require('cors');
const { exec, spawn } = require('child_process');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const archiver = require('archiver');

const app = express();
const PORT = process.env.PORT || 3002;
// Compile directory: Windows uses ./temp, Unix uses /tmp/latex-compile
const COMPILE_DIR = process.env.COMPILE_DIR || (process.platform === 'win32'
  ? path.join(__dirname, 'temp')
  : '/tmp/latex-compile');

// ==================== Sandbox safety configuration ====================

// Compile timeout (ms) - large projects may need longer
const COMPILE_TIMEOUT = parseInt(process.env.COMPILE_TIMEOUT) || 300000; // 300s = 5 minutes

// Max concurrent compiles
const MAX_CONCURRENT_COMPILES = parseInt(process.env.MAX_CONCURRENT_COMPILES) || 10;

// Max queue size - requests beyond concurrency are queued
const MAX_QUEUE_SIZE = parseInt(process.env.MAX_QUEUE_SIZE) || 30;

// Queue timeout (ms) - requests waiting longer than this will fail
const QUEUE_TIMEOUT = parseInt(process.env.QUEUE_TIMEOUT) || 60000; // 60s

// Max request size (bytes) - review papers may include many large images
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE) || 200 * 1024 * 1024; // 200MB

// Max single file size (bytes) - prevent one huge file
const MAX_SINGLE_FILE_SIZE = parseInt(process.env.MAX_SINGLE_FILE_SIZE) || 50 * 1024 * 1024; // 50MB

// Max file count
const MAX_FILE_COUNT = parseInt(process.env.MAX_FILE_COUNT) || 1000;

// Number of currently running compile jobs
let currentCompileCount = 0;

// Request queue
const compileQueue = [];

// Queue stats
let queueStats = {
  totalQueued: 0,
  totalProcessed: 0,
  totalTimedOut: 0,
};

/**
 * Release one compile slot and process the queue.
 */
function releaseCompileSlot() {
  currentCompileCount--;
  // Process waiting requests
  processQueue();
}

// Periodically clean leftover temp directories (hourly)
setInterval(async () => {
  try {
    const entries = await fs.readdir(COMPILE_DIR, { withFileTypes: true });
    const now = Date.now();
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const dirPath = path.join(COMPILE_DIR, entry.name);
        const stats = await fs.stat(dirPath);
        // Delete temp directories older than 1 hour
        if (now - stats.mtimeMs > 3600000) {
          await fs.rm(dirPath, { recursive: true, force: true });
          console.log(`[Cleanup] Deleted leftover directory: ${entry.name}`);
        }
      }
    }
  } catch (e) {
    // Ignore cleanup errors
  }
}, 3600000);

/**
 * Dangerous LaTeX command patterns
 * These may be used to execute system commands or read/write arbitrary files.
 *
 * NOTE: This is a first-line filter. Real safety relies on -no-shell-escape.
 * Regex checks can be bypassed (e.g. via \\csname/\\expandafter), but -no-shell-escape
 * still prevents shell execution.
 */
const DANGEROUS_PATTERNS = [
  // ========== Shell escape (system command execution) ==========
  // Basic \\write18 detection
  { pattern: /\\write\s*18/gi, name: 'write18', description: 'Execute system commands' },
  { pattern: /\\immediate\s*\\write\s*18/gi, name: 'immediate write18', description: 'Execute system commands immediately' },
  { pattern: /\\ShellEscape/gi, name: 'ShellEscape', description: 'Shell escape' },

  // Dynamic command construction (\\csname write\\endcsname 18)
  { pattern: /\\csname\s*write\s*\\endcsname\s*18/gi, name: 'csname write18', description: 'Dynamically construct write18' },

  // ========== File operations (arbitrary file read/write) ==========
  // NOTE: Only detect true absolute paths (starting with '/'); avoid matching normal LaTeX
  // syntax like \\openout\\@auxout. A looser rule can cause false positives.
  { pattern: /\\openout\s*\\?\w*\s*=?\s*["']?\//gi, name: 'openout with path', description: 'Write to an absolute path' },
  { pattern: /\\openin\s*\\?\w*\s*=?\s*["']?\//gi, name: 'openin with path', description: 'Read from an absolute path' },
  { pattern: /\\input\s*\{\s*[|"'`]/gi, name: 'input pipe', description: 'Pipe input command' },
  { pattern: /\\input\s*\{\s*\/(?!usr\/share\/texlive|usr\/share\/texmf)/gi, name: 'input absolute path', description: 'Read from an absolute path' },
  { pattern: /\\include\s*\{\s*[\/\\]/gi, name: 'include absolute path', description: 'Include an absolute path file' },

  // Additional file read commands
  { pattern: /\\CatchFileDef\s*\{[^}]*\}\s*\{[\/\\~]/gi, name: 'CatchFileDef', description: 'Read arbitrary files into a macro' },
  { pattern: /\\pdffiledump/gi, name: 'pdffiledump', description: 'Read binary file content' },
  { pattern: /\\@@input\s*\{[\/\\]/gi, name: '@@input', description: 'Internal input command' },

  // ========== Sensitive file access ==========
  { pattern: /\/etc\/(passwd|shadow|hosts|sudoers)/gi, name: 'etc sensitive', description: 'Access sensitive system files' },
  // NOTE: Avoid a naive /proc/ check because standard packages may contain strings like
  // "algo/proc/func" in comments/docs. Only detect /proc paths within explicit file ops.
  { pattern: /\\(input|include|openin|openout|InputIfFileExists)\s*[{=]\s*["']?\/proc\//gi, name: 'proc access', description: 'Access /proc filesystem' },
  // NOTE: Avoid ~/\\. because '~' in LaTeX is a non-breaking space and can cause false positives.
  // { pattern: /~\/\./gi, name: 'home dotfile', description: 'access user dotfiles' },
  { pattern: /\/root\//gi, name: 'root home', description: 'Access /root directory' },

  // ========== LuaTeX dangerous calls ==========
  { pattern: /\\directlua\s*\{[^}]*os\s*\.\s*(execute|popen|remove|rename|getenv)/gi, name: 'directlua os', description: 'Lua: execute system commands' },
  { pattern: /\\directlua\s*\{[^}]*io\s*\.\s*(open|popen|lines)/gi, name: 'directlua io', description: 'Lua: file operations' },
  { pattern: /\\directlua\s*\{[^}]*package\s*\.\s*loadlib/gi, name: 'directlua loadlib', description: 'Lua: load dynamic libraries' },
  { pattern: /\\directlua\s*\{[^}]*debug\s*\./gi, name: 'directlua debug', description: 'Lua: debug library' },
  { pattern: /\\directlua\s*\{[^}]*ffi\s*\./gi, name: 'directlua ffi', description: 'Lua: FFI calls' },

  // ========== Resource exhaustion (best-effort) ==========
  // NOTE: Only obvious patterns can be detected; variants rely on timeouts.
  // Overly broad recursion/loop regexes tend to false-positive standard packages.
];

/**
 * Validate LaTeX content security.
 * @param {string} content - LaTeX content
 * @param {string} filename - Filename (for logs)
 * @returns {{ safe: boolean, violations: Array<{pattern: string, description: string}> }}
 */
function validateLatexSecurity(content, filename = 'unknown') {
  const violations = [];

  // Standard package files (.sty/.cls/.bst/...) usually come from trusted TeX distributions.
  // Relax some checks for these files (e.g. /proc may appear in docs/comments).
  const isStandardPackage = /\.(sty|cls|bst|def|clo|cfg|fd)$/i.test(filename);

  // Checks to skip for package files
  const skipForPackages = ['proc access', 'etc sensitive', 'root home'];

  for (const { pattern, name, description, maxCount } of DANGEROUS_PATTERNS) {
    // Skip some checks for standard package files
    if (isStandardPackage && skipForPackages.includes(name)) {
      continue;
    }

    const matches = content.match(pattern);
    if (matches) {
      // Some patterns allow a small amount (e.g. ../ in normal relative paths)
      if (maxCount && matches.length <= maxCount) {
        continue;
      }
      violations.push({
        pattern: name,
        description,
        count: matches.length,
        sample: matches[0].substring(0, 50),
      });
    }
  }

  if (violations.length > 0) {
    console.warn(`[Security] File ${filename} has ${violations.length} security violations:`);
    violations.forEach(v => console.warn(`  - ${v.pattern}: ${v.description} (${v.count} matches)`));
  }

  return {
    safe: violations.length === 0,
    violations,
  };
}

/**
 * Unicode pre-processing
 * Converts common Unicode punctuation into LaTeX-safe equivalents.
 * Helps avoid missing glyphs when fonts do not support certain Unicode characters.
 * @param {string} content - LaTeX content
 * @returns {string} - Processed content
 */
function preprocessUnicodeCharacters(content) {
  // Simple replacement map (applied outside special contexts).
  // NOTE: replacements are applied per-character in a second pass (not a global replace)
  // to avoid modifying verbatim, comments, and math mode.
  const simpleReplacements = new Map([
    // Dashes
    ['\u2014', '---'],   // em dash (U+2014) —
    ['\u2013', '--'],    // en dash (U+2013) –

    // Quotes
    ['\u201C', '``'],    // left double quote (U+201C) "
    ['\u201D', "''"],    // right double quote (U+201D) "
    ['\u2018', '`'],     // left single quote (U+2018) '
    ['\u2019', "'"],     // right single quote (U+2019) '

    // Ellipsis
    ['\u2026', '\\ldots{}'],  // ellipsis (U+2026) …
  ]);

  // Math symbols: avoid introducing `$...$` inside existing math environments (nested math mode).
  // Example: `$a × b$` replaced with `$a $\\times$ b$` would break compilation.
  const unicodeMathCommands = new Map([
    ['×', '\\times'],
    ['÷', '\\div'],
    ['±', '\\pm'],
    ['≤', '\\leq'],
    ['≥', '\\geq'],
    ['≠', '\\neq'],
    ['→', '\\rightarrow'],
    ['←', '\\leftarrow'],
    ['∞', '\\infty'],
  ]);

  // Text-mode symbols: these commands must be used in text mode.
  // In math mode, wrap with \\text{} (requires amsmath).
  const unicodeTextCommands = new Map([
    ['©', '\\textcopyright{}'],    // copyright (U+00A9)
    ['®', '\\textregistered{}'],   // registered trademark (U+00AE)
    ['™', '\\texttrademark{}'],    // trademark (U+2122)
  ]);

  const mathEnvironments = new Set([
    'math',
    'displaymath',
    'equation',
    'align',
    'gather',
    'multline',
    'eqnarray',
    'flalign',
    'alignat',
  ]);

  // Verbatim environments: content inside should be kept as-is
  const verbatimEnvironments = new Set([
    'verbatim',
    'lstlisting',
    'minted',
    'Verbatim',      // fancyvrb package
    'BVerbatim',     // fancyvrb package
    'LVerbatim',     // fancyvrb package
    'alltt',         // alltt package (partial verbatim)
    'comment',       // comment environment from verbatim package
  ]);

  function isEscapedByBackslash(str, idx) {
    // Whether the character at idx is escaped by an odd number of backslashes (e.g. `\\$`)
    let backslashes = 0;
    for (let i = idx - 1; i >= 0 && str[i] === '\\'; i--) {
      backslashes++;
    }
    return backslashes % 2 === 1;
  }

  let out = '';
  let inlineMathDelim = null; // 'dollar1' | 'dollar2' | 'paren' | 'bracket' | null
  let mathEnvDepth = 0;
  // Track verbatim environments with a stack (handles nested examples).
  // When lstlisting contains a \\begin{verbatim}...\\end{verbatim} example,
  // we must match each \\begin and \\end correctly.
  const verbatimEnvStack = [];
  let inComment = false; // Whether we are inside a LaTeX comment (% to end of line)

  for (let i = 0; i < content.length; ) {
    // Newline exits comment mode
    if (content[i] === '\n') {
      inComment = false;
      out += content[i];
      i += 1;
      continue;
    }

    // LaTeX comments: an unescaped % starts a comment until end of line.
    // NOTE: In verbatim environments, % is not a comment.
    if (content[i] === '%' && !isEscapedByBackslash(content, i) && verbatimEnvStack.length === 0) {
      inComment = true;
      out += content[i];
      i += 1;
      continue;
    }

    // Inside a comment: copy verbatim and skip all replacements/state tracking
    if (inComment) {
      out += content[i];
      i += 1;
      continue;
    }

    // Handle \\verb command (inline verbatim)
    // Format: \\verb|content| or \\verb*|content| where '|' can be any non-letter delimiter.
    // NOTE: In standard LaTeX, \\verb must be immediately followed by a non-letter delimiter.
    // \\verbatim, \\verbc, etc. are different commands and must not be treated as \\verb.
    if (content.startsWith('\\verb', i) && verbatimEnvStack.length === 0) {
      let verbStart = i + 5; // Skip "\\verb"
      // Check for \\verb*
      if (content[verbStart] === '*') {
        verbStart++;
      }
      // Get delimiter: must be a non-letter character.
      // If delimiter is a letter, this is not a \\verb command (could be \\verbatim, etc.).
      if (verbStart < content.length) {
        const delimiter = content[verbStart];
        // Verify delimiter is not a letter (required by LaTeX spec)
        const isLetter = /^[a-zA-Z]$/.test(delimiter);
        if (!isLetter) {
          // Find closing delimiter
          const endDelim = content.indexOf(delimiter, verbStart + 1);
          if (endDelim !== -1) {
            // Copy the entire \\verb command without any replacements
            out += content.slice(i, endDelim + 1);
            i = endDelim + 1;
            continue;
          }
        }
        // If delimiter is a letter, skip and let later logic handle it normally
      }
    }

    // Handle \\begin{...} / \\end{...}
    if (content[i] === '\\') {
      if (content.startsWith('\\begin{', i) || content.startsWith('\\end{', i)) {
        const isBegin = content.startsWith('\\begin{', i);
        const prefixLen = isBegin ? 7 : 5; // "\begin{" or "\end{"
        const start = i + prefixLen;
        const endBrace = content.indexOf('}', start);
        if (endBrace !== -1) {
          const rawEnv = content.slice(start, endBrace).trim();
          const env = rawEnv.endsWith('*') ? rawEnv.slice(0, -1) : rawEnv;

          // Detect verbatim environments
          if (verbatimEnvironments.has(env)) {
            if (isBegin) {
              // Only push when we are not already inside verbatim.
              // Inside verbatim, \\begin{} is literal text and should not be tracked.
              if (verbatimEnvStack.length === 0) {
                verbatimEnvStack.push(rawEnv);
              }
            } else {
              // Match against the stack top.
              // In LaTeX, starred and non-starred environments are distinct and must match exactly.
              // Example: \\begin{lstlisting*} must be closed by \\end{lstlisting*}.
              const topEnv = verbatimEnvStack[verbatimEnvStack.length - 1];
              if (topEnv && rawEnv === topEnv) {
                verbatimEnvStack.pop();
              }
            }
          }
          // Track math environments (only outside verbatim)
          else if (mathEnvironments.has(env) && verbatimEnvStack.length === 0) {
            if (isBegin) {
              mathEnvDepth++;
            } else {
              mathEnvDepth = Math.max(0, mathEnvDepth - 1);
            }
          }

          out += content.slice(i, endBrace + 1);
          i = endBrace + 1;
          continue;
        }
      }

      // Handle \\( \\) \\[ \\] (only outside verbatim)
      if (verbatimEnvStack.length === 0 && i + 1 < content.length) {
        const next = content[i + 1];
        if (next === '(') {
          inlineMathDelim = inlineMathDelim ?? 'paren';
          out += '\\(';
          i += 2;
          continue;
        }
        if (next === ')' && inlineMathDelim === 'paren') {
          inlineMathDelim = null;
          out += '\\)';
          i += 2;
          continue;
        }
        if (next === '[') {
          inlineMathDelim = inlineMathDelim ?? 'bracket';
          out += '\\[';
          i += 2;
          continue;
        }
        if (next === ']' && inlineMathDelim === 'bracket') {
          inlineMathDelim = null;
          out += '\\]';
          i += 2;
          continue;
        }
      }
    }

    // Inside verbatim: copy characters as-is (no replacements)
    if (verbatimEnvStack.length > 0) {
      out += content[i];
      i += 1;
      continue;
    }

    // Handle $...$ and $$...$$
    if (content[i] === '$' && !isEscapedByBackslash(content, i)) {
      const isDouble = i + 1 < content.length && content[i + 1] === '$';
      if (isDouble) {
        if (inlineMathDelim === null) {
          inlineMathDelim = 'dollar2';
        } else if (inlineMathDelim === 'dollar2') {
          inlineMathDelim = null;
        }
        out += '$$';
        i += 2;
        continue;
      }

      if (inlineMathDelim === null) {
        inlineMathDelim = 'dollar1';
      } else if (inlineMathDelim === 'dollar1') {
        inlineMathDelim = null;
      }
      out += '$';
      i += 1;
      continue;
    }

    // Determine whether we're in math mode
    const inMathMode = inlineMathDelim !== null || mathEnvDepth > 0;

    // Apply simple replacements (dashes/quotes/ellipsis).
    // Only apply outside math mode; keep original characters inside math mode.
    const simpleReplacement = simpleReplacements.get(content[i]);
    if (simpleReplacement && !inMathMode) {
      out += simpleReplacement;
      i += 1;
      continue;
    }

    // Math symbols
    const cmd = unicodeMathCommands.get(content[i]);
    if (cmd) {
      out += inMathMode ? cmd : `$${cmd}$`;
      i += 1;
      continue;
    }

    // Text-mode symbols (©, ®, ™)
    // These commands should be used in text mode.
    const textCmd = unicodeTextCommands.get(content[i]);
    if (textCmd) {
      // Wrap in \\text{} in math mode; use directly in text mode
      out += inMathMode ? `\\text{${textCmd}}` : textCmd;
      i += 1;
      continue;
    }

    out += content[i];
    i += 1;
  }

  return out;
}

/**
 * Preprocess LaTeX compatibility issues.
 * Mainly handles encoding-related pitfalls to avoid content corruption during transport.
 * @param {string} content - LaTeX content
 * @param {string} compiler - Compiler type (pdflatex, xelatex, lualatex, latex)
 * @returns {string} - Processed content
 */
function preprocessLatexCompatibility(content, compiler) {
  let result = content;

  // Convert non-breaking spaces (U+00A0) to regular spaces.
  // This is critical because NBSP can break parsing in LaTeX command options.
  result = result.replace(/\u00A0/g, ' ');

  return result;
}

/**
 * Replace Windows-only fonts with TeX Live open-source alternatives.
 * Important for XeLaTeX in Docker containers where Windows fonts are unavailable.
 * @param {string} content - LaTeX/cls/sty file content
 * @returns {string} - Processed content
 */
function replaceWindowsFonts(content) {
  let result = content;
  let replacedCount = 0;

  // Font replacement map (Windows fonts -> TeX Gyre alternatives)
  const fontReplacements = [
    // Times New Roman -> TeX Gyre Termes
    { from: /\\setmainfont\s*\{Times New Roman\}/g, to: '\\setmainfont{TeX Gyre Termes}', name: 'Times New Roman -> TeX Gyre Termes' },
    { from: /\\setmainfont\s*\[([^\]]*)\]\s*\{Times New Roman\}/g, to: '\\setmainfont[$1]{TeX Gyre Termes}', name: 'Times New Roman (with options)' },
    // Arial -> TeX Gyre Heros
    { from: /\\setsansfont\s*\{Arial\}/g, to: '\\setsansfont{TeX Gyre Heros}', name: 'Arial -> TeX Gyre Heros' },
    { from: /\\setsansfont\s*\[([^\]]*)\]\s*\{Arial\}/g, to: '\\setsansfont[$1]{TeX Gyre Heros}', name: 'Arial (with options)' },
    // Courier New -> TeX Gyre Cursor
    { from: /\\setmonofont\s*\{Courier New\}/g, to: '\\setmonofont{TeX Gyre Cursor}', name: 'Courier New -> TeX Gyre Cursor' },
    { from: /\\setmonofont\s*\[([^\]]*)\]\s*\{Courier New\}/g, to: '\\setmonofont[$1]{TeX Gyre Cursor}', name: 'Courier New (with options)' },
  ];

  for (const { from, to, name } of fontReplacements) {
    // Use match instead of test to avoid lastIndex pitfalls
    const matches = result.match(from);
    if (matches && matches.length > 0) {
      console.log(`[FontReplace] Replaced font: ${name} (${matches.length} occurrences)`);
      result = result.replace(from, to);
      replacedCount += matches.length;
    }
  }

  if (replacedCount > 0) {
    console.log(`[FontReplace] Replaced ${replacedCount} font references in total`);
  }

  return result;
}

/**
 * Validate file path safety (prevent path traversal).
 * @param {string} filename - Filename
 * @param {string} baseDir - Base directory
 * @returns {boolean}
 */
function validateFilePath(filename, baseDir) {
  // Normalize paths
  const normalizedBase = path.resolve(baseDir);
  const normalizedFile = path.resolve(baseDir, filename);

  // Ensure file is within base directory.
  // Use normalizedBase + path.sep to require a full directory match and avoid sibling dir bypass.
  // Example: prevent /tmp/abc-malicious from passing /tmp/abc checks.
  if (!normalizedFile.startsWith(normalizedBase + path.sep) && normalizedFile !== normalizedBase) {
    console.warn(`[Security] Path traversal attempt: ${filename} -> ${normalizedFile}`);
    return false;
  }

  // Check whether filename contains dangerous characters
  const dangerousChars = /[<>:"|?*\x00-\x1f]/;
  if (dangerousChars.test(filename)) {
    console.warn(`[Security] Filename contains dangerous characters: ${filename}`);
    return false;
  }

  return true;
}

/**
 * Validate main file safety (prevent command injection).
 * @param {string} mainFile - Main filename
 * @param {string} baseDir - Base directory
 * @param {object} projectFiles - Project files object (used to verify existence)
 * @returns {{ valid: boolean, error?: string }}
 */
function validateMainFile(mainFile, baseDir, projectFiles) {
  // 1) mainFile must exist and be a string
  if (!mainFile || typeof mainFile !== 'string') {
    return { valid: false, error: 'Main file is missing or invalid' };
  }

  // 2) Validate extension
  if (!mainFile.endsWith('.tex')) {
    return { valid: false, error: 'Main file must be a .tex file' };
  }

  // 3) Validate path (prevent traversal and basic dangerous characters)
  if (!validateFilePath(mainFile, baseDir)) {
    return { valid: false, error: `Invalid main file path: ${mainFile}` };
  }

  // 4) Check shell metacharacters (prevent breaking out of quotes / command injection)
  // These characters may be used to escape double quotes or inject commands.
  const shellMetaChars = /[`$\\'"!;&|(){}[\]<>\n\r]/;
  if (shellMetaChars.test(mainFile)) {
    console.warn(`[Security] Main file name contains shell metacharacters: ${mainFile}`);
    return { valid: false, error: 'Main file name contains invalid characters' };
  }

  // 5) Ensure mainFile exists in projectFiles
  if (!projectFiles.hasOwnProperty(mainFile)) {
    return { valid: false, error: `Main file "${mainFile}" is not in the project file list` };
  }

  return { valid: true };
}

/**
 * Concurrency limiter middleware.
 * Atomically checks and increments the counter to prevent race conditions.
 */
/**
 * Process the next request in the queue.
 */
function processQueue() {
  while (compileQueue.length > 0 && currentCompileCount < MAX_CONCURRENT_COMPILES) {
    const { resolve, req, addedAt } = compileQueue.shift();

    // Check whether this queued request has timed out
    if (Date.now() - addedAt > QUEUE_TIMEOUT) {
      queueStats.totalTimedOut++;
      // Skip processing; the Promise.race timeout handler will respond
      continue;
    }

    currentCompileCount++;
    req.compileCountIncremented = true;
    queueStats.totalProcessed++;
    resolve();
  }
}

/**
 * Concurrency limiter middleware with request queueing.
 */
function concurrencyLimiter(req, res, next) {
  // If there is capacity, process immediately
  if (currentCompileCount < MAX_CONCURRENT_COMPILES) {
    currentCompileCount++;
    req.compileCountIncremented = true;
    return next();
  }

  // Reject if queue is full
  if (compileQueue.length >= MAX_QUEUE_SIZE) {
    console.warn(`[Queue] Queue full: ${compileQueue.length}/${MAX_QUEUE_SIZE}, concurrent: ${currentCompileCount}/${MAX_CONCURRENT_COMPILES}`);
    return res.status(429).json({
      success: false,
      errorCode: 'QUEUE_FULL',
      error: 'Server busy, queue is full. Please try again later.',
      queueSize: compileQueue.length,
      currentCompiles: currentCompileCount,
    });
  }

  // Enqueue and wait
  const addedAt = Date.now();
  const queuePosition = compileQueue.length + 1;
  queueStats.totalQueued++;

  console.log(`[Queue] Request enqueued: position ${queuePosition}, queue size: ${compileQueue.length + 1}/${MAX_QUEUE_SIZE}`);

  const waitPromise = new Promise((resolve, reject) => {
    compileQueue.push({ resolve, reject, req, addedAt });
  });

  // Set queue timeout
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      // Remove timed-out request from the queue
      const index = compileQueue.findIndex(item => item.req === req);
      if (index !== -1) {
        compileQueue.splice(index, 1);
        queueStats.totalTimedOut++;
      }
      reject(new Error('QUEUE_TIMEOUT'));
    }, QUEUE_TIMEOUT);
  });

  Promise.race([waitPromise, timeoutPromise])
    .then(() => {
      next();
    })
    .catch((err) => {
      if (err.message === 'QUEUE_TIMEOUT') {
        console.warn(`[Queue] Queue timeout: waited ${QUEUE_TIMEOUT / 1000}s`);
        return res.status(408).json({
          success: false,
          errorCode: 'QUEUE_TIMEOUT',
          error: 'Queue timeout. Server is very busy. Please try again later.',
          waitedMs: QUEUE_TIMEOUT,
        });
      }
      return res.status(500).json({
        success: false,
        errorCode: 'QUEUE_ERROR',
        error: err.message,
      });
    });
}

/**
 * Request size validation middleware.
 */
function validateRequestSize(req, res, next) {
  const contentLength = parseInt(req.headers['content-length'] || '0');
  if (contentLength > MAX_FILE_SIZE) {
    console.warn(`[Security] Request too large: ${contentLength} bytes > ${MAX_FILE_SIZE} bytes`);
    return res.status(413).json({
      success: false,
      error: `Request too large. Max allowed ${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB`,
    });
  }
  next();
}

/**
 * Validate a single file size.
 * @param {string} content - File content
 * @param {string} filename - Filename
 * @param {boolean} isBase64 - Whether content is base64-encoded (binary file)
 * @returns {{ valid: boolean, size: number, error?: string }}
 */
function validateSingleFileSize(content, filename, isBase64 = false) {
  // Base64-decoded size is roughly 3/4 of the original string length
  const size = isBase64 ? Math.ceil(content.length * 0.75) : content.length;

  if (size > MAX_SINGLE_FILE_SIZE) {
    return {
      valid: false,
      size,
      error: `File "${filename}" is too large (${Math.round(size / 1024 / 1024)}MB). Max per-file size is ${Math.round(MAX_SINGLE_FILE_SIZE / 1024 / 1024)}MB`,
    };
  }

  return { valid: true, size };
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '200mb' }));
app.use(validateRequestSize);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'litewrite-compile',
    security: {
      sandboxEnabled: true,
      shellEscapeDisabled: true,
      dangerousPatternCount: DANGEROUS_PATTERNS.length,
    },
    limits: {
      maxConcurrent: MAX_CONCURRENT_COMPILES,
      currentConcurrent: currentCompileCount,
      maxQueueSize: MAX_QUEUE_SIZE,
      currentQueueSize: compileQueue.length,
      queueTimeoutMs: QUEUE_TIMEOUT,
      compileTimeoutMs: COMPILE_TIMEOUT,
      maxTotalSizeMB: Math.round(MAX_FILE_SIZE / 1024 / 1024),
      maxSingleFileSizeMB: Math.round(MAX_SINGLE_FILE_SIZE / 1024 / 1024),
      maxFileCount: MAX_FILE_COUNT,
    },
  });
});

// Security status endpoint
app.get('/security-status', (req, res) => {
  res.json({
    sandbox: {
      enabled: true,
      features: [
        'Dangerous LaTeX command detection (write18, openout, path traversal, etc.)',
        'Shell escape disabled (-no-shell-escape)',
        'File path validation (prevents path traversal)',
        'Per-file size limit',
        'Compile timeout limit',
        'Concurrent compile limit',
        'Request size limit',
        'Periodic cleanup of leftover temp directories',
      ],
    },
    blockedPatterns: DANGEROUS_PATTERNS.map(p => ({
      name: p.name,
      description: p.description,
    })),
    limits: {
      compileTimeout: `${COMPILE_TIMEOUT / 1000} seconds`,
      maxConcurrent: MAX_CONCURRENT_COMPILES,
      maxTotalSize: `${Math.round(MAX_FILE_SIZE / 1024 / 1024)} MB`,
      maxSingleFileSize: `${Math.round(MAX_SINGLE_FILE_SIZE / 1024 / 1024)} MB`,
      maxFileCount: MAX_FILE_COUNT,
    },
    notes: [
      'Dangerous command detection is the first line of defense; real security relies on -no-shell-escape',
      'Regex checks may be bypassed (e.g. via \\\\csname), but -no-shell-escape still prevents shell execution',
      'Resource exhaustion (infinite loops, etc.) is mitigated by compile timeouts',
    ],
  });
});

/**
 * Compile a LaTeX project.
 * POST /compile
 * Body: {
 *   mainFile: string,
 *   projectFiles: { [filename]: content },  // Text files
 *   binaryFiles?: { [filename]: base64Content }  // Binary files (optional)
 * }
 */
app.post('/compile', concurrencyLimiter, async (req, res) => {
  const { mainFile, compiler = 'pdflatex', projectFiles, binaryFiles = {} } = req.body;
  const jobId = uuidv4();

  // Validate compiler option
  const validCompilers = ['pdflatex', 'xelatex', 'lualatex', 'latex'];
  const selectedCompiler = validCompilers.includes(compiler) ? compiler : 'pdflatex';
  console.log(`[${jobId}] Using compiler: ${selectedCompiler}`);
  const jobDir = path.join(COMPILE_DIR, jobId);

  // Validate required parameters first
  if (!projectFiles || typeof projectFiles !== 'object') {
    // Counter was incremented in concurrencyLimiter; decrement it on early return
    releaseCompileSlot();
    return res.status(400).json({
      success: false,
      error: 'Missing required parameter: projectFiles',
    });
  }

  // Counter was atomically incremented in concurrencyLimiter
  console.log(`[${jobId}] Starting compile job. Main file: ${mainFile} (concurrent: ${currentCompileCount}/${MAX_CONCURRENT_COMPILES})`);
  console.log(`[${jobId}] Text files: ${Object.keys(projectFiles).length}, binary files: ${Object.keys(binaryFiles).length}`);

  // ========== Safety checks ==========

  // 1) File count
  const totalFiles = Object.keys(projectFiles).length + Object.keys(binaryFiles).length;
  if (totalFiles > MAX_FILE_COUNT) {
    releaseCompileSlot();
    console.warn(`[${jobId}] [Security] File count limit exceeded: ${totalFiles} > ${MAX_FILE_COUNT}`);
    return res.status(400).json({
      success: false,
      error: `File count limit exceeded. Max allowed ${MAX_FILE_COUNT}, current ${totalFiles}.`,
    });
  }

  // 2) Validate all file paths (prevent path traversal)
  const allFilenames = [...Object.keys(projectFiles), ...Object.keys(binaryFiles)];
  for (const filename of allFilenames) {
    if (!validateFilePath(filename, jobDir)) {
      releaseCompileSlot();
      return res.status(400).json({
        success: false,
        error: `Invalid file path: ${filename}`,
      });
    }
  }

  // 2.5) Validate main file (prevent command injection)
  const mainFileValidation = validateMainFile(mainFile, jobDir, projectFiles);
  if (!mainFileValidation.valid) {
    releaseCompileSlot();
    console.warn(`[${jobId}] [Security] Main file validation failed: ${mainFileValidation.error}`);
    return res.status(400).json({
      success: false,
      error: mainFileValidation.error,
    });
  }

  // 3) Validate per-file size
  let totalSize = 0;
  for (const [filename, content] of Object.entries(projectFiles)) {
    const sizeCheck = validateSingleFileSize(content, filename, false);
    if (!sizeCheck.valid) {
      releaseCompileSlot();
      return res.status(400).json({
        success: false,
        error: sizeCheck.error,
      });
    }
    totalSize += sizeCheck.size;
  }

  for (const [filename, content] of Object.entries(binaryFiles)) {
    const sizeCheck = validateSingleFileSize(content, filename, true);
    if (!sizeCheck.valid) {
      releaseCompileSlot();
      return res.status(400).json({
        success: false,
        error: sizeCheck.error,
      });
    }
    totalSize += sizeCheck.size;
  }

  console.log(`[${jobId}] Total file size: ${Math.round(totalSize / 1024 / 1024 * 100) / 100}MB`);

  // 4) Validate LaTeX content safety
  const securityViolations = [];
  for (const [filename, content] of Object.entries(projectFiles)) {
    if (filename.endsWith('.tex') || filename.endsWith('.sty') || filename.endsWith('.cls')) {
      const result = validateLatexSecurity(content, filename);
      if (!result.safe) {
        securityViolations.push({ filename, violations: result.violations });
      }
    }
  }

  if (securityViolations.length > 0) {
    releaseCompileSlot();
    console.warn(`[${jobId}] [Security] LaTeX security violations:`, JSON.stringify(securityViolations, null, 2));
    return res.status(400).json({
      success: false,
      error: 'SECURITY_RISK', // Error code; frontend translates via i18n
      errorCode: 'SECURITY_RISK',
      details: securityViolations.map(sv => ({
        file: sv.filename,
        issues: sv.violations.map(v => `${v.pattern}: ${v.description}`),
      })),
    });
  }

  console.log(`[${jobId}] Security checks passed`);

  try {
    // Create compile directory
    await fs.mkdir(jobDir, { recursive: true });

    // Write all text files
    for (const [filename, content] of Object.entries(projectFiles)) {
      const filePath = path.join(jobDir, filename);
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });

      // Preprocess .tex files
      let processedContent = content;
      if (filename.endsWith('.tex')) {
        // 1) LaTeX compatibility pre-processing (fix common compiler compatibility issues)
        // Must run before Unicode processing, because Unicode processing converts NBSP into '~'.
        processedContent = preprocessLatexCompatibility(content, selectedCompiler);
        // 2) Unicode character pre-processing
        processedContent = preprocessUnicodeCharacters(processedContent);
        // 3) For XeLaTeX/LuaLaTeX, replace Windows fonts with open-source alternatives
        if (selectedCompiler === 'xelatex' || selectedCompiler === 'lualatex') {
          processedContent = replaceWindowsFonts(processedContent);
        }
      }

      // Also apply font replacement for .cls/.sty (XeLaTeX/LuaLaTeX)
      if ((filename.endsWith('.cls') || filename.endsWith('.sty')) &&
          (selectedCompiler === 'xelatex' || selectedCompiler === 'lualatex')) {
        processedContent = replaceWindowsFonts(processedContent);
      }

      await fs.writeFile(filePath, processedContent, 'utf8');
      console.log(`[${jobId}] Wrote text file: ${filename}`);
    }

    // Write all binary files
    for (const [filename, base64Content] of Object.entries(binaryFiles)) {
      const filePath = path.join(jobDir, filename);
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });
      const buffer = Buffer.from(base64Content, 'base64');
      await fs.writeFile(filePath, buffer);
      console.log(`[${jobId}] Wrote binary file: ${filename} (${buffer.length} bytes)`);
    }

    // Run LaTeX compile (full flow: latex -> bibtex -> latex -> latex)
    // Add -synctex=1 to generate synctex.gz for PDF-source navigation
    // Safety flags:
    //   -no-shell-escape: disable shell command execution
    //   -interaction=nonstopmode: non-interactive mode
    // Cross-platform:
    // - Windows: use command name directly (TeX Live must be in PATH)
    // - Unix/Docker: use command name directly (TeX Live in PATH) or a specified bin path
    const isWindows = process.platform === 'win32';
    // Default: use command name (works in Docker where pdflatex is in PATH)
    // Override via TEXLIVE_BIN (e.g. /Library/TeX/texbin on macOS)
    const TEXLIVE_BIN = process.env.TEXLIVE_BIN || '';
    const mainFileWithoutExt = mainFile.replace(/\.tex$/, '');

    // Choose compiler:
    // - pdflatex: fast, good default for most docs
    // - xelatex: Unicode/CJK + system fonts
    // - lualatex: Lua support, most flexible
    // - latex: legacy compiler (DVI -> PDF) for older projects
    //
    // Smart BibTeX:
    // - If any .bib file exists, run bibtex
    // - If only .bbl exists (precompiled bibliography), skip bibtex to preserve it
    // - Use a subshell to check existence
    // - Recursively search .bib (supports subdirectories)
    // Cross-platform: PowerShell on Windows, find on Unix
    // Helper: prefix commands with TEXLIVE_BIN when set
    const getCmd = (cmd) => TEXLIVE_BIN ? `${TEXLIVE_BIN}/${cmd}` : cmd;

    const bibtexExe = isWindows ? 'bibtex' : getCmd('bibtex');
    const smartBibtexCmd = isWindows
      ? `powershell -Command "if (Get-ChildItem -Recurse -Filter *.bib -ErrorAction SilentlyContinue) { bibtex '${mainFileWithoutExt}' 2>$null }; exit 0"`
      : `(find . -name "*.bib" -type f 2>/dev/null | head -1 | grep -q . && ${bibtexExe} "${mainFileWithoutExt}" 2>/dev/null) || true`;

    let compileCmd;
    // Use ';' (not '&&') between compile steps so that even if pdflatex exits non-zero
    // (warnings/errors but still produces a PDF), bibtex and subsequent pdflatex runs still execute.
    if (selectedCompiler === 'latex') {
      // Legacy LaTeX flow: latex -> dvips -> ps2pdf
      if (isWindows) {
        // Windows: group with ( ) so if cd fails none of the commands run.
        // NOTE: Windows CMD uses ^ as line-continuation (not \\), so keep it one line.
        compileCmd = `cd "${jobDir}" && ( latex -no-shell-escape -interaction=nonstopmode -synctex=1 "${mainFile}" & ${smartBibtexCmd} & latex -no-shell-escape -interaction=nonstopmode -synctex=1 "${mainFile}" & latex -no-shell-escape -interaction=nonstopmode -synctex=1 "${mainFile}" & dvips -o "${mainFileWithoutExt}.ps" "${mainFileWithoutExt}.dvi" && ps2pdf "${mainFileWithoutExt}.ps" "${mainFileWithoutExt}.pdf" )`;
      } else {
        // Unix: group with { } so if cd fails none of the commands run.
        compileCmd = `cd "${jobDir}" && { \
          ${getCmd('latex')} -no-shell-escape -interaction=nonstopmode -synctex=1 "${mainFile}" ; \
          ${smartBibtexCmd} ; \
          ${getCmd('latex')} -no-shell-escape -interaction=nonstopmode -synctex=1 "${mainFile}" ; \
          ${getCmd('latex')} -no-shell-escape -interaction=nonstopmode -synctex=1 "${mainFile}" ; \
          ${getCmd('dvips')} -o "${mainFileWithoutExt}.ps" "${mainFileWithoutExt}.dvi" && \
          ${getCmd('ps2pdf')} "${mainFileWithoutExt}.ps" "${mainFileWithoutExt}.pdf" ; }`;
      }
    } else {
      // Modern compilers: generate PDF directly
      if (isWindows) {
        // Windows: group with ( ) so if cd fails none of the commands run.
        // NOTE: Windows CMD uses ^ as line-continuation (not \\), so keep it one line.
        compileCmd = `cd "${jobDir}" && ( ${selectedCompiler} -no-shell-escape -interaction=nonstopmode -synctex=1 "${mainFile}" & ${smartBibtexCmd} & ${selectedCompiler} -no-shell-escape -interaction=nonstopmode -synctex=1 "${mainFile}" & ${selectedCompiler} -no-shell-escape -interaction=nonstopmode -synctex=1 "${mainFile}" )`;
      } else {
        // Unix: group with { } so if cd fails none of the commands run.
        compileCmd = `cd "${jobDir}" && { \
          ${getCmd(selectedCompiler)} -no-shell-escape -interaction=nonstopmode -synctex=1 "${mainFile}" ; \
          ${smartBibtexCmd} ; \
          ${getCmd(selectedCompiler)} -no-shell-escape -interaction=nonstopmode -synctex=1 "${mainFile}" ; \
          ${getCmd(selectedCompiler)} -no-shell-escape -interaction=nonstopmode -synctex=1 "${mainFile}" ; }`;
      }
    }

    console.log(`[${jobId}] Running compile command (timeout: ${COMPILE_TIMEOUT / 1000}s)...`);

    exec(compileCmd, { timeout: COMPILE_TIMEOUT, maxBuffer: 10 * 1024 * 1024 }, async (error, stdout, stderr) => {
      const pdfPath = path.join(jobDir, `${mainFileWithoutExt}.pdf`);
      const logPath = path.join(jobDir, `${mainFileWithoutExt}.log`);
      const synctexPath = path.join(jobDir, `${mainFileWithoutExt}.synctex.gz`);

      try {
        // Read compile log
        let logs = '';
        try {
          logs = await fs.readFile(logPath, 'utf8');
        } catch (e) {
          logs = stdout + '\n' + stderr;
        }

        // Check whether PDF was generated
        try {
          await fs.access(pdfPath);

          // Read PDF file
          const pdfBuffer = await fs.readFile(pdfPath);
          const pdfBase64 = pdfBuffer.toString('base64');

          // Read SyncTeX file (if present)
          let synctexBase64 = null;
          try {
            await fs.access(synctexPath);
            const synctexBuffer = await fs.readFile(synctexPath);
            synctexBase64 = synctexBuffer.toString('base64');
            console.log(`[${jobId}] SyncTeX generated (${synctexBuffer.length} bytes)`);
          } catch (e) {
            console.log(`[${jobId}] SyncTeX was not generated`);
          }

          console.log(`[${jobId}] Compilation succeeded`);

          // Parse logs (also return structured logs on success)
          const { logs: parsedLogs, stats } = parseLatexLogs(logs);

          res.json({
            success: true,
            pdfBase64,
            synctexBase64,
            logs: sanitizeRawLogs(logs.slice(-10000)), // Raw logs (sanitized), last 10,000 chars
            parsedLogs,               // Structured logs (sanitized)
            logStats: stats,          // Log stats
          });
        } catch (e) {
          // PDF not generated; parse errors
          const { logs: parsedLogs, stats } = parseLatexLogs(logs);
          console.log(`[${jobId}] Compilation failed:`, stats.errors, 'errors');

          res.json({
            success: false,
            errors: parsedLogs.filter(l => l.severity === 'error'),
            parsedLogs,
            logStats: stats,
            logs: sanitizeRawLogs(logs.slice(-10000)),
          });
        }
      } finally {
        // Decrement concurrency counter
        releaseCompileSlot();
        console.log(`[${jobId}] Compile job finished (concurrent: ${currentCompileCount}/${MAX_CONCURRENT_COMPILES})`);

        // Cleanup compile directory (async, don't await)
        setTimeout(async () => {
          try {
            await fs.rm(jobDir, { recursive: true, force: true });
            console.log(`[${jobId}] Cleanup completed`);
          } catch (e) {
            console.error(`[${jobId}] Cleanup failed:`, e.message);
          }
        }, 5000);
      }
    });
  } catch (err) {
    // Decrement concurrency counter
    releaseCompileSlot();
    console.error(`[${jobId}] Compilation error:`, err);

    // Cleanup
    try {
      await fs.rm(jobDir, { recursive: true, force: true });
    } catch (e) {}

    res.status(500).json({
      success: false,
      errors: [{ message: err.message, severity: 'error' }],
    });
  }
});

/**
 * SSE streaming compile endpoint.
 * POST /compile-stream
 * Uses Server-Sent Events to stream progress and logs in real-time.
 */
app.post('/compile-stream', concurrencyLimiter, async (req, res) => {
  const { mainFile, compiler = 'pdflatex', projectFiles, binaryFiles = {} } = req.body;
  const jobId = uuidv4();

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

  // Track whether client disconnected (endpoint-scoped and used throughout the request)
  let clientDisconnected = false;

  // Send an SSE event
  const sendEvent = (type, data) => {
    // Don't write if client has disconnected
    if (clientDisconnected) return;
    try {
      res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (e) {
      // Ignore write errors (client may have disconnected)
    }
  };

  // Validate required parameters
  if (!projectFiles || typeof projectFiles !== 'object') {
    // Counter was incremented in concurrencyLimiter; decrement it on early return
    releaseCompileSlot();
    sendEvent('error', { message: 'Missing required parameter: projectFiles' });
    res.end();
    return;
  }

  // Validate compiler option
  const validCompilers = ['pdflatex', 'xelatex', 'lualatex', 'latex'];
  const selectedCompiler = validCompilers.includes(compiler) ? compiler : 'pdflatex';

  const jobDir = path.join(COMPILE_DIR, jobId);

  // ========== Safety checks (keep consistent with /compile) ==========

  // 1) File count
  const totalFiles = Object.keys(projectFiles).length + Object.keys(binaryFiles).length;
  if (totalFiles > MAX_FILE_COUNT) {
    releaseCompileSlot();
    console.warn(`[${jobId}] [Security] File count limit exceeded: ${totalFiles} > ${MAX_FILE_COUNT}`);
    sendEvent('error', { message: `File count limit exceeded. Max allowed ${MAX_FILE_COUNT}, current ${totalFiles}.` });
    res.end();
    return;
  }

  // 2) Validate all file paths (prevent path traversal)
  const allFilenames = [...Object.keys(projectFiles), ...Object.keys(binaryFiles)];
  for (const filename of allFilenames) {
    if (!validateFilePath(filename, jobDir)) {
      releaseCompileSlot();
      sendEvent('error', { message: `Invalid file path: ${filename}` });
      res.end();
      return;
    }
  }

  // 2.5) Validate main file (prevent command injection)
  const mainFileValidation = validateMainFile(mainFile, jobDir, projectFiles);
  if (!mainFileValidation.valid) {
    releaseCompileSlot();
    console.warn(`[${jobId}] [Security] Main file validation failed: ${mainFileValidation.error}`);
    sendEvent('error', { message: mainFileValidation.error });
    res.end();
    return;
  }

  // 3) Validate per-file size
  let totalSize = 0;
  for (const [filename, content] of Object.entries(projectFiles)) {
    const sizeCheck = validateSingleFileSize(content, filename, false);
    if (!sizeCheck.valid) {
      releaseCompileSlot();
      sendEvent('error', { message: sizeCheck.error });
      res.end();
      return;
    }
    totalSize += sizeCheck.size;
  }

  for (const [filename, content] of Object.entries(binaryFiles)) {
    const sizeCheck = validateSingleFileSize(content, filename, true);
    if (!sizeCheck.valid) {
      releaseCompileSlot();
      sendEvent('error', { message: sizeCheck.error });
      res.end();
      return;
    }
    totalSize += sizeCheck.size;
  }

  console.log(`[${jobId}] Total file size: ${Math.round(totalSize / 1024 / 1024 * 100) / 100}MB`);

  // 4) Validate LaTeX content safety
  const securityViolations = [];
  for (const [filename, content] of Object.entries(projectFiles)) {
    if (filename.endsWith('.tex') || filename.endsWith('.sty') || filename.endsWith('.cls')) {
      const result = validateLatexSecurity(content, filename);
      if (!result.safe) {
        securityViolations.push({ filename, violations: result.violations });
      }
    }
  }

  if (securityViolations.length > 0) {
    releaseCompileSlot();
    console.warn(`[${jobId}] [Security] LaTeX security violations:`, JSON.stringify(securityViolations, null, 2));
    sendEvent('error', {
      message: 'SECURITY_RISK',
      errorCode: 'SECURITY_RISK',
      details: securityViolations.map(sv => ({
        file: sv.filename,
        issues: sv.violations.map(v => `${v.pattern}: ${v.description}`),
      })),
    });
    res.end();
    return;
  }

  console.log(`[${jobId}] Security checks passed`);

  // Counter was atomically incremented in concurrencyLimiter
  console.log(`[${jobId}] Starting streaming compile job. Main file: ${mainFile} (concurrent: ${currentCompileCount}/${MAX_CONCURRENT_COMPILES})`);

  sendEvent('progress', { stage: 'starting', percent: 5, message: 'Starting compilation...' });

  try {
    // Create temporary directory
    await fs.mkdir(jobDir, { recursive: true });
    sendEvent('progress', { stage: 'starting', percent: 10, message: 'Preparing files...' });

    // Write all text files
    for (const [filename, content] of Object.entries(projectFiles)) {
      const filePath = path.join(jobDir, filename);
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });

      // Preprocess .tex files
      let processedContent = content;
      if (filename.endsWith('.tex')) {
        // 1) LaTeX compatibility pre-processing (fix common compiler compatibility issues)
        processedContent = preprocessLatexCompatibility(content, selectedCompiler);
        // 2) Unicode character pre-processing
        processedContent = preprocessUnicodeCharacters(processedContent);
        // 3) For XeLaTeX/LuaLaTeX, replace Windows fonts with open-source alternatives
        if (selectedCompiler === 'xelatex' || selectedCompiler === 'lualatex') {
          processedContent = replaceWindowsFonts(processedContent);
        }
      }

      // Also apply font replacement for .cls/.sty (XeLaTeX/LuaLaTeX)
      if ((filename.endsWith('.cls') || filename.endsWith('.sty')) &&
          (selectedCompiler === 'xelatex' || selectedCompiler === 'lualatex')) {
        processedContent = replaceWindowsFonts(processedContent);
      }

      await fs.writeFile(filePath, processedContent, 'utf8');
    }

    // Write binary files
    for (const [filename, base64Content] of Object.entries(binaryFiles)) {
      const filePath = path.join(jobDir, filename);
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });
      const buffer = Buffer.from(base64Content, 'base64');
      await fs.writeFile(filePath, buffer);
    }

    sendEvent('progress', { stage: 'loadingPackages', percent: 20, message: 'Loading packages...' });

    // Prepare compile command
    const mainFileWithoutExt = mainFile.replace(/\.tex$/, '');
    const isWindows = process.platform === 'win32';
    const TEXLIVE_BIN = process.env.TEXLIVE_BIN || '';
    const compilerExe = (isWindows || !TEXLIVE_BIN) ? selectedCompiler : `${TEXLIVE_BIN}/${selectedCompiler}`;

    const args = [
      '-no-shell-escape',
      '-interaction=nonstopmode',
      '-synctex=1',
      '-output-directory=' + jobDir,
      mainFile
    ];

    // Use spawn for streaming output.
    // NOTE: spawn does not support a timeout option (only exec/execFile do), so we implement it manually.
    const compileProcess = spawn(compilerExe, args, {
      cwd: jobDir,
    });

    // Manual compile timeout protection
    let timeoutKilled = false;
    const timeoutTimer = setTimeout(() => {
      if (!compileProcess.killed) {
        timeoutKilled = true;
        console.log(`[${jobId}] Compilation timed out (${COMPILE_TIMEOUT / 1000}s); terminating process`);
        compileProcess.kill('SIGTERM');
        // If SIGTERM doesn't take effect, force-kill later
        setTimeout(() => {
          if (!compileProcess.killed) {
            compileProcess.kill('SIGKILL');
          }
        }, 1000);
      }
    }, COMPILE_TIMEOUT);

    // Handle client disconnect: terminate compile process to save server resources
    const onClientClose = () => {
      if (!clientDisconnected) {
        clientDisconnected = true;
        clearTimeout(timeoutTimer); // Clear timeout timer
        console.log(`[${jobId}] Client disconnected; terminating compile process`);
        // Terminate compile process (and its child processes)
        if (compileProcess && !compileProcess.killed) {
          compileProcess.kill('SIGTERM');
          // If SIGTERM doesn't take effect, force-kill later
          setTimeout(() => {
            if (!compileProcess.killed) {
              compileProcess.kill('SIGKILL');
            }
          }, 1000);
        }
      }
    };

    req.on('close', onClientClose);
    res.on('close', onClientClose);

    let stdout = '';
    let lastProgress = 20;

    // Process output in real-time
    compileProcess.stdout.on('data', (data) => {
      // Stop processing if client disconnected
      if (clientDisconnected) return;
      const chunk = data.toString();
      stdout += chunk;

      // Parse progress stage
      if (chunk.includes('This is') && (chunk.includes('pdfTeX') || chunk.includes('XeTeX') || chunk.includes('LuaTeX'))) {
        sendEvent('progress', { stage: 'starting', percent: 25, message: 'Compiler initialized' });
        lastProgress = 25;
      } else if (chunk.match(/\([^)]+\.(sty|cls)\)/)) {
        if (lastProgress < 40) {
          lastProgress = Math.min(lastProgress + 2, 40);
          sendEvent('progress', { stage: 'loadingPackages', percent: lastProgress, message: 'Loading packages...' });
        }
      } else if (chunk.match(/\([^)]+\.tex\)/)) {
        if (lastProgress < 60) {
          lastProgress = Math.min(lastProgress + 5, 60);
          sendEvent('progress', { stage: 'processing', percent: lastProgress, message: 'Processing document...' });
        }
      } else if (chunk.includes('bibliography') || chunk.includes('.bbl')) {
        lastProgress = 70;
        sendEvent('progress', { stage: 'bibliography', percent: 70, message: 'Processing bibliography...' });
      } else if (chunk.includes('Output written on')) {
        lastProgress = 90;
        sendEvent('progress', { stage: 'generating', percent: 90, message: 'Generating PDF...' });
      }

      // Send log chunk
      sendEvent('log', { content: chunk });
    });

    compileProcess.stderr.on('data', (data) => {
      // Stop processing if client disconnected
      if (clientDisconnected) return;
      stdout += data.toString();
      sendEvent('log', { content: data.toString() });
    });

    // Wait for compile to complete
    const exitCode = await new Promise((resolve, reject) => {
      compileProcess.on('close', (code) => {
        clearTimeout(timeoutTimer); // Clear timeout timer when process finishes
        resolve(code);
      });
      compileProcess.on('error', (err) => {
        clearTimeout(timeoutTimer); // Clear timeout timer on error as well
        reject(err);
      });
    });

    // If killed by timeout, return timeout error
    if (timeoutKilled) {
      sendEvent('progress', { stage: 'error', percent: 100, message: 'Compilation timed out' });
      sendEvent('done', {
        success: false,
        errors: [{ severity: 'error', message: `Compilation timed out: exceeded ${COMPILE_TIMEOUT / 1000}s limit` }],
        parsedLogs: [],
        logStats: { errors: 1, warnings: 0, info: 0 },
        logs: sanitizeRawLogs(stdout.slice(-10000)),
      });
      return;
    }

    // Read results
    const pdfPath = path.join(jobDir, `${mainFileWithoutExt}.pdf`);
    const logPath = path.join(jobDir, `${mainFileWithoutExt}.log`);
    const synctexPath = path.join(jobDir, `${mainFileWithoutExt}.synctex.gz`);

    // Read compile log
    let logs = '';
    try {
      logs = await fs.readFile(logPath, 'utf8');
    } catch (e) {
      logs = stdout;
    }

    // Parse logs
    const { logs: parsedLogs, stats } = parseLatexLogs(logs);

    // Check whether PDF was generated
    try {
      await fs.access(pdfPath);

      const pdfBuffer = await fs.readFile(pdfPath);
      const pdfBase64 = pdfBuffer.toString('base64');

      let synctexBase64 = null;
      try {
        await fs.access(synctexPath);
        const synctexBuffer = await fs.readFile(synctexPath);
        synctexBase64 = synctexBuffer.toString('base64');
      } catch (e) {}

      sendEvent('progress', { stage: 'done', percent: 100, message: 'Compilation complete' });
      sendEvent('done', {
        success: true,
        pdfBase64,
        synctexBase64,
        logs: sanitizeRawLogs(logs.slice(-10000)),
        parsedLogs,
        logStats: stats,
      });
    } catch (e) {
      sendEvent('progress', { stage: 'error', percent: 100, message: 'Compilation failed' });
      sendEvent('done', {
        success: false,
        errors: parsedLogs.filter(l => l.severity === 'error'),
        parsedLogs,
        logStats: stats,
        logs: sanitizeRawLogs(logs.slice(-10000)),
      });
    }
  } catch (err) {
    console.error(`[${jobId}] Streaming compilation error:`, err);
    sendEvent('error', { message: err.message });
  } finally {
    // Decrement concurrency counter
    releaseCompileSlot();
    console.log(`[${jobId}] Streaming compile job finished (concurrent: ${currentCompileCount}/${MAX_CONCURRENT_COMPILES})`);

    res.end();

    // Cleanup compile directory
    setTimeout(async () => {
      try {
        await fs.rm(jobDir, { recursive: true, force: true });
      } catch (e) {}
    }, 5000);
  }
});

/**
 * Parse LaTeX compile logs (enhanced).
 * Classifies entries into error/warning/info.
 * Returns: { logs: [...], stats: { errors: n, warnings: n, info: n } }
 */
function parseLatexLogs(log) {
  const logs = [];
  const lines = log.split('\n');
  const seen = new Set(); // De-dupe

  let currentError = null;
  let currentFile = null;

  // File stack: track the current file context
  const fileStack = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track current file: we must process parentheses in order.
    // Otherwise "(./a.tex) (./b.tex" could incorrectly leave both files on the stack.
    // Match file open: (./filename.tex or (/path/to/file.sty
    const fileOpenRegex = /\(([^()]+\.(tex|sty|cls|bbl|aux))/g;
    const events = [];
    let match;
    while ((match = fileOpenRegex.exec(line)) !== null) {
      events.push({ type: 'open', pos: match.index, file: match[1] });
    }

    // Match all closing parentheses
    const closeRegex = /\)/g;
    while ((match = closeRegex.exec(line)) !== null) {
      events.push({ type: 'close', pos: match.index });
    }

    // Sort by position to process in appearance order
    events.sort((a, b) => a.pos - b.pos);

    // Process bracket events in order
    for (const event of events) {
      if (event.type === 'open') {
        fileStack.push(event.file);
      } else if (event.type === 'close' && fileStack.length > 0) {
        fileStack.pop();
      }
    }

    // Update currentFile
    currentFile = fileStack.length > 0 ? fileStack[fileStack.length - 1] : null;

    // ===== Errors =====
    // Match: ! Error message
    if (line.startsWith('!')) {
      if (currentError) {
        const key = `${currentError.severity}:${currentError.message}:${currentError.line || ''}`;
        if (!seen.has(key)) {
          seen.add(key);
          logs.push(currentError);
        }
      }
      currentError = {
        message: line.substring(2).trim(),
        severity: 'error',
        file: currentFile,
      };
      continue;
    }

    // Match line number: l.123 (belongs to the current error)
    if (currentError && /^l\.(\d+)/.test(line)) {
      const match = line.match(/^l\.(\d+)/);
      if (match) {
        currentError.line = parseInt(match[1], 10);
      }
      continue;
    }

    // Fatal error
    if (line.includes('Fatal error')) {
      const key = `error:${line.trim()}`;
      if (!seen.has(key)) {
        seen.add(key);
        logs.push({
        message: line.trim(),
          severity: 'error',
          file: currentFile,
        });
      }
      continue;
    }

    // ===== Warnings =====
    // Package/Class Warning
    const warningMatch = line.match(/(Package|Class|LaTeX)\s+(\w+)?\s*Warning:\s*(.+)/i);
    if (warningMatch) {
      // May span multiple lines; attempt to collect full message
      let message = line.trim();
      let lineNum = null;

      // Check whether following lines continue this warning
      let j = i + 1;
      while (j < lines.length && !lines[j].match(/^(\s{10,}|$)/) && !lines[j].startsWith('!') && !lines[j].includes('Warning:')) {
        if (lines[j].trim()) {
          // Extract line number: on input line 123
          const lineMatch = lines[j].match(/on input line (\d+)/);
          if (lineMatch) {
            lineNum = parseInt(lineMatch[1], 10);
          }
          // Extract filename
          const fileMatch = lines[j].match(/in file [`']?([^'`\s]+)/);
          if (fileMatch && !currentFile) {
            currentFile = fileMatch[1];
          }
          break;
        }
        j++;
      }

      const key = `warning:${message}:${lineNum || ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        logs.push({
          message,
        severity: 'warning',
          file: currentFile,
          line: lineNum,
      });
      }
      continue;
    }

    // Underfull/Overfull box warnings
    if (line.includes('Underfull') || line.includes('Overfull')) {
      // Extract line number: at lines 123--456 or in paragraph at lines 260--260
      let lineNum = null;
      const linesMatch = line.match(/at lines? (\d+)/);
      if (linesMatch) {
        lineNum = parseInt(linesMatch[1], 10);
      }

      const key = `warning:${line.trim()}:${lineNum || ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        logs.push({
        message: line.trim(),
        severity: 'warning',
          file: currentFile,
          line: lineNum,
        });
      }
      continue;
    }

    // multiply defined labels
    if (line.includes('multiply defined') || line.includes('Multiply-defined')) {
      const key = `warning:${line.trim()}`;
      if (!seen.has(key)) {
        seen.add(key);
        logs.push({
          message: line.trim(),
          severity: 'warning',
          file: currentFile,
        });
      }
      continue;
    }

    // ===== Info =====
    // Output written: Output written on main.pdf (10 pages, 123456 bytes).
    if (line.includes('Output written on')) {
      const key = `info:${line.trim()}`;
      if (!seen.has(key)) {
        seen.add(key);
        logs.push({
          message: line.trim(),
          severity: 'info',
          file: currentFile,
        });
      }
      continue;
    }

    // Transcript written
    if (line.includes('Transcript written')) {
      const key = `info:${line.trim()}`;
      if (!seen.has(key)) {
        seen.add(key);
        logs.push({
          message: line.trim(),
          severity: 'info',
        });
      }
      continue;
    }

    // Package info (keep only important ones)
    if (line.includes('Package') && line.includes('Info:')) {
      // Skip noisy package info; keep only key messages
      if (line.includes('obsolete') || line.includes('version') || line.includes('compat')) {
        const key = `info:${line.trim()}`;
        if (!seen.has(key)) {
          seen.add(key);
          logs.push({
            message: line.trim(),
            severity: 'info',
            file: currentFile,
          });
        }
      }
      continue;
    }
  }

  // Push the last pending error
  if (currentError) {
    const key = `${currentError.severity}:${currentError.message}:${currentError.line || ''}`;
    if (!seen.has(key)) {
      logs.push(currentError);
    }
  }

  // Stats
  const stats = {
    errors: logs.filter(l => l.severity === 'error').length,
    warnings: logs.filter(l => l.severity === 'warning').length,
    info: logs.filter(l => l.severity === 'info').length,
  };

  // Sanitize: hide sensitive server path information
  const sanitizedLogs = logs.map(log => sanitizeLogEntry(log));

  return { logs: sanitizedLogs, stats };
}

/**
 * Sanitize a log entry by hiding sensitive server paths.
 * Prevent leaking server filesystem information in production.
 */
// Sensitive path patterns used for sanitization
const SENSITIVE_PATH_PATTERNS = [
  // TeXLive install paths
  { pattern: /\/usr\/local\/texlive\/\d{4}\/[^:\s\n]*/g, replacement: '<texlive>' },
  { pattern: /\/usr\/share\/texlive\/[^:\s\n]*/g, replacement: '<texlive>' },
  { pattern: /\/opt\/texlive\/[^:\s\n]*/g, replacement: '<texlive>' },
  // Temporary compile directories
  { pattern: /\/tmp\/latex-compile\/[a-f0-9-]+\//g, replacement: './' },
  { pattern: /\/var\/tmp\/[^:\s\n]*/g, replacement: '<temp>' },
  // User home directories
  { pattern: /\/home\/[^/]+\//g, replacement: '<user>/' },
  { pattern: /\/Users\/[^/]+\//g, replacement: '<user>/' },
  // Docker container paths
  { pattern: /\/app\/compile\/[^:\s\n]*/g, replacement: '<compile>' },
];

/**
 * Sanitize a log entry by hiding sensitive server paths.
 * Prevent leaking server filesystem information in production.
 */
function sanitizeLogEntry(log) {
  const sanitized = { ...log };

  // Sanitize message
  if (sanitized.message) {
    for (const { pattern, replacement } of SENSITIVE_PATH_PATTERNS) {
      sanitized.message = sanitized.message.replace(pattern, replacement);
    }
  }

  // Sanitize file path
  if (sanitized.file) {
    for (const { pattern, replacement } of SENSITIVE_PATH_PATTERNS) {
      sanitized.file = sanitized.file.replace(pattern, replacement);
    }
    // For non-user project files, simplify display
    if (sanitized.file.includes('<texlive>')) {
      // Keep only the basename
      const parts = sanitized.file.split('/');
      sanitized.file = parts[parts.length - 1] || sanitized.file;
    }
  }

  return sanitized;
}

/**
 * Sanitize raw log strings.
 */
function sanitizeRawLogs(logs) {
  if (!logs) return logs;
  let sanitized = logs;
  for (const { pattern, replacement } of SENSITIVE_PATH_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  return sanitized;
}

/**
 * Backward-compatible: parse LaTeX compile errors (returns errors array only).
 */
function parseLatexErrors(log) {
  const { logs } = parseLatexLogs(log);
  return logs.filter(l => l.severity === 'error' || l.severity === 'warning');
}

/**
 * Preprocess LaTeX content by removing packages/commands unsupported by LaTeXML.
 * Used for HTML export.
 */
function preprocessForLaTeXML(latexContent) {
  let content = latexContent;

  // Packages unsupported by LaTeXML (or known to cause issues)
  const problematicPackages = [
    'fontawesome',
    'fontawesome5',
    'fontspec',      // XeLaTeX-only
    'unicode-math',  // XeLaTeX-only
    'polyglossia',   // XeLaTeX-only
  ];

  // Comment out unsupported packages
  for (const pkg of problematicPackages) {
    // Match \usepackage{fontawesome} or \usepackage[options]{fontawesome}
    const pkgRegex = new RegExp(`(\\\\usepackage(?:\\[[^\\]]*\\])?\\{${pkg}\\})`, 'gi');
    content = content.replace(pkgRegex, '% [LaTeXML] $1');

    // Match \RequirePackage
    const reqRegex = new RegExp(`(\\\\RequirePackage(?:\\[[^\\]]*\\])?\\{${pkg}\\})`, 'gi');
    content = content.replace(reqRegex, '% [LaTeXML] $1');
  }

  // Remove fontawesome commands (e.g. \faGithub, \faEnvelope)
  content = content.replace(/\\fa[A-Z][a-zA-Z]*/g, '');

  // Remove \newfontfamily commands
  content = content.replace(/\\newfontfamily[^{]*\{[^}]*\}(\[[^\]]*\])?\{[^}]*\}/g, '');

  // Remove \setmainfont, \setsansfont, \setmonofont
  content = content.replace(/\\set(main|sans|mono)font(\[[^\]]*\])?\{[^}]*\}/g, '');

  console.log(`[preprocessForLaTeXML] Preprocessed LaTeX content; removed incompatible packages`);

  return content;
}

/**
 * Extract and simplify metadata from LaTeX content (title, author, abstract).
 * Handles complex \title{} definitions and extracts plain text.
 * Returns { content: processedContent, titleImages: image paths referenced in title region }.
 */
function extractAndSimplifyMetadata(latexContent) {
  let content = latexContent;
  const titleImages = [];  // Images referenced in the title area

  // Extract \title{} content (handle nested braces)
  const titleMatch = content.match(/\\title\s*\{/);
  if (titleMatch) {
    const startIdx = titleMatch.index + titleMatch[0].length;
    let depth = 1;
    let endIdx = startIdx;
    while (depth > 0 && endIdx < content.length) {
      if (content[endIdx] === '{') depth++;
      else if (content[endIdx] === '}') depth--;
      endIdx++;
    }
    let titleContent = content.slice(startIdx, endIdx - 1);

    // Extract image paths from complex title (saved for later processing)
    const imgRegex = /\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/g;
    let imgMatch;
    while ((imgMatch = imgRegex.exec(titleContent)) !== null) {
      const imgPath = imgMatch[1].trim();
      if (imgPath && !imgPath.startsWith('#')) {
        titleImages.push(imgPath);
        console.log(`[extractAndSimplifyMetadata] Found title image: ${imgPath}`);
      }
    }

    // Extract plain text from complex title
    // Remove \begin{tabular}...\end{tabular}
    titleContent = titleContent.replace(/\\begin\{tabular\}[\s\S]*?\\end\{tabular\}/g, '');
    // Remove \includegraphics[...]{...}
    titleContent = titleContent.replace(/\\includegraphics\[[^\]]*\]\{[^}]*\}/g, '');
    titleContent = titleContent.replace(/\\includegraphics\{[^}]*\}/g, '');
    // Remove \raisebox{...}{...}
    titleContent = titleContent.replace(/\\raisebox\{[^}]*\}\{[^}]*\}/g, '');
    // Remove \hspace{...}
    titleContent = titleContent.replace(/\\hspace\{[^}]*\}/g, '');
    // Remove other LaTeX commands
    titleContent = titleContent.replace(/\\[a-zA-Z]+\{[^}]*\}/g, '');
    titleContent = titleContent.replace(/\\[a-zA-Z]+/g, '');
    // Normalize whitespace
    titleContent = titleContent.replace(/\s+/g, ' ').trim();
    // Remove special characters
    titleContent = titleContent.replace(/[@~]/g, '').trim();

    if (titleContent) {
      // Replace original complex title
      const fullTitle = content.slice(titleMatch.index, endIdx);
      content = content.replace(fullTitle, `\\title{${titleContent}}`);
    }
  }

  // If multiple \title{} exist, keep only the last one
  const titleMatches = content.match(/\\title\s*\{[^}]*\}/g);
  if (titleMatches && titleMatches.length > 1) {
    // Remove all previous \title{}, keep only the last one
    for (let i = 0; i < titleMatches.length - 1; i++) {
      content = content.replace(titleMatches[i], '');
    }
  }

  // Simplify \author{} - extract author names
  const authorMatch = content.match(/\\author\s*\{/);
  if (authorMatch) {
    const startIdx = authorMatch.index + authorMatch[0].length;
    let depth = 1;
    let endIdx = startIdx;
    while (depth > 0 && endIdx < content.length) {
      if (content[endIdx] === '{') depth++;
      else if (content[endIdx] === '}') depth--;
      endIdx++;
    }
    let authorContent = content.slice(startIdx, endIdx - 1);

    // Remove footnotes and thanks
    authorContent = authorContent.replace(/\\thanks\{[^}]*\}/g, '');
    authorContent = authorContent.replace(/\\footnotemark\[[^\]]*\]/g, '');
    authorContent = authorContent.replace(/\\footnote\{[^}]*\}/g, '');
    // Remove email and URLs
    authorContent = authorContent.replace(/\\texttt\{[^}]*\}/g, '');
    authorContent = authorContent.replace(/\\url\{[^}]*\}/g, '');
    authorContent = authorContent.replace(/\\faGithub[^\\]*/g, '');
    // Remove affiliation info (often after '\\\\')
    authorContent = authorContent.split('\\\\')[0];
    // Normalize separators
    authorContent = authorContent.replace(/~~~/g, ', ');
    authorContent = authorContent.replace(/\\And/g, ', ');
    authorContent = authorContent.replace(/\\AND/g, ', ');
    // Remove other LaTeX commands
    authorContent = authorContent.replace(/\\[a-zA-Z]+\{[^}]*\}/g, '');
    authorContent = authorContent.replace(/\\[a-zA-Z]+/g, '');
    // Cleanup
    authorContent = authorContent.replace(/\s+/g, ' ').trim();
    authorContent = authorContent.replace(/,\s*,/g, ',').replace(/^,|,$/g, '').trim();

    if (authorContent) {
      const fullAuthor = content.slice(authorMatch.index, endIdx);
      content = content.replace(fullAuthor, `\\author{${authorContent}}`);
    }
  }

  return { content, titleImages };
}

/**
 * Convert an image file into a base64 data URL.
 */
async function imageToDataUrl(imagePath) {
  try {
    const ext = path.extname(imagePath).toLowerCase();
    const mimeTypes = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
    };
    const mimeType = mimeTypes[ext];

    // Only handle supported image types; ignore PDFs and other formats
    if (!mimeType) {
      return null;
    }

    const buffer = await fs.readFile(imagePath);
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  } catch (e) {
    // File missing/unreadable: return null silently
    return null;
  }
}

/**
 * Convert PDF to PNG (via pdftoppm).
 */
async function pdfToPng(pdfPath) {
  const pngPath = pdfPath.replace(/\.pdf$/i, '.png');

  return new Promise((resolve) => {
    // Use pdftoppm to convert the first page to PNG
    const cmd = `pdftoppm -png -f 1 -l 1 -r 150 "${pdfPath}" "${pdfPath.replace(/\.pdf$/i, '')}"`;
    exec(cmd, { timeout: 30000 }, async (error) => {
      if (error) {
        console.log(`[pdfToPng] Conversion failed: ${pdfPath}`, error.message);
        resolve(null);
        return;
      }

      // pdftoppm outputs xxx-1.png
      const generatedPng = pdfPath.replace(/\.pdf$/i, '-1.png');
      try {
        await fs.access(generatedPng);
        resolve(generatedPng);
      } catch (e) {
        // Try without the -1 suffix
        try {
          await fs.access(pngPath);
          resolve(pngPath);
        } catch (e2) {
          resolve(null);
        }
      }
    });
  });
}

/**
 * Extract all \includegraphics references from LaTeX.
 * Returns [{ original: originalPath, normalized: normalizedPath }].
 */
function extractIncludegraphics(latexContent) {
  const images = [];

  // Match \includegraphics[options]{path} and \includegraphics{path}
  const regex = /\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/g;
  let match;

  while ((match = regex.exec(latexContent)) !== null) {
    const imgPath = match[1].trim();
    // Skip empty paths and special placeholders
    if (imgPath && !imgPath.startsWith('#') && !imgPath.includes('example-image')) {
      images.push({
        original: imgPath,
        normalized: imgPath.replace(/\\/g, '/'),  // Normalize path separators
      });
    }
  }

  return images;
}

/**
 * Preprocess LaTeX images before Pandoc conversion.
 * - Convert PDF images to PNG
 * - Copy images into the media directory
 * Returns an image map: { originalPath: newPath }
 */
async function preprocessLatexImages(latexContent, jobDir, mediaDir) {
  const imageRefs = extractIncludegraphics(latexContent);
  const imageMap = {};

  console.log(`[preprocessLatexImages] Found ${imageRefs.length} \\\\includegraphics references`);

  for (const ref of imageRefs) {
    const imgPath = ref.normalized;

    // Try multiple possible paths and extensions
    const basePath = imgPath.replace(/\.(png|jpg|jpeg|pdf|eps|svg)$/i, '');
    const extensions = ['.png', '.jpg', '.jpeg', '.pdf', '.PNG', '.JPG', '.JPEG', '.PDF'];

    // Candidate base paths
    const basePaths = [
      imgPath,
      basePath,
      ...extensions.map(ext => basePath + ext),
    ];

    let foundPath = null;
    let isPdf = false;

    for (const tryBase of basePaths) {
      const fullPath = path.join(jobDir, tryBase);
      try {
        await fs.access(fullPath);
        foundPath = fullPath;
        isPdf = tryBase.toLowerCase().endsWith('.pdf');
        console.log(`[preprocessLatexImages] Found image: ${tryBase}`);
        break;
      } catch (e) {
        // Try next candidate
      }
    }

    if (!foundPath) {
      console.log(`[preprocessLatexImages] Image not found: ${imgPath}`);
      continue;
    }

    // Process image
    let targetName = path.basename(foundPath);
    let targetPath = path.join(mediaDir, targetName);

    if (isPdf) {
      // Convert PDF to PNG
      console.log(`[preprocessLatexImages] Converting PDF: ${foundPath}`);
      const pngPath = await pdfToPng(foundPath);
      if (pngPath) {
        targetName = path.basename(pngPath);
        targetPath = path.join(mediaDir, targetName);
        try {
          await fs.copyFile(pngPath, targetPath);
          imageMap[ref.original] = 'media/' + targetName;
          console.log(`[preprocessLatexImages] PDF converted and copied: ${targetName}`);
        } catch (e) {
          console.log(`[preprocessLatexImages] Copy failed: ${e.message}`);
        }
      }
    } else {
      // Copy image directly
      try {
        await fs.copyFile(foundPath, targetPath);
        imageMap[ref.original] = 'media/' + targetName;
        console.log(`[preprocessLatexImages] Copied image: ${targetName}`);
      } catch (e) {
        console.log(`[preprocessLatexImages] Copy failed: ${e.message}`);
      }
    }
  }

  return imageMap;
}

/**
 * Rewrite image paths in LaTeX content to point to the media directory.
 * This ensures Pandoc can find and extract images correctly.
 */
function updateLatexImagePaths(latexContent, imageMap) {
  let result = latexContent;

  for (const [originalPath, newPath] of Object.entries(imageMap)) {
    // Escape regex metacharacters
    const escapedPath = originalPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Match \includegraphics[options]{originalPath} or \includegraphics{originalPath}
    const regex = new RegExp(
      `(\\\\includegraphics(?:\\[[^\\]]*\\])?)\\{${escapedPath}\\}`,
      'g'
    );

    // Replace with new path (without media/ prefix; Pandoc handles it)
    const newImgPath = path.basename(newPath);
    result = result.replace(regex, `$1{media/${newImgPath}}`);

    // Also handle paths without extension (LaTeX auto-resolves extensions)
    const baseOriginal = originalPath.replace(/\.(png|jpg|jpeg|pdf|eps|svg)$/i, '');
    const escapedBase = baseOriginal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const baseRegex = new RegExp(
      `(\\\\includegraphics(?:\\[[^\\]]*\\])?)\\{${escapedBase}\\}`,
      'g'
    );
    result = result.replace(baseRegex, `$1{media/${newImgPath.replace(/\.(png|jpg|jpeg|pdf|eps|svg)$/i, '')}}`);
  }

  return result;
}

/**
 * Convert LaTeX to HTML using LaTeXML.
 * LaTeXML is an open-source tool developed by NIST for converting LaTeX to HTML/MathML.
 * License: Public Domain (commercial use allowed).
 */
async function convertWithLaTeXML(inputPath, outputPath, jobDir) {
  return new Promise((resolve, reject) => {
    // LaTeXML conversion command
    // Compatibility options:
    // --includestyles: allow loading original .sty files
    // --timeout=600: increase timeout
    // --pmml: use Presentation MathML
    // --quiet: reduce output noise
    const latexmlCmd = `cd "${jobDir}" && latexmlc --dest="${outputPath}" --format=html5 --pmml --includestyles --timeout=600 "${inputPath}" 2>&1`;

    console.log(`[LaTeXML] Running conversion command: latexmlc --dest="${outputPath}" --format=html5 --pmml --includestyles --timeout=600 "${inputPath}"`);

    // Use a longer timeout (10 minutes)
    exec(latexmlCmd, { timeout: 600000, maxBuffer: 100 * 1024 * 1024 }, async (error, stdout, stderr) => {
      // Print output for debugging
      console.log(`[LaTeXML] Output (first 2000 chars):\n${stdout?.slice(0, 2000)}`);

      if (error) {
        console.log(`[LaTeXML] Conversion failed:`, error.message);
        // Detect timeout
        if (error.killed) {
          reject(new Error('LaTeXML conversion timed out (exceeded 10 minutes)'));
          return;
        }
        reject(error);
        return;
      }

      // Verify output file exists
      try {
        await fs.access(outputPath);
        console.log(`[LaTeXML] Conversion succeeded`);
        resolve(true);
      } catch (e) {
        // Even if the command didn't error, the output file might not be generated.
        console.log(`[LaTeXML] Output file not found; checking for error output...`);
        // Search errors in stdout
        if (stdout && (stdout.includes('Fatal:') || stdout.includes('Error:'))) {
          reject(new Error(`LaTeXML conversion error: ${stdout.slice(stdout.indexOf('Fatal:') || stdout.indexOf('Error:'), stdout.indexOf('Fatal:') + 500 || stdout.indexOf('Error:') + 500)}`));
        } else {
          reject(new Error('LaTeXML output file was not generated'));
        }
      }
    });
  });
}

/**
 * Extract all labels from LaTeX and build a numbering map.
 * Returns { labelName: { type: 'figure'|'table'|'equation'|'section', number: '1' } }
 */
function extractLabelsAndNumbers(latexContent) {
  const labels = {};
  let figureCount = 0;
  let tableCount = 0;
  let equationCount = 0;
  let sectionCount = 0;
  let subsectionCount = 0;

  // Extract labels from figure environments
  const figureRegex = /\\begin\{figure\*?\}[\s\S]*?\\end\{figure\*?\}/gi;
  let match;
  while ((match = figureRegex.exec(latexContent)) !== null) {
    figureCount++;
    const labelMatch = match[0].match(/\\label\{([^}]+)\}/);
    if (labelMatch) {
      labels[labelMatch[1]] = { type: 'figure', number: String(figureCount) };
    }
  }

  // Extract labels from table environments
  const tableRegex = /\\begin\{table\*?\}[\s\S]*?\\end\{table\*?\}/gi;
  while ((match = tableRegex.exec(latexContent)) !== null) {
    tableCount++;
    const labelMatch = match[0].match(/\\label\{([^}]+)\}/);
    if (labelMatch) {
      labels[labelMatch[1]] = { type: 'table', number: String(tableCount) };
    }
  }

  // Extract labels from equation environments (including align, gather, etc.)
  const eqEnvRegex = /\\begin\{(equation|align|gather|multline)\*?\}[\s\S]*?\\end\{\1\*?\}/gi;
  while ((match = eqEnvRegex.exec(latexContent)) !== null) {
    // Each non-starred environment produces a number
    if (!match[0].includes('*}')) {
      equationCount++;
      const labelMatch = match[0].match(/\\label\{([^}]+)\}/);
      if (labelMatch) {
        labels[labelMatch[1]] = { type: 'equation', number: String(equationCount) };
      }
    }
  }

  // Extract section labels
  const sectionRegex = /\\section\{[^}]*\}(?:\s*\\label\{([^}]+)\})?/gi;
  while ((match = sectionRegex.exec(latexContent)) !== null) {
    sectionCount++;
    subsectionCount = 0;  // Reset subsection counter
    if (match[1]) {
      labels[match[1]] = { type: 'section', number: String(sectionCount) };
    }
  }

  // Extract subsection labels
  const subsectionRegex = /\\subsection\{[^}]*\}(?:\s*\\label\{([^}]+)\})?/gi;
  while ((match = subsectionRegex.exec(latexContent)) !== null) {
    subsectionCount++;
    if (match[1]) {
      labels[match[1]] = { type: 'subsection', number: `${sectionCount}.${subsectionCount}` };
    }
  }

  console.log(`[extractLabelsAndNumbers] Extracted ${Object.keys(labels).length} labels`);
  return labels;
}

/**
 * Replace references in Markdown and add numbering.
 */
function processReferencesAndNumbers(markdownContent, labels, figures) {
  let result = markdownContent;

  // 1) Replace \ref{} references (Pandoc may preserve some)
  result = result.replace(/\\ref\{([^}]+)\}/g, (match, label) => {
    const info = labels[label];
    if (info) {
      return info.number;
    }
    return match;
  });

  // 2) Replace [text]{#label} or [text](#label) references (Pandoc output)
  result = result.replace(/\[([^\]]*)\]\{#([^}]+)\}/g, (match, text, label) => {
    const info = labels[label];
    if (info) {
      return info.number;
    }
    return text || match;
  });

  // 3) Replace [text][label] style references
  result = result.replace(/\[([^\]]*)\]\[([^\]]+)\]/g, (match, text, label) => {
    const info = labels[label];
    if (info) {
      return `${text} ${info.number}`;
    }
    return match;
  });

  // 4) Add numbering to image captions (Figure X:)
  let figNum = 0;
  // Look for italic caption immediately following an image (*caption*)
  result = result.replace(/(!\[[^\]]*\]\([^)]+\)\s*\n+)(\*[^*]+\*)/g, (match, img, caption) => {
    figNum++;
    // Skip if caption already contains a Figure number
    if (!/^Figure\s+\d+/i.test(caption.replace(/^\*|\*$/g, ''))) {
      return `${img}*Figure ${figNum}: ${caption.replace(/^\*|\*$/g, '')}*`;
    }
    return match;
  });

  // 5) Add numbering to table captions (Table X:)
  let tableNum = 0;
  // Find captions around the table
  result = result.replace(/(\|[^\n]+\|\n(?:\|[-:]+\|)+\n(?:\|[^\n]+\|\n)*)\s*(\*[^*]+\*)?/g, (match, table, caption) => {
    tableNum++;
    if (caption) {
      if (!/^Table\s+\d+/i.test(caption.replace(/^\*|\*$/g, ''))) {
        return `${table}\n*Table ${tableNum}: ${caption.replace(/^\*|\*$/g, '')}*`;
      }
    }
    return match;
  });

  // 6) Clean up empty reference markers left by Pandoc
  result = result.replace(/\[\]\{[^}]*\}/g, '');
  result = result.replace(/\{\#[^}]+\}/g, '');

  return result;
}

/**
 * Extract full details for all figure environments from LaTeX.
 * Returns [{ imgPath, caption, label, position }]
 */
function extractFigureEnvironments(latexContent) {
  const figures = [];

  // Match \begin{figure}...\end{figure} environments
  const figureRegex = /\\begin\{figure\*?\}[\s\S]*?\\end\{figure\*?\}/gi;
  let figMatch;

  while ((figMatch = figureRegex.exec(latexContent)) !== null) {
    const figContent = figMatch[0];
    const position = figMatch.index;

    // Extract image paths (may be multiple)
    const imgPaths = [];
    const imgRegex = /\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/g;
    let imgMatch;
    while ((imgMatch = imgRegex.exec(figContent)) !== null) {
      const imgPath = imgMatch[1].trim();
      if (imgPath && !imgPath.startsWith('#') && !imgPath.includes('example-image')) {
        imgPaths.push(imgPath);
      }
    }

    // Extract caption (handle nested braces)
    let caption = '';
    const captionStart = figContent.match(/\\caption\s*\{/);
    if (captionStart) {
      const startIdx = captionStart.index + captionStart[0].length;
      let depth = 1;
      let endIdx = startIdx;
      while (depth > 0 && endIdx < figContent.length) {
        if (figContent[endIdx] === '{') depth++;
        else if (figContent[endIdx] === '}') depth--;
        endIdx++;
      }
      caption = figContent.slice(startIdx, endIdx - 1).trim();
      // Simplify LaTeX commands in caption
      caption = caption.replace(/\\textbf\{([^}]*)\}/g, '**$1**');
      caption = caption.replace(/\\textit\{([^}]*)\}/g, '*$1*');
      caption = caption.replace(/\\emph\{([^}]*)\}/g, '*$1*');
      caption = caption.replace(/\\[a-zA-Z]+\{([^}]*)\}/g, '$1');
      caption = caption.replace(/\\[a-zA-Z]+/g, '');
      caption = caption.replace(/\s+/g, ' ').trim();
    }

    // Extract label
    const labelMatch = figContent.match(/\\label\{([^}]+)\}/);
    const label = labelMatch ? labelMatch[1].trim() : '';

    if (imgPaths.length > 0) {
      figures.push({
        imgPaths,
        caption,
        label,
        position,
        rawContent: figContent,
      });
      console.log(`[extractFigureEnvironments] Found figure: ${imgPaths.join(', ')}, caption: ${caption.substring(0, 50)}...`);
    }
  }

  return figures;
}

/**
 * Check and supplement missing image references in Markdown.
 * If images prepared during preprocessing did not appear in Pandoc output, insert them at appropriate positions.
 */
function supplementMissingImages(markdownContent, imageMap, latexContent, figures) {
  let result = markdownContent;

  // Extract existing image references from Markdown
  const existingImages = new Set();
  const imgRegex = /!\[[^\]]*\]\((?:images\/)?([^)]+)\)/g;
  let match;
  while ((match = imgRegex.exec(markdownContent)) !== null) {
    existingImages.add(path.basename(match[1]));
  }

  console.log(`[supplementMissingImages] Markdown already contains ${existingImages.size} images`);

  // Check which figure environments have missing images
  const missingFigures = [];
  for (const fig of figures) {
    const missingPaths = [];
    for (const imgPath of fig.imgPaths) {
      // Look up the corresponding media path in imageMap
      const normalizedPath = imgPath.replace(/\\/g, '/');
      const basePath = normalizedPath.replace(/\.(png|jpg|jpeg|pdf|eps|svg)$/i, '');

      let mediaPath = imageMap[normalizedPath] || imageMap[basePath];
      // Try basename without directories
      if (!mediaPath) {
        const filename = path.basename(normalizedPath);
        const baseFilename = path.basename(basePath);
        for (const [key, value] of Object.entries(imageMap)) {
          if (path.basename(key) === filename || path.basename(key) === baseFilename) {
            mediaPath = value;
            break;
          }
        }
      }

      if (mediaPath) {
    const imgName = path.basename(mediaPath);
    if (!existingImages.has(imgName)) {
          missingPaths.push({ original: imgPath, media: mediaPath, name: imgName });
        }
      }
    }

    if (missingPaths.length > 0) {
      missingFigures.push({ ...fig, missingPaths });
    }
  }

  if (missingFigures.length === 0) {
    console.log(`[supplementMissingImages] No missing images to supplement`);
    return result;
  }

  console.log(`[supplementMissingImages] Found ${missingFigures.length} missing figure environments`);

  // Generate Markdown for missing figures and try to insert at the right location
  for (const fig of missingFigures) {
    // Generate image references (syntax varies by output format)
    let figureMarkdown = '\n\n';
    for (const img of fig.missingPaths) {
      const altText = fig.caption ? fig.caption.substring(0, 100) : path.basename(img.name, path.extname(img.name));
      figureMarkdown += `![${altText}](images/${img.name})\n\n`;
    }
    if (fig.caption) {
      figureMarkdown += `*${fig.caption}*\n`;
    }
    figureMarkdown += '\n';

    // Also generate an HTML version (for HTML outputs)
    let figureHtml = '\n\n';
    for (const img of fig.missingPaths) {
      const altText = fig.caption ? fig.caption.substring(0, 100).replace(/"/g, '&quot;') : path.basename(img.name, path.extname(img.name));
      figureHtml += `<img src="images/${img.name}" alt="${altText}" style="max-width: 100%;" />\n`;
    }
    if (fig.caption) {
      figureHtml += `<p><em>${fig.caption}</em></p>\n`;
    }
    figureHtml += '\n';

    // Choose format based on content type (detect HTML)
    const isHtmlContent = result.includes('<!DOCTYPE html>') || result.includes('<html');
    const figureContent = isHtmlContent ? figureHtml : figureMarkdown;

    console.log(`[supplementMissingImages] Preparing to insert images: ${fig.missingPaths.map(p => p.name).join(', ')}`);

    // Try to find the right insertion point.
    // Strategy: look for label references or locate based on section headings.
    let inserted = false;

    // 1) If there is a label, try inserting before the reference
    if (fig.label) {
      const refRegex = new RegExp(`\\[([^\\]]*?)\\]\\([^)]*${fig.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^)]*\\)`, 'i');
      const refMatch = result.match(refRegex);
      if (refMatch) {
        result = result.replace(refMatch[0], figureContent + refMatch[0]);
        inserted = true;
        console.log(`[supplementMissingImages] Inserting images before reference ${fig.label}`);
      }
    }

    // 2) Based on the figure's position in LaTeX, insert after the corresponding section
    if (!inserted) {
      // Check whether this is one of the first few figures (often framework diagrams)
      const figIndex = figures.findIndex(f =>
        f.missingPaths && f.missingPaths.some(p =>
          fig.missingPaths.some(mp => mp.name === p.name)
        )
      );

      // For the first two figures, try inserting after the first/second H1 heading
      if (figIndex >= 0 && figIndex < 2) {
        // Match all H1 headings
        const h1Regex = /^#\s+[^\n]+\n/gm;
        const h1Matches = [...result.matchAll(h1Regex)];

        // For the first figure, insert after the first H1; for the second, after the second H1 (if present)
        const targetH1Index = Math.min(figIndex, h1Matches.length - 1);
        const targetH1 = h1Matches[targetH1Index];

        if (targetH1) {
          const insertPos = targetH1.index + targetH1[0].length;
          // Find the end of the first paragraph after the heading
          const afterH1 = result.slice(insertPos);
          // Find the first paragraph separator (two newlines)
          const paragraphEnd = afterH1.search(/\n\n/);

          if (paragraphEnd > 0) {
            const actualInsertPos = insertPos + paragraphEnd + 2;
            result = result.slice(0, actualInsertPos) + figureContent + result.slice(actualInsertPos);
            inserted = true;
            console.log(`[supplementMissingImages] Inserting images after H1 heading #${targetH1Index + 1}`);
          }
        }
      }
    }

    // 3) Try to find a relevant section based on caption content
    if (!inserted && fig.caption) {
      // Extract keywords from caption to locate a relevant section
      const captionLower = fig.caption.toLowerCase();

      // Keyword-to-section mapping
      const keywordToSection = [
        { keywords: ['framework', 'overview', 'architecture', 'challenge', 'solution'], sections: ['Introduction', 'Preliminary', 'Method'] },
        { keywords: ['result', 'comparison', 'performance', 'evaluation'], sections: ['Experiment', 'Result', 'Evaluation'] },
        { keywords: ['ablation', 'analysis'], sections: ['Ablation', 'Analysis', 'Experiment'] },
        { keywords: ['case', 'example', 'demo', 'ui', 'interface'], sections: ['Case', 'Example', 'Appendix', 'Use Case'] },
      ];

      for (const mapping of keywordToSection) {
        if (mapping.keywords.some(kw => captionLower.includes(kw))) {
          // Find the matching section heading
          for (const sectionName of mapping.sections) {
            const sectionRegex = new RegExp(`^#+\\s+[^\\n]*${sectionName}[^\\n]*\\n`, 'im');
            const sectionMatch = result.match(sectionRegex);
            if (sectionMatch) {
              const insertPos = sectionMatch.index + sectionMatch[0].length;
              const afterSection = result.slice(insertPos);
              const paragraphEnd = afterSection.search(/\n\n/);

              if (paragraphEnd > 0) {
                const actualInsertPos = insertPos + paragraphEnd + 2;
                result = result.slice(0, actualInsertPos) + figureContent + result.slice(actualInsertPos);
                inserted = true;
                console.log(`[supplementMissingImages] Inserting images after section "${sectionName}" based on caption keywords`);
                break;
              }
            }
          }
          if (inserted) break;
        }
      }
    }

    // 4) Default: append to end (for HTML, insert before </body>)
    if (!inserted) {
      if (isHtmlContent && result.includes('</body>')) {
        result = result.replace('</body>', figureContent + '</body>');
      } else {
        result = result + figureContent;
      }
      console.log(`[supplementMissingImages] Appending images to end of document`);
    }
  }

  return result;
}

/**
 * Process images in Markdown/HTML, convert PDFs to PNGs, and collect image files.
 * @param {string} content - Markdown/HTML output from Pandoc
 * @param {string} jobDir - Working directory
 * @param {Object} imageMap - Image map from preprocessing: { latexPath: mediaPath }
 * Returns { content: processed Markdown, images: [{ name, sourcePath }] }
 */
async function processMarkdownImages(content, jobDir, imageMap = {}) {
  let result = content;
  const images = []; // Images to include in the bundle
  const processedImages = new Set(); // Track processed images to avoid duplicates

  // 1) Clean up UTF-8 encoding artifacts (e.g. non-breaking space shown as "Â")
  result = result.replace(/Â\s*/g, ' ');
  result = result.replace(/\u00A0/g, ' ');

  // Helper: process a single image path
  async function processImage(imgPath) {
    if (imgPath.startsWith('data:') || imgPath.startsWith('http://') || imgPath.startsWith('https://')) {
      return null;
    }

    // Try to locate the image file
    const possiblePaths = [
      path.join(jobDir, imgPath),
      path.join(jobDir, 'media', imgPath),
      path.join(jobDir, imgPath.replace(/^media\//, '')),
    ];

    const isPdf = imgPath.toLowerCase().endsWith('.pdf');

    // For non-PDF images, just locate and collect
    if (!isPdf) {
      for (const tryPath of possiblePaths) {
        try {
          await fs.access(tryPath);
          const ext = path.extname(tryPath).toLowerCase();
          if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'].includes(ext)) {
            const imgName = 'images/' + path.basename(tryPath);
            images.push({ name: imgName, sourcePath: tryPath });
            return imgName;
          }
        } catch (e) {}
      }
    }

    // For PDFs, convert to PNG
    if (isPdf) {
      for (const tryPath of possiblePaths) {
        try {
          await fs.access(tryPath);
          console.log(`[processImage] Converting PDF: ${tryPath}`);
          const pngPath = await pdfToPng(tryPath);
          if (pngPath) {
            const pngName = 'images/' + path.basename(pngPath);
            images.push({ name: pngName, sourcePath: pngPath });
            console.log(`[processImage] PDF conversion succeeded: ${pngPath}`);
            return pngName;
          }
        } catch (e) {}
      }
    }

    return null;
  }

  // 2) Process Markdown image syntax: ![alt](path)
  const mdImgRegex = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let match;
  const mdReplacements = [];

  while ((match = mdImgRegex.exec(content)) !== null) {
    const [fullMatch, alt, imgPath] = match;
    const newPath = await processImage(imgPath);
    if (newPath) {
      mdReplacements.push({ from: fullMatch, to: `![${alt}](${newPath})` });
    }
  }

  // 3) Process HTML <embed> tags (generated when Pandoc converts PDF images)
  const embedRegex = /<embed\s+src="([^"]+)"[^>]*\/?>/gi;
  const embedReplacements = [];

  while ((match = embedRegex.exec(content)) !== null) {
    const [fullMatch, imgPath] = match;
    const newPath = await processImage(imgPath);
    if (newPath) {
      const altText = path.basename(imgPath, path.extname(imgPath));
      embedReplacements.push({ from: fullMatch, to: `![${altText}](${newPath})` });
    } else {
      const altText = path.basename(imgPath);
      embedReplacements.push({ from: fullMatch, to: `[Image: ${altText}]` });
    }
  }

  // 4) Process HTML <img> tags
  const imgTagRegex = /<img\s+[^>]*src="([^"]+)"[^>]*\/?>/gi;
  const imgTagReplacements = [];

  while ((match = imgTagRegex.exec(content)) !== null) {
    const [fullMatch, imgPath] = match;
    const newPath = await processImage(imgPath);
    if (newPath) {
      const altText = path.basename(imgPath, path.extname(imgPath));
      imgTagReplacements.push({ from: fullMatch, to: `![${altText}](${newPath})` });
    }
  }

  // Apply all replacements
  const allReplacements = [...mdReplacements, ...embedReplacements, ...imgTagReplacements];
  for (const { from, to } of allReplacements) {
    result = result.replace(from, to);
  }

  // 5) Remove all <figure> tags and convert to plain Markdown
  // Loop until no <figure> tags remain (handles nesting)
  let figureCount = 0;
  const maxIterations = 10;  // Prevent infinite loops
  while (/<figure[^>]*>/i.test(result) && figureCount < maxIterations) {
    figureCount++;
    // Handle <figure> blocks: extract image and caption, convert to Markdown
    result = result.replace(/<figure[^>]*>\s*([\s\S]*?)\s*<\/figure>/gi, (match, content) => {
      // Remove <p> tags
      let cleaned = content.replace(/<\/?p>/gi, '');
      // Convert <figcaption> to italic text
      cleaned = cleaned.replace(/<figcaption>([^<]*)<\/figcaption>/gi, '\n*$1*\n');
      return '\n' + cleaned.trim() + '\n';
    });
  }

  // Clean up any remaining empty <figure> tags and <figcaption>
  result = result.replace(/<figure[^>]*>\s*<\/figure>/gi, '');
  result = result.replace(/<\/?figure[^>]*>/gi, '');  // Remove any remaining opening/closing <figure> tags
  result = result.replace(/<figcaption>([^<]*)<\/figcaption>/gi, '*$1*\n');

  // 6) Handle images prepared during preprocessing but not emitted by Pandoc
  // Ensure images in imageMap are included in the output bundle
  for (const [originalPath, mediaPath] of Object.entries(imageMap)) {
    const imgBaseName = path.basename(mediaPath);
    const imgName = 'images/' + imgBaseName;

    // Skip if already processed
    if (processedImages.has(imgBaseName)) {
      continue;
    }

    // Ensure the image exists under media directory
    const sourcePath = path.join(jobDir, mediaPath);
    try {
      await fs.access(sourcePath);
      // Check whether output content contains a reference to this image
      if (!result.includes(imgBaseName)) {
        console.log(`[processMarkdownImages] Found unreferenced preprocessed image: ${imgBaseName}`);
      }
      // Always add to the output image list to ensure it gets bundled
      if (!images.some(img => img.name === imgName)) {
        images.push({ name: imgName, sourcePath });
        processedImages.add(imgBaseName);
      }
    } catch (e) {
      // Image file missing; skip
    }
  }

  // 7) Scan media directory and add all images extracted by Pandoc
  const mediaDir = path.join(jobDir, 'media');
  try {
    const mediaFiles = await fs.readdir(mediaDir, { recursive: true });
    for (const file of mediaFiles) {
      const filePath = path.join(mediaDir, file);
      const stats = await fs.stat(filePath);
      if (stats.isFile()) {
        const ext = path.extname(file).toLowerCase();
        if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'].includes(ext)) {
          const imgName = 'images/' + path.basename(file);
          if (!processedImages.has(path.basename(file))) {
            images.push({ name: imgName, sourcePath: filePath });
            processedImages.add(path.basename(file));
            console.log(`[processMarkdownImages] Added media directory image: ${file}`);
          }
        }
      }
    }
  } catch (e) {
    // media directory missing or empty; ignore
  }

  return { content: result, images };
}

/**
 * Create a ZIP file containing the main content and images.
 * @param {string} content - Main file content
 * @param {Array} images - Image list [{name, sourcePath}]
 * @param {string} outputPath - ZIP output path
 * @param {string} mainFilename - Main filename (e.g. xxx.md or xxx.html)
 */
async function createContentZip(content, images, outputPath, mainFilename) {
  return new Promise((resolve, reject) => {
    const output = fsSync.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    let closed = false;

    output.on('close', () => {
      if (!closed) {
        closed = true;
        console.log(`[createContentZip] ZIP created: ${archive.pointer()} bytes`);
        resolve();
      }
    });

    output.on('finish', () => {
      if (!closed) {
        closed = true;
        console.log(`[createContentZip] ZIP write completed`);
        resolve();
      }
    });

    archive.on('error', (err) => {
      console.error(`[createContentZip] ZIP creation error:`, err);
      reject(err);
    });

    archive.on('warning', (err) => {
      console.warn(`[createContentZip] ZIP warning:`, err);
    });

    archive.pipe(output);

    // Add main file (UTF-8)
    archive.append(Buffer.from(content, 'utf8'), { name: mainFilename });

    // Add image files
    for (const img of images) {
      try {
        if (fsSync.existsSync(img.sourcePath)) {
          archive.file(img.sourcePath, { name: img.name });
        } else {
          console.warn(`[createContentZip] Image not found: ${img.sourcePath}`);
        }
      } catch (e) {
        console.warn(`[createContentZip] Failed to add image: ${img.sourcePath}`, e.message);
      }
    }

    // Finalize archive
    archive.finalize();
  });
}

/**
 * Find an image and convert it to base64.
 */
async function findAndConvertImage(imgPath, jobDir) {
  // Candidate paths
  const possiblePaths = [
    path.join(jobDir, imgPath),
    path.join(jobDir, 'media', imgPath),
    path.join(jobDir, imgPath.replace(/^media\//, '')),
  ];

  // If this is a PDF, also try the corresponding PNG
  const isPdf = imgPath.toLowerCase().endsWith('.pdf');
  if (isPdf) {
    const pngPath = imgPath.replace(/\.pdf$/i, '.png');
    possiblePaths.push(
      path.join(jobDir, pngPath),
      path.join(jobDir, 'media', pngPath),
      path.join(jobDir, pngPath.replace(/^media\//, '')),
    );
  }

  // Try to locate an image file
  for (const tryPath of possiblePaths) {
    const dataUrl = await imageToDataUrl(tryPath);
    if (dataUrl) {
      console.log(`[findAndConvertImage] Found image: ${tryPath}`);
      return dataUrl;
    }
  }

  // If it's a PDF and we didn't find a PNG, try converting
  if (isPdf) {
    for (const tryPath of possiblePaths.slice(0, 3)) {
      try {
        await fs.access(tryPath);
        console.log(`[findAndConvertImage] Attempting to convert PDF: ${tryPath}`);
        const pngPath = await pdfToPng(tryPath);
        if (pngPath) {
          const dataUrl = await imageToDataUrl(pngPath);
          if (dataUrl) {
            console.log(`[findAndConvertImage] PDF conversion succeeded: ${pngPath}`);
            return dataUrl;
          }
        }
      } catch (e) {
        // File missing; try next path
      }
    }
  }

  console.log(`[findAndConvertImage] Image not found: ${imgPath}`);
  return null;
}

/**
 * Convert LaTeX to other formats.
 * POST /convert
 * Body: {
 *   format: 'markdown' | 'docx' | 'html',
 *   mainFile: string,
 *   projectName: string,  // Project name, used to generate output filename
 *   projectFiles: { [filename]: content },
 *   binaryFiles?: { [filename]: base64Content }
 * }
 */
app.post('/convert', concurrencyLimiter, async (req, res) => {
  const { format, mainFile, projectName = 'export', projectFiles, binaryFiles = {} } = req.body;

  // Validate required parameters first
  if (!projectFiles || typeof projectFiles !== 'object') {
    // Counter was incremented in concurrencyLimiter and must be decremented
    releaseCompileSlot();
    return res.status(400).json({
      success: false,
      error: 'Missing required parameter: projectFiles',
    });
  }

  // Sanitize project name: replace spaces with underscores and remove special characters
  const safeProjectName = projectName
    .replace(/\s+/g, '_')
    .replace(/[^\w\-_.]/g, '')
    .slice(0, 100) || 'export';
  const jobId = uuidv4();
  const jobDir = path.join(COMPILE_DIR, jobId);
  const mediaDir = path.join(jobDir, 'media');

  // Counter was atomically incremented in concurrencyLimiter
  console.log(`[${jobId}] Starting conversion job. Format: ${format}, main file: ${mainFile} (concurrent: ${currentCompileCount}/${MAX_CONCURRENT_COMPILES})`);
  console.log(`[${jobId}] Text files: ${Object.keys(projectFiles).length}, binary files: ${Object.keys(binaryFiles).length}`);

  // ========== Security checks ==========

  // Validate format
  const supportedFormats = ['markdown', 'docx', 'html'];
  if (!supportedFormats.includes(format)) {
    releaseCompileSlot();
    return res.status(400).json({
      success: false,
      error: `Unsupported format: ${format}. Supported formats: ${supportedFormats.join(', ')}`,
    });
  }

  // 1) Check file count
  const totalFiles = Object.keys(projectFiles).length + Object.keys(binaryFiles).length;
  if (totalFiles > MAX_FILE_COUNT) {
    releaseCompileSlot();
    console.warn(`[${jobId}] [Security] File count limit exceeded: ${totalFiles} > ${MAX_FILE_COUNT}`);
    return res.status(400).json({
      success: false,
      error: `File count limit exceeded. Max allowed ${MAX_FILE_COUNT}, current ${totalFiles}.`,
    });
  }

  // 2) Validate all file paths (prevent path traversal)
  const allFilenames = [...Object.keys(projectFiles), ...Object.keys(binaryFiles)];
  for (const filename of allFilenames) {
    if (!validateFilePath(filename, jobDir)) {
      releaseCompileSlot();
      console.warn(`[${jobId}] [Security] Path traversal attempt: ${filename}`);
      return res.status(400).json({
        success: false,
        error: `Invalid file path: ${filename}`,
      });
    }
  }

  // 2.5) Validate main file (prevent command injection)
  const mainFileValidation = validateMainFile(mainFile, jobDir, projectFiles);
  if (!mainFileValidation.valid) {
    releaseCompileSlot();
    console.warn(`[${jobId}] [Security] Main file validation failed: ${mainFileValidation.error}`);
    return res.status(400).json({
      success: false,
      error: mainFileValidation.error,
    });
  }

  // 3) Validate per-file size
  let totalSize = 0;
  for (const [filename, content] of Object.entries(projectFiles)) {
    const sizeCheck = validateSingleFileSize(content, filename, false);
    if (!sizeCheck.valid) {
      releaseCompileSlot();
      return res.status(400).json({
        success: false,
        error: sizeCheck.error,
      });
    }
    totalSize += sizeCheck.size;
  }

  for (const [filename, content] of Object.entries(binaryFiles)) {
    const sizeCheck = validateSingleFileSize(content, filename, true);
    if (!sizeCheck.valid) {
      releaseCompileSlot();
      return res.status(400).json({
        success: false,
        error: sizeCheck.error,
      });
    }
    totalSize += sizeCheck.size;
  }

  console.log(`[${jobId}] Total file size: ${Math.round(totalSize / 1024 / 1024 * 100) / 100}MB`);

  // 4) Validate LaTeX content safety
  const securityViolations = [];
  for (const [filename, content] of Object.entries(projectFiles)) {
    if (filename.endsWith('.tex') || filename.endsWith('.sty') || filename.endsWith('.cls')) {
      const result = validateLatexSecurity(content, filename);
      if (!result.safe) {
        securityViolations.push({ filename, violations: result.violations });
      }
    }
  }

  if (securityViolations.length > 0) {
    releaseCompileSlot();
    console.warn(`[${jobId}] [Security] LaTeX security violations:`, JSON.stringify(securityViolations, null, 2));
    return res.status(400).json({
      success: false,
      error: 'SECURITY_RISK', // Error code; frontend translates via i18n
      errorCode: 'SECURITY_RISK',
      details: securityViolations.map(sv => ({
        file: sv.filename,
        issues: sv.violations.map(v => `${v.pattern}: ${v.description}`),
      })),
    });
  }

  console.log(`[${jobId}] Security checks passed`);

  try {
    // Create job and media directories
    await fs.mkdir(jobDir, { recursive: true });
    await fs.mkdir(mediaDir, { recursive: true });

    // Write all text files
    for (const [filename, content] of Object.entries(projectFiles)) {
      const filePath = path.join(jobDir, filename);
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(filePath, content, 'utf8');
    }

    // Write all binary files
    for (const [filename, base64Content] of Object.entries(binaryFiles)) {
      const filePath = path.join(jobDir, filename);
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });
      const buffer = Buffer.from(base64Content, 'base64');
      await fs.writeFile(filePath, buffer);
    }

    // Determine output file extension and MIME type
    const formatConfig = {
      markdown: { ext: 'md', mime: 'text/markdown', pandocFormat: 'gfm' },
      docx: { ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pandocFormat: 'docx' },
      html: { ext: 'html', mime: 'text/html', pandocFormat: 'html5' },
    };

    const config = formatConfig[format];
    const outputFilename = mainFile.replace(/\.tex$/, `.${config.ext}`);
    const outputPath = path.join(jobDir, outputFilename);

    // Use latexpand to expand all \input{} and \include{} references
    const expandedFile = mainFile.replace(/\.tex$/, '.expanded.tex');
    const expandedPath = path.join(jobDir, expandedFile);

    console.log(`[${jobId}] Expanding LaTeX sources with latexpand...`);

    try {
      await new Promise((resolve, reject) => {
        const latexpandCmd = `cd "${jobDir}" && latexpand "${mainFile}" -o "${expandedFile}" 2>&1`;
        exec(latexpandCmd, { timeout: 30000 }, (error, stdout, stderr) => {
          if (error) {
            console.log(`[${jobId}] latexpand warning/error (falling back to original file):`, stdout || stderr);
            // Even if latexpand fails, keep using the original file
            resolve();
          } else {
            console.log(`[${jobId}] latexpand succeeded`);
            resolve();
          }
        });
      });
    } catch (e) {
      console.log(`[${jobId}] latexpand failed; using original file:`, e.message);
    }

    // If the expanded file exists, use it
    let inputFile = mainFile;
    let latexContentForImages = '';
    let titleImages = [];  // Defined outside so it can be accessed later
    try {
      await fs.access(expandedPath);
      inputFile = expandedFile;
      console.log(`[${jobId}] Using expanded file: ${expandedFile}`);

      // Pre-processing: simplify complex metadata definitions (title, author)
      let expandedContent = await fs.readFile(expandedPath, 'utf8');
      latexContentForImages = expandedContent;  // Keep for image preprocessing
      const metadataResult = extractAndSimplifyMetadata(expandedContent);
      const simplifiedContent = metadataResult.content;
      titleImages = metadataResult.titleImages || [];

      // Store title image paths to merge with imageMap later
      if (titleImages.length > 0) {
        console.log(`[${jobId}] Found ${titleImages.length} title-region image(s): ${titleImages.join(', ')}`);
      }

      if (simplifiedContent !== expandedContent) {
        await fs.writeFile(expandedPath, simplifiedContent, 'utf8');
        console.log(`[${jobId}] Simplified metadata definitions`);
      }
    } catch (e) {
      console.log(`[${jobId}] Using original file: ${mainFile}`);
      // Read original file for image preprocessing
      try {
        latexContentForImages = await fs.readFile(path.join(jobDir, mainFile), 'utf8');
        // Also extract title images from the original file
        const metadataResult = extractAndSimplifyMetadata(latexContentForImages);
        titleImages = metadataResult.titleImages || [];
        if (titleImages.length > 0) {
          console.log(`[${jobId}] Found ${titleImages.length} title image(s) in original file`);
        }
      } catch (readErr) {
        console.log(`[${jobId}] Failed to read main file:`, readErr.message);
      }
    }

    // Preprocess LaTeX images: prepare all images before conversion
    let imageMap = {};
    let figureEnvs = [];  // Figure environment info extracted from LaTeX
    let processedTitleImages = [];  // Processed title image info
    let labelMap = {};  // Map: label -> numbering
    if (latexContentForImages) {
      // Extract label numbering map (for references)
      labelMap = extractLabelsAndNumbers(latexContentForImages);

      // Extract figure environment info (for supplementing missing images later)
      figureEnvs = extractFigureEnvironments(latexContentForImages);
      console.log(`[${jobId}] Found ${figureEnvs.length} figure environment(s)`);

      imageMap = await preprocessLatexImages(latexContentForImages, jobDir, mediaDir);
      console.log(`[${jobId}] Image preprocessing done. Total images: ${Object.keys(imageMap).length}`);

      // Handle title-region images (not inside figure environments)
      if (titleImages && titleImages.length > 0) {
        for (const imgPath of titleImages) {
          // Check whether the image has already been preprocessed
          const normalizedPath = imgPath.replace(/\\/g, '/');
          if (!imageMap[normalizedPath] && !imageMap[imgPath]) {
            // Try to locate and copy the image
            const basePath = normalizedPath.replace(/\.(png|jpg|jpeg|pdf|eps|svg)$/i, '');
            const extensions = ['.png', '.jpg', '.jpeg', '.pdf', '.PNG', '.JPG', '.JPEG', '.PDF'];
            const tryPaths = [normalizedPath, ...extensions.map(ext => basePath + ext)];

            for (const tryPath of tryPaths) {
              const fullPath = path.join(jobDir, tryPath);
              try {
                await fs.access(fullPath);
                const isPdf = tryPath.toLowerCase().endsWith('.pdf');
                let targetName = path.basename(fullPath);
                let targetPath = path.join(mediaDir, targetName);

                if (isPdf) {
                  // Convert PDF to PNG
                  const pngPath = await pdfToPng(fullPath);
                  if (pngPath) {
                    targetName = path.basename(pngPath);
                    targetPath = path.join(mediaDir, targetName);
                    await fs.copyFile(pngPath, targetPath);
                    imageMap[imgPath] = 'media/' + targetName;
                    processedTitleImages.push({ original: imgPath, media: 'media/' + targetName, name: targetName });
                    console.log(`[${jobId}] Title image PDF converted: ${imgPath} -> ${targetName}`);
                  }
                } else {
                  await fs.copyFile(fullPath, targetPath);
                  imageMap[imgPath] = 'media/' + targetName;
                  processedTitleImages.push({ original: imgPath, media: 'media/' + targetName, name: targetName });
                  console.log(`[${jobId}] Title image copied: ${imgPath} -> ${targetName}`);
                }
                break;
              } catch (e) {
                // Try next path
              }
            }
          } else {
            // Image already preprocessed; record it
            const mediaPath = imageMap[normalizedPath] || imageMap[imgPath];
            if (mediaPath) {
              processedTitleImages.push({ original: imgPath, media: mediaPath, name: path.basename(mediaPath) });
            }
          }
        }
        console.log(`[${jobId}] Title image processing done. Total: ${processedTitleImages.length}`);
      }

      // Update image paths in LaTeX to point to media directory
      if (Object.keys(imageMap).length > 0) {
        const inputPath = path.join(jobDir, inputFile);
        try {
          let latexContent = await fs.readFile(inputPath, 'utf8');
          const updatedContent = updateLatexImagePaths(latexContent, imageMap);
          if (updatedContent !== latexContent) {
            await fs.writeFile(inputPath, updatedContent, 'utf8');
            console.log(`[${jobId}] Updated image paths in LaTeX source`);
          }
        } catch (e) {
          console.log(`[${jobId}] Failed to update image paths:`, e.message);
        }
      }
    }

    // Build Pandoc command args
    // Base args
    let pandocArgs = [
      'pandoc',
      '-f', 'latex+raw_tex',  // Support raw LaTeX (preserve commands Pandoc can't parse)
      '-t', config.pandocFormat,
      '-o', `"${outputFilename}"`,
      `"${inputFile}"`,  // Use expanded file (if present)
      '--extract-media=media',  // Extract images to media directory
    ];

    // Format-specific args (Pandoc is only used for Markdown and DOCX)
    if (format === 'markdown') {
      pandocArgs.push(
        '--standalone',          // Generate a standalone document with metadata (title, author, abstract)
        '--wrap=none',           // Disable automatic line wrapping
        '--markdown-headings=atx', // Use ATX-style headings (#)
      );
    } else if (format === 'docx') {
      // DOCX uses default config; formulas and images are handled automatically
    }
    // HTML uses LaTeXML, not Pandoc

    const pandocCmd = `cd "${jobDir}" && ${pandocArgs.join(' ')}`;

    // ========== HTML: use LaTeXML ==========
    if (format === 'html') {
      try {
        // Preprocess LaTeX: remove incompatible packages (e.g. fontawesome)
        const inputPath = path.join(jobDir, inputFile);
        let latexForHtml = await fs.readFile(inputPath, 'utf8');
        latexForHtml = preprocessForLaTeXML(latexForHtml);
        await fs.writeFile(inputPath, latexForHtml);
        console.log(`[${jobId}] Preprocessed LaTeX source (removed incompatible packages)`);

        console.log(`[${jobId}] Converting to HTML with LaTeXML...`);
        await convertWithLaTeXML(inputFile, outputFilename, jobDir);
        console.log(`[${jobId}] LaTeXML conversion succeeded`);

        // Read output file
        let outputBuffer = await fs.readFile(outputPath);
        let content = outputBuffer.toString('utf8');

        // Process images
        const imgMatches = content.match(/<img[^>]+>|<embed[^>]+>/gi) || [];
        console.log(`[${jobId}] LaTeXML output contains ${imgMatches.length} image reference(s)`);

        let { content: processedContent, images } = await processMarkdownImages(content, jobDir, imageMap);

        // Supplement missing images
        if (figureEnvs.length > 0 && latexContentForImages) {
          processedContent = supplementMissingImages(processedContent, imageMap, latexContentForImages, figureEnvs);
        }

        // Process references and numbering
        if (Object.keys(labelMap).length > 0) {
          processedContent = processReferencesAndNumbers(processedContent, labelMap, figureEnvs);
        }

        // Insert title images
        if (processedTitleImages.length > 0) {
          for (const img of processedTitleImages) {
            if (!images.some(i => i.name === 'images/' + img.name)) {
              const sourcePath = path.join(jobDir, img.media);
              try {
                await fs.access(sourcePath);
                images.push({ name: 'images/' + img.name, sourcePath });
              } catch (e) {}
            }
          }
          // HTML: insert right after <body>
          const logoHtml = processedTitleImages.map(img =>
            `<img src="images/${img.name}" alt="Logo" style="height: 1.5em; vertical-align: middle;" />`
          ).join(' ') + '\n';
          if (processedContent.includes('<body>')) {
            processedContent = processedContent.replace('<body>', '<body>\n' + logoHtml);
          }
        }

        // Package into a ZIP
        const zipFilename = `${safeProjectName}.zip`;
        const zipPath = path.join(jobDir, zipFilename);
        const mainContentFilename = `${safeProjectName}.html`;

        await createContentZip(processedContent, images, zipPath, mainContentFilename);
        outputBuffer = await fs.readFile(zipPath);

        console.log(`[${jobId}] HTML conversion succeeded. Output: ${zipFilename}`);

        // Decrement concurrency counter
        releaseCompileSlot();
        console.log(`[${jobId}] HTML conversion job finished (concurrent: ${currentCompileCount}/${MAX_CONCURRENT_COMPILES})`);

        res.json({
          success: true,
          filename: zipFilename,
          mimeType: 'application/zip',
          contentBase64: outputBuffer.toString('base64'),
        });

        // Cleanup
        setTimeout(async () => {
          try {
            await fs.rm(jobDir, { recursive: true, force: true });
          } catch (e) {}
        }, 5000);

        return;  // HTML conversion complete; return early
      } catch (latexmlError) {
        // Decrement concurrency counter
        releaseCompileSlot();
        console.log(`[${jobId}] HTML conversion job finished (error) (concurrent: ${currentCompileCount}/${MAX_CONCURRENT_COMPILES})`);

        console.error(`[${jobId}] LaTeXML conversion failed:`, latexmlError.message);
        return res.json({
          success: false,
          error: `HTML conversion failed: ${latexmlError.message}`,
        });
      }
    }

    // ========== Markdown/DOCX: use Pandoc ==========
    console.log(`[${jobId}] Running Pandoc: ${pandocArgs.slice(0, 6).join(' ')} ...`);

    exec(pandocCmd, { timeout: 120000, maxBuffer: 50 * 1024 * 1024 }, async (error, stdout, stderr) => {
      try {
        if (stderr) {
          console.log(`[${jobId}] Pandoc stderr:`, stderr.slice(0, 500));
        }

        // Ensure output file exists
        try {
          await fs.access(outputPath);
        } catch (e) {
          console.error(`[${jobId}] Output file does not exist:`, error?.message || 'unknown');
          return res.json({
            success: false,
            error: `Conversion failed: ${stderr || error?.message || 'Output file was not generated'}`,
          });
        }

        // Read output file
        let outputBuffer = await fs.readFile(outputPath);

        // For Markdown: process images and package into a ZIP
        if (format === 'markdown') {
          let content = outputBuffer.toString('utf8');

          // Diagnostic log: image references in raw Pandoc output
          const imgMatches = content.match(/!\[[^\]]*\]\([^)]+\)|<img[^>]+>|<embed[^>]+>/gi) || [];
          console.log(`[${jobId}] Pandoc output contains ${imgMatches.length} image reference(s):`);
          imgMatches.slice(0, 10).forEach((m, i) => console.log(`  ${i + 1}. ${m.substring(0, 100)}...`));

          // Diagnostic log: list media directory contents
          try {
            const mediaFiles = await fs.readdir(path.join(jobDir, 'media'), { recursive: true });
            console.log(`[${jobId}] media directory contains ${mediaFiles.length} file(s):`, mediaFiles.slice(0, 20));
          } catch (e) {
            console.log(`[${jobId}] media directory does not exist or is empty`);
          }

          let { content: processedContent, images } = await processMarkdownImages(content, jobDir, imageMap);

          // Supplement images missed by Pandoc
          if (figureEnvs.length > 0 && latexContentForImages) {
            processedContent = supplementMissingImages(processedContent, imageMap, latexContentForImages, figureEnvs);
          }

          // Process references and numbering (Figure X, Table X, Equation X)
          if (Object.keys(labelMap).length > 0) {
            processedContent = processReferencesAndNumbers(processedContent, labelMap, figureEnvs);
            console.log(`[${jobId}] Processed references and numbering`);
          }

          // Insert title images (logo, etc.) - Markdown only
          if (processedTitleImages.length > 0) {
            console.log(`[${jobId}] Preparing to insert ${processedTitleImages.length} title image(s)`);

            // Ensure images are included in the bundle list
            for (const img of processedTitleImages) {
              if (!images.some(i => i.name === 'images/' + img.name)) {
                const sourcePath = path.join(jobDir, img.media);
                try {
                  await fs.access(sourcePath);
                  images.push({ name: 'images/' + img.name, sourcePath });
                } catch (e) {
                  console.log(`[${jobId}] Title image file not found: ${sourcePath}`);
                }
              }
            }

            // Markdown: try inserting logo into the title line
            const yamlMatch = processedContent.match(/^---\n([\s\S]*?)\n---/);
            if (yamlMatch) {
              const yamlContent = yamlMatch[1];
              const titleMatch = yamlContent.match(/^title:\s*["']?(.+?)["']?\s*$/m);
              if (titleMatch) {
                // Generate logo image references
                const logoImgs = processedTitleImages.map(img => `![](images/${img.name})`).join(' ');
                const newTitle = `title: "${logoImgs} ${titleMatch[1].replace(/^["']|["']$/g, '')}"`;
                const newYaml = yamlContent.replace(/^title:\s*["']?.+?["']?\s*$/m, newTitle);
                processedContent = processedContent.replace(yamlMatch[0], `---\n${newYaml}\n---`);
                console.log(`[${jobId}] Inserted logo into Markdown title`);
              } else {
                // If there is no title field, insert after YAML block
                const titleImgMarkdown = '\n' + processedTitleImages.map(img => `![Logo](images/${img.name})`).join(' ') + '\n\n';
                const insertPos = yamlMatch[0].length + 1;
                processedContent = processedContent.slice(0, insertPos) + titleImgMarkdown + processedContent.slice(insertPos);
                console.log(`[${jobId}] Inserted title images after YAML block`);
              }
            } else {
              // No YAML; insert at start of document
              const titleImgMarkdown = processedTitleImages.map(img => `![Logo](images/${img.name})`).join(' ') + '\n\n';
              processedContent = titleImgMarkdown + processedContent;
              console.log(`[${jobId}] Inserted title images at start of document`);
            }
          }

          // Use project name as filename (Markdown only)
          const zipFilename = `${safeProjectName}.zip`;
          const zipPath = path.join(jobDir, zipFilename);
          const mainContentFilename = `${safeProjectName}.md`;

          await createContentZip(processedContent, images, zipPath, mainContentFilename);

          // Wait briefly to ensure file writes finish
          await new Promise(resolve => setTimeout(resolve, 100));

          outputBuffer = await fs.readFile(zipPath);

          console.log(`[${jobId}] Conversion succeeded. Output: ${zipFilename} (${outputBuffer.length} bytes), images: ${images.length}`);

          res.json({
            success: true,
            filename: zipFilename,
            mimeType: 'application/zip',
            contentBase64: outputBuffer.toString('base64'),
          });
        } else if (format === 'docx') {
          // DOCX: return directly using project name
          const docxFilename = `${safeProjectName}.docx`;
          const outputBase64 = outputBuffer.toString('base64');

          console.log(`[${jobId}] Conversion succeeded. Output: ${docxFilename} (${outputBuffer.length} bytes)`);

          res.json({
            success: true,
            filename: docxFilename,
            mimeType: config.mime,
            contentBase64: outputBase64,
          });
        }
      } finally {
        // Decrement concurrency counter
        releaseCompileSlot();
        console.log(`[${jobId}] Conversion job finished (concurrent: ${currentCompileCount}/${MAX_CONCURRENT_COMPILES})`);

        // Cleanup job directory
        setTimeout(async () => {
          try {
            await fs.rm(jobDir, { recursive: true, force: true });
            console.log(`[${jobId}] Cleanup completed`);
          } catch (e) {
            console.error(`[${jobId}] Cleanup failed:`, e.message);
          }
        }, 5000);
      }
    });
  } catch (err) {
    // Decrement concurrency counter
    releaseCompileSlot();
    console.error(`[${jobId}] Conversion error:`, err);

    // Cleanup
    try {
      await fs.rm(jobDir, { recursive: true, force: true });
    } catch (e) {}

    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// Static file server (for PDF download)
app.use('/pdf', express.static(COMPILE_DIR));

// ==================== Snippet preview ====================

/**
 * Compile a LaTeX snippet into an image (for accurate previews of tables, equations, etc.).
 * POST /preview-snippet
 * Body: {
 *   snippet: string,           // LaTeX snippet
 *   type?: 'table' | 'equation' | 'figure',  // Snippet type (default: table)
 *   preamble?: string          // Extra preamble content
 * }
 * Response: {
 *   success: boolean,
 *   image?: string,            // Base64-encoded PNG image
 *   error?: string
 * }
 */
const snippetPreviewCache = new Map(); // In-memory cache
const SNIPPET_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const SNIPPET_COMPILE_TIMEOUT = 10000; // 10s timeout (snippets should compile quickly)

app.post('/preview-snippet', async (req, res) => {
  const { snippet, type = 'table', preamble = '' } = req.body;

  if (!snippet || typeof snippet !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'Missing required parameter: snippet'
    });
  }

  // Compute cache key
  const crypto = require('crypto');
  const cacheKey = crypto.createHash('md5').update(snippet + preamble + type).digest('hex');

  // Check cache
  const cached = snippetPreviewCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < SNIPPET_CACHE_TTL) {
    console.log(`[Snippet] Cache hit: ${cacheKey.substring(0, 8)}...`);
    return res.json({ success: true, image: cached.image });
  }

  const jobId = `snippet-${uuidv4().substring(0, 8)}`;
  const jobDir = path.join(COMPILE_DIR, jobId);

  console.log(`[${jobId}] Starting snippet preview. Type: ${type}, length: ${snippet.length}`);

  try {
    // Create temporary directory
    await fs.mkdir(jobDir, { recursive: true });

    // Choose packages based on snippet type
    let packages = '\\usepackage{amsmath,amssymb,amsfonts}';
    if (type === 'table') {
      packages += '\\usepackage{booktabs,array,tabularx,multirow}';
    } else if (type === 'figure') {
      packages += '\\usepackage{graphicx}';
    }

    // Build a complete LaTeX document.
    // Use standalone class to auto-crop to content bounds.
    const doc = `\\documentclass[preview,border=4pt,varwidth]{standalone}
\\usepackage[UTF8]{ctex}
${packages}
${preamble}
\\begin{document}
${snippet}
\\end{document}
`;

    // Write file
    const texFile = path.join(jobDir, 'snippet.tex');
    await fs.writeFile(texFile, doc, 'utf8');

    // Compile LaTeX (TeX Live)
    // Cross-platform: Windows and Docker use the command name directly
    const isWindowsSnippet = process.platform === 'win32';
    const TEXLIVE_BIN_SNIPPET = process.env.TEXLIVE_BIN || '';
    const xelatexExe = (isWindowsSnippet || !TEXLIVE_BIN_SNIPPET) ? 'xelatex' : `${TEXLIVE_BIN_SNIPPET}/xelatex`;
    const compileCmd = `cd "${jobDir}" && ${xelatexExe} -no-shell-escape -interaction=nonstopmode snippet.tex`;

    await new Promise((resolve, reject) => {
      exec(compileCmd, { timeout: SNIPPET_COMPILE_TIMEOUT, maxBuffer: 5 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          console.log(`[${jobId}] Compilation failed:`, error.message);
          // Check whether a PDF was generated (warnings may still produce output)
          const pdfExists = fsSync.existsSync(path.join(jobDir, 'snippet.pdf'));
          if (!pdfExists) {
            reject(new Error('LaTeX compilation failed'));
            return;
          }
        }
        resolve(true);
      });
    });

    const pdfPath = path.join(jobDir, 'snippet.pdf');
    const pngPath = path.join(jobDir, 'snippet.png');

    // Ensure PDF exists
    try {
      await fs.access(pdfPath);
    } catch {
      throw new Error('PDF_NOT_GENERATED');
    }

    // Convert PDF to PNG using pdftoppm or ImageMagick convert.
    // Prefer pdftoppm (faster); fall back to ImageMagick convert if unavailable.
    let convertCmd;
    try {
      // Check whether pdftoppm is available (Windows: where; Unix: which)
      const whichCmd = isWindowsSnippet ? 'where pdftoppm' : 'which pdftoppm';
      require('child_process').execSync(whichCmd, { stdio: 'ignore' });
      // pdftoppm output format: snippet-1.png
      convertCmd = `cd "${jobDir}" && pdftoppm -png -r 200 -singlefile snippet.pdf snippet`;
    } catch {
      // Use ImageMagick convert (on Windows it may be "magick convert")
      const convertExe = isWindowsSnippet ? 'magick convert' : 'convert';
      convertCmd = `cd "${jobDir}" && ${convertExe} -density 200 snippet.pdf -quality 95 snippet.png`;
    }

    await new Promise((resolve, reject) => {
      exec(convertCmd, { timeout: 5000 }, (error) => {
        if (error) {
          console.log(`[${jobId}] Image conversion failed:`, error.message);
          reject(new Error('IMAGE_CONVERSION_FAILED'));
          return;
        }
        resolve(true);
      });
    });

    // Read generated PNG file
    let pngData;
    try {
      // pdftoppm outputs snippet.png
      pngData = await fs.readFile(pngPath);
    } catch {
      throw new Error('PNG_NOT_GENERATED');
    }

    const base64Image = pngData.toString('base64');

    // Save to cache
    snippetPreviewCache.set(cacheKey, {
      image: base64Image,
      timestamp: Date.now()
    });

    // Limit cache size (max 100 entries)
    if (snippetPreviewCache.size > 100) {
      const oldestKey = snippetPreviewCache.keys().next().value;
      snippetPreviewCache.delete(oldestKey);
    }

    console.log(`[${jobId}] Snippet preview succeeded. Image size: ${Math.round(base64Image.length / 1024)}KB`);

    res.json({ success: true, image: base64Image });

  } catch (error) {
    console.log(`[${jobId}] Snippet preview failed:`, error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  } finally {
    // Cleanup temporary directory
    try {
      await fs.rm(jobDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
});

// Periodically clean up expired snippet cache entries
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of snippetPreviewCache.entries()) {
    if (now - value.timestamp > SNIPPET_CACHE_TTL) {
      snippetPreviewCache.delete(key);
    }
  }
}, 60000); // Clean once per minute

// ==================== PDF-to-image API ====================

/**
 * Convert a PDF to a PNG image.
 * POST /pdf-to-image
 * Body: {
 *   pdfBase64: string,  // Base64-encoded PDF
 *   page?: number,      // Page number to convert (default: 1)
 *   dpi?: number        // DPI (default: 150)
 * }
 * Response: {
 *   success: boolean,
 *   image?: string,     // Base64-encoded PNG image
 *   error?: string
 * }
 */
app.post('/pdf-to-image', async (req, res) => {
  const { pdfBase64, page = 1, dpi = 150 } = req.body;

  if (!pdfBase64 || typeof pdfBase64 !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'Missing required parameter: pdfBase64'
    });
  }

  const jobId = `pdf2img-${uuidv4().substring(0, 8)}`;
  const jobDir = path.join(COMPILE_DIR, jobId);

  console.log(`[${jobId}] Starting PDF to image conversion, page: ${page}, dpi: ${dpi}`);

  try {
    // Create temporary directory
    await fs.mkdir(jobDir, { recursive: true });

    // Write PDF file
    const pdfPath = path.join(jobDir, 'input.pdf');
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    await fs.writeFile(pdfPath, pdfBuffer);

    // Convert using pdftoppm
    const outputPrefix = path.join(jobDir, 'output');
    const cmd = `pdftoppm -png -f ${page} -l ${page} -r ${dpi} -singlefile "${pdfPath}" "${outputPrefix}"`;

    await new Promise((resolve, reject) => {
      exec(cmd, { timeout: 30000 }, (error) => {
        if (error) {
          console.log(`[${jobId}] pdftoppm failed:`, error.message);
          reject(new Error('PDF conversion failed'));
          return;
        }
        resolve(true);
      });
    });

    // Read generated PNG
    const pngPath = path.join(jobDir, 'output.png');
    let pngData;
    try {
      pngData = await fs.readFile(pngPath);
    } catch {
      throw new Error('PNG not generated');
    }

    const imageBase64 = pngData.toString('base64');
    console.log(`[${jobId}] Conversion successful, image size: ${pngData.length} bytes`);

    res.json({
      success: true,
      image: imageBase64
    });

  } catch (error) {
    console.log(`[${jobId}] Conversion failed:`, error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  } finally {
    // Cleanup temporary directory
    try {
      await fs.rm(jobDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
});

// ==================== SyncTeX API ====================

/**
 * SyncTeX bidirectional sync query.
 * POST /synctex
 * Body: {
 *   synctexBase64: string,  // Base64-encoded synctex.gz file
 *   pdfBase64: string,      // Base64-encoded PDF file (used to obtain paths)
 *   direction: "forward" | "backward",
 *   // Backward sync (PDF → source)
 *   page?: number,
 *   x?: number,
 *   y?: number,
 *   // Forward sync (source → PDF)
 *   file?: string,
 *   line?: number,
 *   column?: number,
 * }
 */
app.post('/synctex', async (req, res) => {
  const { synctexBase64, pdfBase64, direction = 'backward', page, x, y, file, line, column = 0 } = req.body;

  if (!synctexBase64 || !pdfBase64) {
    return res.status(400).json({
      success: false,
      error: 'Missing required parameters: synctexBase64, pdfBase64'
    });
  }

  const jobId = `synctex-${uuidv4().substring(0, 8)}`;
  const jobDir = path.join(COMPILE_DIR, jobId);

  console.log(`[${jobId}] SyncTeX ${direction} query`);

  try {
    // Create temporary directory
    await fs.mkdir(jobDir, { recursive: true });

    // Write files
    const synctexPath = path.join(jobDir, 'output.synctex.gz');
    const pdfPath = path.join(jobDir, 'output.pdf');

    await fs.writeFile(synctexPath, Buffer.from(synctexBase64, 'base64'));
    await fs.writeFile(pdfPath, Buffer.from(pdfBase64, 'base64'));

    let result;

    if (direction === 'backward') {
      // Backward sync: PDF → source
      if (typeof page !== 'number' || typeof x !== 'number' || typeof y !== 'number') {
        return res.status(400).json({
          success: false,
          error: 'Backward sync requires: page, x, y'
        });
      }

      const cmd = `synctex edit -o "${page}:${x}:${y}:${pdfPath}"`;
      console.log(`[${jobId}] Running: ${cmd}`);

      const { stdout } = await new Promise((resolve, reject) => {
        exec(cmd, { timeout: 5000 }, (error, stdout, stderr) => {
          if (error && !stdout) {
            reject(error);
          } else {
            resolve({ stdout, stderr });
          }
        });
      });

      // Parse output - supports multiple match groups
      // SyncTeX may return multiple matches; each "Output:" starts a new group
      console.log(`[${jobId}] SyncTeX raw output:\n${stdout}`);
      const lines = stdout.split('\n');

      // Collect all match groups
      const matches = [];
      let currentMatch = {};

      // Convert SyncTeX Input paths into a project-relative path (preserving subdirectories when possible).
      // Notes:
      // - Compilation happens under COMPILE_DIR/<jobId>/, so synctex commonly contains paths like:
      //   - chapters/intro.tex
      //   - ./chapters/intro.tex
      //   - /tmp/latex-compile/<compile-jobId>/chapters/intro.tex
      // - The caller (main service) uses this relative path to build storage keys (projects/{id}/{relPath})
      const normalizeSynctexInputPath = (inputPath) => {
        if (!inputPath || typeof inputPath !== 'string') return null;

        // Strip optional quotes and normalize to POSIX separators
        let p = inputPath.trim().replace(/\0/g, '');
        if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) {
          p = p.slice(1, -1).trim();
        }
        p = p.replace(/\\/g, '/');

        // Remove common ./ prefixes
        p = p.replace(/^(\.\/)+/, '');

        // If it's an absolute path inside the compile sandbox, strip COMPILE_DIR/<jobId>/ prefix
        const compileDirNorm = path.resolve(COMPILE_DIR).replace(/\\/g, '/').replace(/\/+$/, '');
        if (p.startsWith(compileDirNorm + '/')) {
          let rest = p.slice(compileDirNorm.length + 1); // Strip COMPILE_DIR/
          const parts = rest.split('/').filter(Boolean);
          if (parts.length > 1) {
            // Drop the first directory (jobId)
            rest = parts.slice(1).join('/');
          } else {
            rest = parts.join('/');
          }
          p = rest;
        }

        // Still absolute (outside sandbox): fall back to basename (usually a TeXLive system file)
        const isAbsPosix = p.startsWith('/');
        const isAbsWin = /^[A-Za-z]:\//.test(p);
        if (isAbsPosix || isAbsWin) {
          p = path.basename(p);
        }

        // Normalize and prevent path traversal
        p = path.posix.normalize(p);
        p = p.replace(/^(\.\.\/)+/, '').replace(/^(\.\/)+/, '').replace(/^\/+/, '');

        return p || null;
      };

      for (const l of lines) {
        if (l.startsWith('Output:')) {
          // New match group starts; save previous one (if valid)
          if (currentMatch.file && currentMatch.line !== undefined) {
            matches.push({ ...currentMatch });
          }
          currentMatch = {};
        } else if (l.startsWith('Input:')) {
          const rawInput = l.substring(6).trim();
          currentMatch.file = normalizeSynctexInputPath(rawInput);
        } else if (l.startsWith('Line:')) {
          currentMatch.line = parseInt(l.substring(5).trim(), 10);
        } else if (l.startsWith('Column:')) {
          currentMatch.column = parseInt(l.substring(7).trim(), 10);
        } else if (l.startsWith('x:')) {
          currentMatch.matchX = parseFloat(l.substring(2).trim());
        } else if (l.startsWith('y:')) {
          currentMatch.matchY = parseFloat(l.substring(2).trim());
        } else if (l.startsWith('h:')) {
          currentMatch.h = parseFloat(l.substring(2).trim());
        } else if (l.startsWith('v:')) {
          currentMatch.v = parseFloat(l.substring(2).trim());
        }
      }

      // Save the last match group
      if (currentMatch.file && currentMatch.line !== undefined) {
        matches.push({ ...currentMatch });
      }

      console.log(`[${jobId}] Found ${matches.length} match(es):`, matches.map(m => `${m.file}:${m.line}`).join(', '));

      if (matches.length === 0) {
        result = { success: false, error: 'Source position not found' };
      } else if (matches.length === 1) {
        // Single match: use directly
        const best = matches[0];
        console.log(`[${jobId}] Single match: ${best.file}:${best.line}`);
        result = { success: true, file: best.file, line: best.line, column: best.column };
      } else {
        // Multiple matches: return all so the caller can disambiguate using context
        console.log(`[${jobId}] Multiple matches found, returning all for context matching`);
        result = {
          success: true,
          // Default to the first match
          file: matches[0].file,
          line: matches[0].line,
          column: matches[0].column,
          matchCount: matches.length,
          // Return all matches for context-based matching
          allMatches: matches.map(m => ({ file: m.file, line: m.line, column: m.column }))
        };
      }

    } else {
      // Forward sync: source → PDF
      if (!file || typeof line !== 'number') {
        return res.status(400).json({
          success: false,
          error: 'Forward sync requires: file, line'
        });
      }

      const inputFile = `./${file}`;
      const cmd = `synctex view -i "${line}:${column}:${inputFile}" -o "${pdfPath}"`;
      console.log(`[${jobId}] Running: ${cmd}`);

      const { stdout } = await new Promise((resolve, reject) => {
        exec(cmd, { timeout: 5000 }, (error, stdout, stderr) => {
          if (error && !stdout) {
            reject(error);
          } else {
            resolve({ stdout, stderr });
          }
        });
      });

      // Parse output
      const lines = stdout.split('\n');
      let resultPage, resultX, resultY, resultH, resultV;

      for (const l of lines) {
        if (l.startsWith('Page:')) {
          resultPage = parseInt(l.substring(5).trim(), 10);
        } else if (l.startsWith('x:')) {
          resultX = parseFloat(l.substring(2).trim());
        } else if (l.startsWith('y:')) {
          resultY = parseFloat(l.substring(2).trim());
        } else if (l.startsWith('h:')) {
          resultH = parseFloat(l.substring(2).trim());
        } else if (l.startsWith('v:')) {
          resultV = parseFloat(l.substring(2).trim());
        }
      }

      if (resultPage !== undefined) {
        console.log(`[${jobId}] Found: page ${resultPage}`);
        result = { success: true, page: resultPage, x: resultX, y: resultY, h: resultH, v: resultV };
      } else {
        result = { success: false, error: 'PDF position not found' };
      }
    }

    res.json(result);

  } catch (error) {
    console.log(`[${jobId}] SyncTeX error:`, error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'SyncTeX query failed'
    });
  } finally {
    // Cleanup temporary directory
    try {
      await fs.rm(jobDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
});

// ==================== Markdown-to-PDF endpoint ====================

/**
 * POST /convert-md - Convert Markdown to PDF
 * Body: { content: string, filename?: string, projectName?: string }
 *
 * Uses Pandoc to convert Markdown to PDF with Chinese support.
 */
app.post('/convert-md', express.json({ limit: '10mb' }), async (req, res) => {
  const jobId = uuidv4().substring(0, 8);
  const jobDir = path.join(COMPILE_DIR, `md-${jobId}`);

  console.log(`[${jobId}] Markdown to PDF conversion request`);

  try {
    const { content, filename: rawFilename = 'document', projectName: rawProjectName = 'Markdown Document', binaryFiles = {} } = req.body;

    if (!content || typeof content !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Missing or invalid content'
      });
    }

    // Safety: remove shell metacharacters and dangerous characters to prevent command injection
    const sanitizeForFilename = (str) => {
      // Allow only letters, digits, underscore, hyphen, dot, and space
      return String(str).replace(/[^a-zA-Z0-9_\-. \u4e00-\u9fff]/g, '_').slice(0, 200);
    };
    const sanitizeForTitle = (str) => {
      // Remove characters that could lead to command injection (newlines, backticks, etc.)
      let cleaned = String(str).replace(/[`\n\r]/g, '');

      // Escape LaTeX special characters to avoid XeLaTeX compile errors
      // Use a placeholder for backslashes so its braces won't be escaped later
      const BACKSLASH_PLACEHOLDER = '\x00BACKSLASH\x00';
      cleaned = cleaned.replace(/\\/g, BACKSLASH_PLACEHOLDER);

      // Escape other LaTeX special characters
      cleaned = cleaned.replace(/\{/g, '\\{');
      cleaned = cleaned.replace(/\}/g, '\\}');
      cleaned = cleaned.replace(/\$/g, '\\$');
      cleaned = cleaned.replace(/#/g, '\\#');
      cleaned = cleaned.replace(/%/g, '\\%');
      cleaned = cleaned.replace(/_/g, '\\_');
      cleaned = cleaned.replace(/\^/g, '\\^{}');
      cleaned = cleaned.replace(/~/g, '\\textasciitilde{}');
      cleaned = cleaned.replace(/&/g, '\\&');

      // Finally replace placeholder with LaTeX command (braces will not be escaped)
      cleaned = cleaned.replace(new RegExp(BACKSLASH_PLACEHOLDER, 'g'), '\\textbackslash{}');

      return cleaned.slice(0, 500);
    };

    const filename = sanitizeForFilename(rawFilename);
    const projectName = sanitizeForTitle(rawProjectName);

    // Create temporary directory
    await fs.mkdir(jobDir, { recursive: true });

    // Write Markdown file
    const inputFile = path.join(jobDir, 'input.md');
    await fs.writeFile(inputFile, content, 'utf8');

    // Write binary resource files (images, etc.)
    for (const [filePath, base64Content] of Object.entries(binaryFiles)) {
      // Simple safety check to prevent path traversal
      if (filePath.includes('..') || filePath.startsWith('/')) {
        console.log(`[${jobId}] Skip unsafe path: ${filePath}`);
        continue;
      }
      const absPath = path.join(jobDir, filePath);
      const dir = path.dirname(absPath);
      await fs.mkdir(dir, { recursive: true });
      const buffer = Buffer.from(base64Content, 'base64');
      await fs.writeFile(absPath, buffer);
    }

    // Output file
    const outputFilename = `${filename.replace(/\.md$/i, '')}.pdf`;
    const outputPath = path.join(jobDir, outputFilename);

    // Build Pandoc command args (array form to avoid shell injection)
    // Use xelatex engine for Chinese support and set fonts
    const pandocArgs = [
      'input.md',
      '-o', outputFilename,
      '--pdf-engine=xelatex',
      '-V', 'CJKmainfont=Noto Sans CJK SC',     // CJK main font
      '-V', 'mainfont=Noto Sans',               // Latin main font
      '-V', 'monofont=Noto Sans Mono',          // Monospace font
      '-V', 'geometry:margin=2.5cm',            // Page margins
      '-V', 'fontsize=11pt',                    // Font size
      '-V', 'linestretch=1.5',                  // Line spacing
      '--highlight-style=tango',                // Code highlight theme
      '--resource-path=.:./images',             // Resource path (relative images)
      '--toc',                                  // Generate TOC
      '--toc-depth=3',                          // TOC depth
      '-V', `title=${projectName}`,             // Document title
    ];

    console.log(`[${jobId}] Running Pandoc with spawn (safe): pandoc ${pandocArgs.slice(0, 3).join(' ')} ...`);

    await new Promise((resolve, reject) => {
      // Use spawn instead of exec to avoid shell injection
      // Use cwd to set working directory (no need for cd)
      // NOTE: spawn does not support a timeout option (only exec/execFile do), so we implement it manually
      const pandoc = spawn('pandoc', pandocArgs, {
        cwd: jobDir,
      });

      let stdout = '';
      let stderr = '';
      let timeoutKilled = false;

      // Manual timeout protection (60s)
      const timeoutTimer = setTimeout(() => {
        if (!pandoc.killed) {
          timeoutKilled = true;
          console.log(`[${jobId}] Pandoc timed out (60s); terminating process`);
          pandoc.kill('SIGTERM');
          // If SIGTERM doesn't take effect, force-kill later
          setTimeout(() => {
            pandoc.kill('SIGKILL');
          }, 1000);
        }
      }, 60000);

      pandoc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      pandoc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      pandoc.on('close', (code) => {
        clearTimeout(timeoutTimer);
        if (timeoutKilled) {
          reject(new Error('Pandoc conversion timed out after 60 seconds'));
          return;
        }
        if (stderr) {
          console.log(`[${jobId}] Pandoc stderr:`, stderr.slice(0, 500));
        }
        if (code !== 0) {
          console.log(`[${jobId}] Pandoc error: exit code ${code}`);
          reject(new Error(`Pandoc exited with code ${code}: ${stderr.slice(0, 200)}`));
        } else {
          resolve({ stdout, stderr });
        }
      });

      pandoc.on('error', (error) => {
        clearTimeout(timeoutTimer);
        console.log(`[${jobId}] Pandoc spawn error:`, error.message);
        reject(error);
      });
    });

    // Ensure output file exists
    try {
      await fs.access(outputPath);
    } catch {
      return res.status(500).json({
        success: false,
        error: 'PDF generation failed - output file not created'
      });
    }

    // Read PDF file
    const pdfBuffer = await fs.readFile(outputPath);
    const pdfBase64 = pdfBuffer.toString('base64');

    console.log(`[${jobId}] PDF generated successfully: ${pdfBuffer.length} bytes`);

    res.json({
      success: true,
      filename: outputFilename,
      mimeType: 'application/pdf',
      contentBase64: pdfBase64
    });

  } catch (error) {
    console.error(`[${jobId}] Markdown to PDF error:`, error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Conversion failed'
    });
  } finally {
    // Cleanup temporary directory
    try {
      await fs.rm(jobDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 LaTeX compile service listening on http://localhost:${PORT}`);
  console.log(`📁 Compile directory: ${COMPILE_DIR}`);
  console.log(`📄 Supported conversions: markdown, docx, html, md-pdf`);
  console.log(`🔒 Sandbox security configuration:`);
  console.log(`   - Shell escape: disabled (-no-shell-escape)`);
  console.log(`   - Compile timeout: ${COMPILE_TIMEOUT / 1000}s`);
  console.log(`   - Max concurrent: ${MAX_CONCURRENT_COMPILES}`);
  console.log(`   - Max queue size: ${MAX_QUEUE_SIZE}`);
  console.log(`   - Queue timeout: ${QUEUE_TIMEOUT / 1000}s`);
  console.log(`   - Max project size: ${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB`);
  console.log(`   - Max single file size: ${Math.round(MAX_SINGLE_FILE_SIZE / 1024 / 1024)}MB`);
  console.log(`   - Max file count: ${MAX_FILE_COUNT}`);
  console.log(`   - Dangerous pattern checks: ${DANGEROUS_PATTERNS.length} patterns`);
  console.log(`   - Temp directory cleanup: hourly`);
});
