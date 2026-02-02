import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { v4 as uuidv4 } from "uuid";
import * as tar from "tar";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStorage, StoragePaths, getMimeType } from "@/lib/storage";
import { apiError, AUTH_ERRORS, IMPORT_ERRORS } from "@/lib/api-errors";

/**
 * POST /api/projects/import/arxiv - Import arXiv source files.
 *
 * Supported input formats:
 * - arXiv ID: 2301.07041, 2301.07041v1
 * - arXiv URL: https://arxiv.org/abs/2301.07041
 * - arXiv PDF URL: https://arxiv.org/pdf/2301.07041.pdf
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    const body = await request.json();
    const { arxivId: rawArxivId, name, description } = body;

    if (!rawArxivId) {
      return apiError(IMPORT_ERRORS.ENTER_ARXIV_ID, 400);
    }

    // Parse arXiv ID
    const arxivId = parseArxivId(rawArxivId);
    if (!arxivId) {
      return apiError(IMPORT_ERRORS.INVALID_ARXIV_ID, 400);
    }

    // Fetch paper metadata (title, etc.)
    let paperTitle = "";
    try {
      const metaResponse = await fetch(`https://export.arxiv.org/api/query?id_list=${arxivId}`);
      if (metaResponse.ok) {
        const xml = await metaResponse.text();
        // In arXiv API XML, the first <title> is the feed title "ArXiv Query: ..."
        // The paper title is in the <entry> <title> tag.
        // Use a more precise match: find the first <title> after <entry>.
        const entryMatch = xml.match(/<entry>[\s\S]*?<title>([^<]+)<\/title>/);
        if (entryMatch && entryMatch[1]) {
          paperTitle = entryMatch[1].trim().replace(/\s+/g, " ");
        }
      }
    } catch (e) {
      // Ignore metadata fetch failures
      console.warn("Failed to fetch arXiv metadata:", e);
    }

    // Download source
    // arXiv source download URL: https://arxiv.org/e-print/{id}
    // Usually returns tar.gz or gz format.
    const downloadUrl = `https://arxiv.org/e-print/${arxivId}`;

    const response = await fetch(downloadUrl, {
      headers: {
        "User-Agent": "Litewrite/1.0 (LaTeX Editor; +https://litewrite.io)",
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return apiError(IMPORT_ERRORS.NO_SOURCE_CODE, 404);
      }
      return apiError(IMPORT_ERRORS.ARXIV_FAILED, response.status);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // arXiv source can come in multiple formats:
    // 1. tar.gz (most common)
    // 2. gzip single file
    // 3. plain .tex file

    // Create project
    const projectId = uuidv4();
    const tempDir = path.join(os.tmpdir(), `arxiv-${projectId}`);
    const storage = await getStorage();

    await fs.mkdir(tempDir, { recursive: true });

    let extractedFiles: string[] = [];
    let mainFile = "main.tex";

    try {
      // Try extracting as tar.gz
      const tempFile = path.join(tempDir, "archive.tar.gz");
      await fs.writeFile(tempFile, buffer);

      try {
        await tar.extract({
          file: tempFile,
          cwd: tempDir,
        });

        // Delete temp archive file
        await fs.unlink(tempFile);

        // Get extracted files
        const entries = await getAllFiles(tempDir);

        if (entries.length === 0) {
          throw new Error("No files extracted");
        }

        // Upload files to storage
        let hasMainTex = false;

        for (const fullPath of entries) {
          const relativePath = path.relative(tempDir, fullPath);

          // Skip hidden/unsafe files
          if (relativePath.startsWith(".") || relativePath.includes("/.") || relativePath.includes("..")) {
            continue;
          }

          const content = await fs.readFile(fullPath);
          const storageKey = StoragePaths.projectFile(projectId, relativePath);
          await storage.upload(storageKey, content, getMimeType(relativePath));
          extractedFiles.push(relativePath);

          if (relativePath === "main.tex") {
            hasMainTex = true;
            mainFile = "main.tex";
          }
        }

        // If main.tex doesn't exist, pick the first top-level .tex file
        if (!hasMainTex) {
          const texFile = extractedFiles.find(f => f.endsWith(".tex") && !f.includes("/") && !f.includes("\\"));
          if (texFile) {
            mainFile = texFile;
          }
        }
      } catch (tarError) {
        // If it's not tar.gz, it might be a single gzip file or plain text
        console.warn("Not a tar.gz file, trying as single file:", tarError);

        // Try gunzip
        const zlib = await import("zlib");
        const { promisify } = await import("util");
        const gunzip = promisify(zlib.gunzip);

        try {
          const decompressed = await gunzip(buffer);
          // Assume it's a single .tex file
          mainFile = "main.tex";
          const storageKey = StoragePaths.projectFile(projectId, mainFile);
          await storage.upload(storageKey, decompressed, "text/x-latex");
          extractedFiles = [mainFile];
        } catch {
          // If it's not gzip either, treat it as plain .tex text
          mainFile = "main.tex";
          const storageKey = StoragePaths.projectFile(projectId, mainFile);
          await storage.upload(storageKey, buffer, "text/x-latex");
          extractedFiles = [mainFile];
        }
      }

      // Clean up temp dir
      await fs.rm(tempDir, { recursive: true, force: true });

      if (extractedFiles.length === 0) {
        await storage.deletePrefix(StoragePaths.projectPrefix(projectId));
        return apiError(IMPORT_ERRORS.EMPTY_SOURCE_FILES, 400);
      }

      // Project name
      const projectName = name?.trim() || paperTitle || `arXiv-${arxivId}`;
      const projectDescription = description?.trim() || `Imported from arXiv: ${arxivId}${paperTitle ? ` - ${paperTitle}` : ""}`;

      // Ensure user exists in DB (avoid inconsistencies after token expiry or DB resets)
      const userInDb = await prisma.user.findUnique({ where: { id: session.user.id } });
      if (!userInDb) {
        await storage.deletePrefix(StoragePaths.projectPrefix(projectId));
        return apiError(AUTH_ERRORS.SESSION_EXPIRED, 401);
      }

      // Create DB record
      const project = await prisma.project.create({
        data: {
          id: projectId,
          name: projectName,
          description: projectDescription || null,
          mainFile,
          ownerId: session.user.id,
          visibility: "private",
          status: "active",
        },
      });

      // Create project.json
      const meta = {
        id: projectId,
        name: projectName,
        description: projectDescription || undefined,
        mainFile,
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
        template: "arxiv-import",
        arxivId,
        arxivUrl: `https://arxiv.org/abs/${arxivId}`,
      };
      const metaKey = StoragePaths.projectFile(projectId, "project.json");
      await storage.upload(metaKey, JSON.stringify(meta, null, 2), "application/json");

      return NextResponse.json({
        success: true,
        project: {
          id: project.id,
          name: project.name,
          description: project.description,
          mainFile: project.mainFile,
          visibility: project.visibility,
          createdAt: project.createdAt.toISOString(),
          updatedAt: project.updatedAt.toISOString(),
        },
        arxivId,
        paperTitle: paperTitle || undefined,
        filesCount: extractedFiles.length,
      });
    } catch (error) {
      // Cleanup
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      try {
        await storage.deletePrefix(StoragePaths.projectPrefix(projectId));
      } catch {}
      throw error;
    }
  } catch (error) {
    console.error("Error importing from arXiv:", error);
    return apiError(IMPORT_ERRORS.ARXIV_FAILED, 500);
  }
}

/**
 * Parse arXiv ID.
 * Supported formats:
 * - 2301.07041
 * - 2301.07041v1
 * - https://arxiv.org/abs/2301.07041
 * - https://arxiv.org/pdf/2301.07041.pdf
 */
