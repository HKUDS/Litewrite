import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStorage, StoragePaths } from "@/lib/storage";
import { AUTH_ERRORS, PROJECT_ERRORS, COMPILE_ERRORS, apiError } from "@/lib/api-errors";

const COMPILE_SERVER_URL = process.env.COMPILE_SERVER_URL || "http://localhost:3002";

/**
 * Compute similarity between two strings (via longest common subsequence heuristics).
 */
function calculateSimilarity(str1: string, str2: string): number {
  if (!str1 || !str2) return 0;

  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();

  // Simple substring match score
  let score = 0;

  // Check full match
  if (s2.includes(s1)) {
    score += s1.length * 2;
  }

  // Check partial matches (sliding window)
  const minLen = Math.min(s1.length, s2.length);
  for (let len = minLen; len >= 3; len--) {
    for (let i = 0; i <= s1.length - len; i++) {
      const substr = s1.substring(i, i + len);
      if (s2.includes(substr)) {
        score += len;
        break;
      }
    }
  }

  return score;
}

/**
 * Pick the best SyncTeX result using context matching.
 */
async function findBestMatchByContext(
  matches: Array<{ file: string; line: number; column?: number }>,
  projectId: string,
  clickedWord?: string,
  contextBefore?: string,
  contextAfter?: string
): Promise<{ file: string; line: number; column?: number; score: number } | null> {
  if (!clickedWord && !contextBefore && !contextAfter) {
    return null; // No context available to disambiguate
  }

  const storage = await getStorage();
  const filesPrefix = StoragePaths.projectPrefix(projectId);

  let bestMatch: { file: string; line: number; column?: number; score: number } | null = null;

  // Lazy-load: only list project files when fallback is needed (basename can't be downloaded directly)
  let cachedProjectKeys: string[] | null = null;
  const normalizeRelPath = (p: string) =>
    p
      .replace(/\\/g, "/")
      .replace(/^(\.\/)+/, "")
      .replace(/^(\.\.\/)+/, "")
      .replace(/^\/+/, "");
  const listProjectKeys = async (): Promise<string[]> => {
    if (cachedProjectKeys) return cachedProjectKeys;
    const all = await storage.list(filesPrefix);
    cachedProjectKeys = all.map(f => f.key);
    return cachedProjectKeys;
  };

  for (const match of matches) {
    // compile-server may return a relative path with subdirectories (preferred),
    // or only a basename (legacy behavior).
    const normalized = normalizeRelPath(match.file);
    const isBasenameOnly = !normalized.includes("/");

    // First try reading by the returned path
    const candidates: string[] = [normalized];
    let expandedCandidates = false;

    for (const relPath of candidates) {
      try {
        // Read source file
        const fileKey = `${filesPrefix}${relPath}`;
        const fileBuffer = await storage.download(fileKey);
        const fileContent = fileBuffer.toString("utf-8");
        const lines = fileContent.split("\n");

        // Get the matched line content (line numbers are 1-based)
        const lineIndex = match.line - 1;
        if (lineIndex < 0 || lineIndex >= lines.length) continue;

        const lineContent = lines[lineIndex];

        // Compute match score
        let score = 0;

        // 1) Check whether the clicked word appears on this line
        if (clickedWord && lineContent.includes(clickedWord)) {
          score += 100; // Word match matters most
        }

        // 2) Check context similarity
        if (contextBefore) {
          score += calculateSimilarity(contextBefore, lineContent);
        }
        if (contextAfter) {
          score += calculateSimilarity(contextAfter, lineContent);
        }

        // 3) Check whether the full context (before + word + after) appears in the line
        const fullContext = (contextBefore || "") + (clickedWord || "") + (contextAfter || "");
        if (fullContext && lineContent.includes(fullContext)) {
          score += 200; // Full-context match gets the largest bonus
        }

        console.log(
          `[SyncTeX Context] ${relPath}:${match.line} - score: ${score}, line: "${lineContent.substring(0, 50)}..."`
        );

        if (!bestMatch || score > bestMatch.score) {
          // NOTE: return a project-relative path (including subdirectories) to the caller
          bestMatch = { file: relPath, line: match.line, column: match.column, score };
        }
      } catch (error) {
        // Read failed; try the next candidate
        console.warn(`[SyncTeX Context] Failed to read ${relPath}:`, error);

        // If it's a basename and the first read fails, fall back to searching the project for files
        // with the same name (supports subdirectories). This keeps compatibility with legacy
        // compile-server behavior and cases where SyncTeX returns a truncated absolute path.
        if (!expandedCandidates && isBasenameOnly && relPath === normalized) {
          expandedCandidates = true;
          const keys = await listProjectKeys();
          const suffix = `/${normalized}`;
          const matchedRelPaths = keys
            .filter(k => k.endsWith(suffix))
            .map(k => k.startsWith(filesPrefix) ? k.slice(filesPrefix.length) : k);

          for (const p of matchedRelPaths) {
            const np = normalizeRelPath(p);
            if (np && !candidates.includes(np)) candidates.push(np);
          }
        }
      }
    }
  }

  return bestMatch;
}

