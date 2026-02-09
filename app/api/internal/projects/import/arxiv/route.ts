/**
 * Internal API: Import from arXiv
 * ================================
 *
 * Internal endpoint for nanobot to import a project from arXiv.
 * Replicates the logic of the public /api/projects/import/arxiv endpoint
 * but uses INTERNAL_API_SECRET + ownerId instead of user session auth.
 *
 * Protected by INTERNAL_API_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { v4 as uuidv4 } from "uuid";
import * as tar from "tar";
import { prisma } from "@/lib/prisma";
import { getStorage, StoragePaths, getMimeType } from "@/lib/storage";

function verifyInternalAuth(request: NextRequest): boolean {
  const secret = request.headers.get("X-Internal-Secret");
  const expectedSecret = process.env.INTERNAL_API_SECRET;
  if (!expectedSecret) {
    console.warn("[Internal API] INTERNAL_API_SECRET not configured");
    return false;
  }
  return secret === expectedSecret;
}

export async function POST(request: NextRequest) {
  if (!verifyInternalAuth(request)) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const { arxivId: rawArxivId, ownerId, name, description } = body as {
      arxivId: string;
      ownerId: string;
      name?: string;
      description?: string;
    };

    if (!rawArxivId) {
      return NextResponse.json(
        { success: false, error: "arxivId is required" },
        { status: 400 }
      );
    }

    if (!ownerId) {
      return NextResponse.json(
        { success: false, error: "ownerId is required" },
        { status: 400 }
      );
    }

    // Parse arXiv ID
    const arxivId = parseArxivId(rawArxivId);
    if (!arxivId) {
      return NextResponse.json(
        { success: false, error: "Invalid arXiv ID or URL" },
        { status: 400 }
      );
    }

    // Fetch paper metadata (title, etc.)
    let paperTitle = "";
    try {
      const metaResponse = await fetch(
        `https://export.arxiv.org/api/query?id_list=${arxivId}`
      );
      if (metaResponse.ok) {
        const xml = await metaResponse.text();
        const entryMatch = xml.match(
          /<entry>[\s\S]*?<title>([^<]+)<\/title>/
        );
        if (entryMatch && entryMatch[1]) {
          paperTitle = entryMatch[1].trim().replace(/\s+/g, " ");
        }
      }
    } catch (e) {
      console.warn("[Internal/ImportArxiv] Failed to fetch arXiv metadata:", e);
    }

    // Download source
    const downloadUrl = `https://arxiv.org/e-print/${arxivId}`;
    const response = await fetch(downloadUrl, {
      headers: {
        "User-Agent": "Litewrite/1.0 (LaTeX Editor; +https://litewrite.io)",
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          success: false,
          error:
            response.status === 404
              ? "No source code found on arXiv for this paper"
              : `arXiv download failed with status ${response.status}`,
        },
        { status: response.status === 404 ? 404 : 500 }
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

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
        await tar.extract({ file: tempFile, cwd: tempDir });
        await fs.unlink(tempFile);

        const entries = await getAllFiles(tempDir);
        if (entries.length === 0) {
          throw new Error("No files extracted");
        }

        let hasMainTex = false;
        for (const fullPath of entries) {
          const relativePath = path.relative(tempDir, fullPath);
          if (
            relativePath.startsWith(".") ||
            relativePath.includes("/.") ||
            relativePath.includes("..")
          ) {
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

        if (!hasMainTex) {
          const texFile = extractedFiles.find(
            (f) => f.endsWith(".tex") && !f.includes("/") && !f.includes("\\")
          );
          if (texFile) mainFile = texFile;
        }
      } catch (tarError) {
        console.warn(
          "[Internal/ImportArxiv] Not a tar.gz, trying single file:",
          tarError
        );

        const zlib = await import("zlib");
        const { promisify } = await import("util");
        const gunzip = promisify(zlib.gunzip);

        try {
          const decompressed = await gunzip(buffer);
          mainFile = "main.tex";
          const storageKey = StoragePaths.projectFile(projectId, mainFile);
          await storage.upload(storageKey, decompressed, "text/x-latex");
          extractedFiles = [mainFile];
        } catch {
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
        return NextResponse.json(
          { success: false, error: "No source files found in arXiv download" },
          { status: 400 }
        );
      }

      // Project name
      const projectName =
        name?.trim() || paperTitle || `arXiv-${arxivId}`;
      const projectDescription =
        description?.trim() ||
        `Imported from arXiv: ${arxivId}${paperTitle ? ` - ${paperTitle}` : ""}`;

      // Create DB record
      const project = await prisma.project.create({
        data: {
          id: projectId,
          name: projectName,
          description: projectDescription || null,
          mainFile,
          ownerId,
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
      await storage.upload(
        metaKey,
        JSON.stringify(meta, null, 2),
        "application/json"
      );

      console.log(
        `[Internal/ImportArxiv] Imported arXiv ${arxivId} as project "${projectName}" (${projectId}) for owner ${ownerId}`
      );

      return NextResponse.json({
        success: true,
        data: {
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
        },
      });
    } catch (error) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
      try {
        await storage.deletePrefix(StoragePaths.projectPrefix(projectId));
      } catch {}
      throw error;
    }
  } catch (error) {
    console.error("[Internal/ImportArxiv] Error:", error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

/**
 * Parse arXiv ID from various input formats.
 */
function parseArxivId(input: string): string | null {
  input = input.trim();

  // Direct id format: YYMM.NNNNN or YYMM.NNNNNvN
  const idPattern = /^(\d{4}\.\d{4,5})(v\d+)?$/;
  const idMatch = input.match(idPattern);
  if (idMatch) return idMatch[1];

  // Legacy format: category/YYMMNNN
  const oldIdPattern = /^([a-z-]+\/\d{7})(v\d+)?$/i;
  const oldIdMatch = input.match(oldIdPattern);
  if (oldIdMatch) return oldIdMatch[1];

  // URL format
  try {
    const url = new URL(input);
    if (url.hostname.includes("arxiv.org")) {
      const pathParts = url.pathname.split("/").filter(Boolean);
      if (pathParts.length >= 2) {
        let id = pathParts[pathParts.length - 1];
        id = id.replace(/\.pdf$/i, "");
        id = id.replace(/v\d+$/, "");
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
    console.warn("[Internal/ImportArxiv] Error reading directory:", dir, e);
  }
  return results;
}
