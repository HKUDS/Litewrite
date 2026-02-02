/**
 * Scan the repository for Chinese (Han) characters.
 *
 * Rule:
 * - Chinese characters are NOT allowed anywhere except in `messages/zh.json`
 *   (and an optional allowlist).
 *
 * Usage:
 * - npx tsx scripts/scan-non-i18n-chinese.ts
 *
 * Exit codes:
 * - 0: no Chinese characters found
 * - 1: Chinese characters found
 */
import { promises as fs } from "node:fs";
import path from "node:path";

type Finding = {
  file: string;
  line: number;
  preview: string;
};

const HAN_RE = /[\u4e00-\u9fff]/g;

const REPO_ROOT = process.cwd();

const ALLOWLIST_REL = new Set<string>([
  // The only allowed Chinese text file.
  path.normalize("messages/zh.json"),
]);

const SKIP_DIRS = new Set([
  ".git",
  ".next",
  ".history",
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  // Local persisted data (gitignored); may contain binary blobs / user content.
  "projects",
  // User-facing template content may legitimately contain CJK text.
  "templates",
]);

// Skip local environment files (should not be committed).
// Note: these files are commonly excluded by .gitignore and may exist only locally.
function shouldSkipFileByName(relPath: string): boolean {
  const base = path.basename(relPath);
  return base === ".env" || base.startsWith(".env.");
}

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".txt",
  ".yml",
  ".yaml",
  ".css",
  ".scss",
  ".html",
  ".svg",
  ".sql",
  ".sh",
  ".py",
  ".toml",
  ".env",
  ".dockerfile",
]);

function isProbablyTextFile(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  const ext = path.extname(base);
  if (TEXT_EXTENSIONS.has(ext)) return true;
  // No extension: allow (e.g. Dockerfile, .gitignore-like, scripts without ext)
  if (!ext) return true;
  // Special cases: Dockerfile and Dockerfile.* variants
  if (base === "dockerfile" || base.startsWith("dockerfile.")) return true;
  return false;
}

async function walk(dir: string, out: string[]) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const rel = path.relative(REPO_ROOT, full);

    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      await walk(full, out);
      continue;
    }
    if (!e.isFile()) continue;
    out.push(rel);
  }
}

function shorten(s: string, maxLen: number) {
  const trimmed = s.replace(/\s+/g, " ").trim();
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen - 1) + "…" : trimmed;
}

async function scanFile(relPath: string): Promise<Finding[]> {
  const normalized = path.normalize(relPath);
  if (ALLOWLIST_REL.has(normalized)) return [];
  if (shouldSkipFileByName(relPath)) return [];
  if (!isProbablyTextFile(relPath)) return [];

  const absPath = path.join(REPO_ROOT, relPath);
  let content: string;
  try {
    content = await fs.readFile(absPath, "utf8");
  } catch {
    return [];
  }

  if (!HAN_RE.test(content)) return [];

  const findings: Finding[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (HAN_RE.test(lines[i])) {
      findings.push({
        file: relPath,
        line: i + 1,
        preview: shorten(lines[i], 140),
      });
      if (findings.length >= 10) break;
    }
  }
  return findings;
}

async function main() {
  const files: string[] = [];
  await walk(REPO_ROOT, files);

  const allFindings: Finding[] = [];
  for (const rel of files) {
    const findings = await scanFile(rel);
    allFindings.push(...findings);
    if (allFindings.length >= 50) break;
  }

  if (allFindings.length === 0) {
    console.log("✅ No Chinese characters found (outside allowlist).");
    return;
  }

  console.error(`❌ Found Chinese characters in ${allFindings.length} location(s).`);
  for (const f of allFindings) {
    console.error(`- ${f.file}:${f.line}  ${f.preview}`);
  }
  console.error("\nAllowed files:");
  for (const a of Array.from(ALLOWLIST_REL)) {
    console.error(`- ${a}`);
  }
  process.exit(1);
}

main().catch((err) => {
  console.error("❌ Scan failed:", err);
  process.exit(1);
});