/**
 * POST /api/projects/[id]/synctex - SyncTeX bidirectional sync
 *
 * Body: {
 *   direction: "forward" | "backward",  // Sync direction
 *   // Backward sync (PDF → source)
 *   page?: number,    // PDF page number (1-based)
 *   x?: number,       // x coordinate in PDF (pt)
 *   y?: number,       // y coordinate in PDF (pt)
 *   clickedWord?: string,    // Word the user clicked
 *   contextBefore?: string,  // Context before the word
 *   contextAfter?: string,   // Context after the word
 *   // Forward sync (source → PDF)
 *   file?: string,    // Source file name
 *   line?: number,    // Line number
 *   column?: number,  // Column number (optional)
 * }
 *
 * Response (backward): {
 *   success: boolean,
 *   file?: string,
 *   line?: number,
 *   column?: number,
 * }
 *
 * Response (forward): {
 *   success: boolean,
 *   page?: number,
 *   x?: number,
 *   y?: number,
 * }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    const { id: projectId } = await params;

    // Verify the user can access the project
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        OR: [
          { ownerId: session.user.id },
          { collaborators: { some: { userId: session.user.id } } },
        ],
      },
    });

    if (!project) {
      return apiError(PROJECT_ERRORS.NOT_FOUND, 404);
    }

    const body = await request.json();
    const { direction = "backward" } = body;

    // Find the latest .synctex.gz file
    const storage = await getStorage();
    const compiledPrefix = StoragePaths.compiledPrefix(projectId);

    const compiledFiles = await storage.list(compiledPrefix);

    if (compiledFiles.length === 0) {
      return NextResponse.json({
        success: false,
        errorCode: COMPILE_ERRORS.FILE_NOT_FOUND,
      });
    }

    const synctexFiles = compiledFiles
      .filter(f => f.key.endsWith(".synctex.gz"))
      .sort((a, b) => a.key.localeCompare(b.key));

    const synctexFileInfo = synctexFiles[synctexFiles.length - 1];

    if (!synctexFileInfo) {
      return NextResponse.json({
        success: false,
        errorCode: COMPILE_ERRORS.SYNCTEX_NOT_FOUND,
      });
    }

    // Download synctex.gz and the corresponding PDF
    const synctexFilename = synctexFileInfo.key.split("/").pop() || "";
    const pdfFilename = synctexFilename.replace(".synctex.gz", ".pdf");
    const pdfKey = StoragePaths.compiledFile(projectId, pdfFilename);

    const synctexBuffer = await storage.download(synctexFileInfo.key);
    const pdfBuffer = await storage.download(pdfKey);

    // Call compile server SyncTeX API
    const compileResponse = await fetch(`${COMPILE_SERVER_URL}/synctex`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        synctexBase64: synctexBuffer.toString("base64"),
        pdfBase64: pdfBuffer.toString("base64"),
        direction,
        ...body,
      }),
    });

    if (!compileResponse.ok) {
      const errorText = await compileResponse.text();
      console.error("[SyncTeX] Compile server error:", errorText);
      return NextResponse.json({
        success: false,
        errorCode: COMPILE_ERRORS.SYNCTEX_FAILED,
      });
    }

    const result = await compileResponse.json();

    // If backward sync yields multiple matches, use context matching to pick the best one
    if (
      direction === "backward" &&
      result.success &&
      result.allMatches &&
      result.allMatches.length > 1
    ) {
      const { clickedWord, contextBefore, contextAfter } = body;

      console.log(`[SyncTeX] Multiple matches (${result.allMatches.length}), using context matching...`);
      console.log(`[SyncTeX] Context: "${contextBefore || ""}" [${clickedWord || ""}] "${contextAfter || ""}"`);

      const bestMatch = await findBestMatchByContext(
        result.allMatches,
        projectId,
        clickedWord,
        contextBefore,
        contextAfter
      );

      if (bestMatch && bestMatch.score > 0) {
        console.log(`[SyncTeX] Best match by context: ${bestMatch.file}:${bestMatch.line} (score: ${bestMatch.score})`);
        return NextResponse.json({
          success: true,
          file: bestMatch.file,
          line: bestMatch.line,
          column: bestMatch.column,
          matchCount: result.allMatches.length,
          matchedByContext: true,
        });
      } else {
        console.log(`[SyncTeX] No context match found, using default: ${result.file}:${result.line}`);
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("[SyncTeX] Error:", error);
    return NextResponse.json(
      {
        success: false,
        errorCode: COMPILE_ERRORS.SYNCTEX_FAILED,
      },
      { status: 500 }
    );
  }
}