function parseArxivId(input: string): string | null {
  input = input.trim();

  // Direct id format: YYMM.NNNNN or YYMM.NNNNNvN
  const idPattern = /^(\d{4}\.\d{4,5})(v\d+)?$/;
  const idMatch = input.match(idPattern);
  if (idMatch) {
    return idMatch[1]; // Return id without version suffix
  }

  // Legacy format: category/YYMMNNN
  const oldIdPattern = /^([a-z-]+\/\d{7})(v\d+)?$/i;
  const oldIdMatch = input.match(oldIdPattern);
  if (oldIdMatch) {
    return oldIdMatch[1];
  }

  // URL format
  try {
    const url = new URL(input);
    if (url.hostname.includes("arxiv.org")) {
      const pathParts = url.pathname.split("/").filter(Boolean);

      // /abs/2301.07041 or /pdf/2301.07041.pdf
      if (pathParts.length >= 2) {
        let id = pathParts[pathParts.length - 1];
        // Strip .pdf suffix
        id = id.replace(/\.pdf$/i, "");
        // Strip version suffix
        id = id.replace(/v\d+$/, "");

        // Validate format
        if (/^\d{4}\.\d{4,5}$/.test(id) || /^[a-z-]+\/\d{7}$/i.test(id)) {
          return id;
        }
      }
    }
  } catch {
    // Not a valid URL
  }

  return null;
}

/**
 * Recursively list all files under a directory.
 */
async function getAllFiles(dir: string): Promise<string[]> {
  const results: string[] = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const subFiles = await getAllFiles(fullPath);
        results.push(...subFiles);
      } else {
        results.push(fullPath);
      }
    }
  } catch (e) {
    console.warn("Error reading directory:", dir, e);
  }

  return results;
}
