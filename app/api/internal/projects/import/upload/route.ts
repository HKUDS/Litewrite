/**
 * Internal API: Import from file upload (base64)
 * ================================================
 *
 * Internal endpoint for nanobot to upload a file and create a new project.
 * Unlike the public /api/projects/upload which uses multipart/form-data,
 * this endpoint accepts base64-encoded file content in JSON body.
 *
 * Supports: .zip, .tar.gz, .tgz, .tar, .tex, .bib, .cls, .sty
 *
 * Protected by INTERNAL_API_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { v4 as uuidv4 } from "uuid";
import AdmZip from "adm-zip";
import * as tar from "tar";
import { prisma } from "@/lib/prisma";
import { getStorage, StoragePaths, getMimeType } from "@/lib/storage";

const SUPPORTED_ARCHIVE_TYPES = [".zip", ".tar.gz", ".tgz", ".tar"];
const SUPPORTED_TEX_TYPES = [".tex", ".bib", ".cls", ".sty"];

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
    const { fileBase64, fileName, ownerId, name, description } = body as {
      fileBase64: string;
      fileName: string;
      ownerId: string;
      name?: string;
      description?: string;
    };

    if (!fileBase64) {
      return NextResponse.json(
        { success: false, error: "fileBase64 is required" },
        { status: 400 }
      );
    }

    if (!fileName) {
      return NextResponse.json(
        { success: false, error: "fileName is required" },
        { status: 400 }
      );
    }

    if (!ownerId) {
      return NextResponse.json(
        { success: false, error: "ownerId is required" },
        { status: 400 }
      );
    }

    const fileNameLower = fileName.toLowerCase();
    const buffer = Buffer.from(fileBase64, "base64");

    // Dispatch based on file type
    if (fileNameLower.endsWith(".zip")) {
      return handleZipUpload(buffer, fileName, name, description, ownerId);
    } else if (
      fileNameLower.endsWith(".tar.gz") ||
      fileNameLower.endsWith(".tgz")
    ) {
      return handleTarGzUpload(buffer, fileName, name, description, ownerId);
    } else if (fileNameLower.endsWith(".tar")) {
      return handleTarUpload(buffer, fileName, name, description, ownerId);
    } else if (SUPPORTED_TEX_TYPES.some((ext) => fileNameLower.endsWith(ext))) {
      return handleSingleTexUpload(
        buffer,
        fileName,
        name,
        description,
        ownerId
      );
    } else {
      return NextResponse.json(
        {
          success: false,
          error: `Unsupported file format. Supported: ${[...SUPPORTED_ARCHIVE_TYPES, ...SUPPORTED_TEX_TYPES].join(", ")}`,
        },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error("[Internal/ImportUpload] Error:", error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

/**
 * Handle ZIP file upload.
 */
async function handleZipUpload(
  buffer: Buffer,
  fileName: string,
  name: string | undefined,
  description: string | undefined,
  ownerId: string
) {
  const projectName = name?.trim() || fileName.replace(/\.zip$/i, "");

  const zip = new AdmZip(buffer);
  const zipEntries = zip.getEntries();

  if (zipEntries.length === 0) {
    return NextResponse.json(
      { success: false, error: "ZIP file is empty" },
      { status: 400 }
    );
  }

  const topLevelPrefix = detectTopLevelDirectory(zipEntries);
  const projectId = uuidv4();
  const storage = await getStorage();

  let mainFile = "main.tex";
  let hasMainTex = false;
  const extractedFiles: string[] = [];

  for (const entry of zipEntries) {
    if (entry.isDirectory || entry.entryName.startsWith("__MACOSX")) {
      continue;
    }

    let relativePath = entry.entryName;
    if (topLevelPrefix && relativePath.startsWith(topLevelPrefix)) {
      relativePath = relativePath.substring(topLevelPrefix.length);
    }

    if (!relativePath || relativePath === "" || relativePath.includes("..")) {
      continue;
    }

    const content = entry.getData();
    const storageKey = StoragePaths.projectFile(projectId, relativePath);
    await storage.upload(storageKey, content, getMimeType(relativePath));
    extractedFiles.push(relativePath);

    if (
      relativePath === "main.tex" ||
      relativePath.endsWith("/main.tex")
    ) {
      hasMainTex = true;
      if (relativePath === "main.tex") mainFile = "main.tex";
    }
  }

  if (!hasMainTex) {
    const texFile = extractedFiles.find(
      (f) => f.endsWith(".tex") && !f.includes("/")
    );
    if (texFile) mainFile = texFile;
  }

  return createProject(
    projectId,
    projectName,
    description,
    mainFile,
    ownerId,
    extractedFiles
  );
}

/**
 * Handle tar.gz file upload.
 */
async function handleTarGzUpload(
  buffer: Buffer,
  fileName: string,
  name: string | undefined,
  description: string | undefined,
  ownerId: string
) {
  const projectName =
    name?.trim() || fileName.replace(/\.(tar\.gz|tgz)$/i, "");
  const projectId = uuidv4();
  const tempDir = path.join(os.tmpdir(), `upload-${projectId}`);
  const storage = await getStorage();

  await fs.mkdir(tempDir, { recursive: true });

  try {
    const tempFile = path.join(tempDir, "archive.tar.gz");
    await fs.writeFile(tempFile, buffer);
    await tar.extract({ file: tempFile, cwd: tempDir });
    await fs.unlink(tempFile);

    const entries = await getAllFiles(tempDir);
    const topLevelPrefix = detectTopLevelFromPaths(entries, tempDir);

    const extractedFiles: string[] = [];
    let mainFile = "main.tex";
    let hasMainTex = false;

    for (const fullPath of entries) {
      let relativePath = path.relative(tempDir, fullPath);
      if (topLevelPrefix && relativePath.startsWith(topLevelPrefix)) {
        relativePath = relativePath.substring(topLevelPrefix.length);
      }
      if (!relativePath || relativePath.includes("..")) continue;

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
        (f) =>
          f.endsWith(".tex") && !f.includes("/") && !f.includes("\\")
      );
      if (texFile) mainFile = texFile;
    }

    await fs.rm(tempDir, { recursive: true, force: true });

    return createProject(
      projectId,
      projectName,
      description,
      mainFile,
      ownerId,
      extractedFiles
    );
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    try {
      await storage.deletePrefix(StoragePaths.projectPrefix(projectId));
    } catch {}
    throw error;
  }
}

/**
 * Handle tar file upload (uncompressed).
 */
async function handleTarUpload(
  buffer: Buffer,
  fileName: string,
  name: string | undefined,
  description: string | undefined,
  ownerId: string
) {
  const projectName = name?.trim() || fileName.replace(/\.tar$/i, "");
  const projectId = uuidv4();
  const tempDir = path.join(os.tmpdir(), `upload-${projectId}`);
  const storage = await getStorage();

  await fs.mkdir(tempDir, { recursive: true });

  try {
    const tempFile = path.join(tempDir, "archive.tar");
    await fs.writeFile(tempFile, buffer);
    await tar.extract({ file: tempFile, cwd: tempDir });
    await fs.unlink(tempFile);

    const entries = await getAllFiles(tempDir);
    const topLevelPrefix = detectTopLevelFromPaths(entries, tempDir);

    const extractedFiles: string[] = [];
    let mainFile = "main.tex";
    let hasMainTex = false;

    for (const fullPath of entries) {
      let relativePath = path.relative(tempDir, fullPath);
      if (topLevelPrefix && relativePath.startsWith(topLevelPrefix)) {
        relativePath = relativePath.substring(topLevelPrefix.length);
      }
      if (!relativePath || relativePath.includes("..")) continue;

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
        (f) =>
          f.endsWith(".tex") && !f.includes("/") && !f.includes("\\")
      );
      if (texFile) mainFile = texFile;
    }

    await fs.rm(tempDir, { recursive: true, force: true });

    return createProject(
      projectId,
      projectName,
      description,
      mainFile,
      ownerId,
      extractedFiles
    );
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    try {
      await storage.deletePrefix(StoragePaths.projectPrefix(projectId));
    } catch {}
    throw error;
  }
}

/**
 * Handle a single .tex file upload.
 */
async function handleSingleTexUpload(
  buffer: Buffer,
  fileName: string,
  name: string | undefined,
  description: string | undefined,
  ownerId: string
) {
  const projectName = name?.trim() || fileName.replace(/\.[^.]+$/, "");
  const projectId = uuidv4();
  const storage = await getStorage();

  const mainFile = fileName.endsWith(".tex") ? fileName : "main.tex";
  const storageKey = StoragePaths.projectFile(projectId, fileName);
  await storage.upload(storageKey, buffer, getMimeType(fileName));

  const extractedFiles = [fileName];

  if (!fileName.endsWith(".tex")) {
    const basicMainTex = `\\documentclass{article}
\\usepackage[utf8]{inputenc}

\\title{${projectName}}
\\author{}
\\date{\\today}

\\begin{document}

\\maketitle

% Your content here

\\end{document}
`;
    const mainKey = StoragePaths.projectFile(projectId, "main.tex");
    await storage.upload(mainKey, basicMainTex, "text/x-latex");
    extractedFiles.push("main.tex");
  }

  return createProject(
    projectId,
    projectName,
    description,
    mainFile,
    ownerId,
    extractedFiles
  );
}

/**
 * Create a project record in the DB and project.json in storage.
 */
async function createProject(
  projectId: string,
  projectName: string,
  description: string | undefined,
  mainFile: string,
  ownerId: string,
  extractedFiles: string[]
) {
  const project = await prisma.project.create({
    data: {
      id: projectId,
      name: projectName.trim(),
      description: description?.trim() || null,
      mainFile,
      ownerId,
      visibility: "private",
      status: "active",
    },
  });

  const storage = await getStorage();
  const meta = {
    id: projectId,
    name: projectName.trim(),
    description: description?.trim() || undefined,
    mainFile,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    template: "uploaded",
  };
  const metaKey = StoragePaths.projectFile(projectId, "project.json");
  await storage.upload(
    metaKey,
    JSON.stringify(meta, null, 2),
    "application/json"
  );

  console.log(
    `[Internal/ImportUpload] Created project "${projectName.trim()}" (${projectId}) for owner ${ownerId}, ${extractedFiles.length} files`
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
      filesCount: extractedFiles.length,
    },
  });
}

/**
 * Detect top-level directory in ZIP entries.
 */
function detectTopLevelDirectory(entries: AdmZip.IZipEntry[]): string {
  const paths = entries
    .map((e) => e.entryName)
    .filter((p) => p && !p.startsWith("__MACOSX"));

  if (paths.length === 0) return "";

  const firstPath = paths[0];
  const firstSlash = firstPath.indexOf("/");
  if (firstSlash === -1) return "";

  const topDir = firstPath.substring(0, firstSlash + 1);
  const allInSameDir = paths.every(
    (p) => p.startsWith(topDir) || p === topDir.slice(0, -1)
  );

  return allInSameDir ? topDir : "";
}

/**
 * Detect the top-level directory from extracted file paths.
 */
function detectTopLevelFromPaths(files: string[], baseDir: string): string {
  const relativePaths = files.map((f) => path.relative(baseDir, f));
  if (relativePaths.length === 0) return "";

  const firstPath = relativePaths[0];
  const sep = path.sep;
  const firstSepIndex = firstPath.indexOf(sep);
  if (firstSepIndex === -1) return "";

  const topDir = firstPath.substring(0, firstSepIndex + 1);
  const allInSameDir = relativePaths.every((p) => p.startsWith(topDir));

  return allInSameDir ? topDir : "";
}

/**
 * Recursively list all files under a directory.
 */
async function getAllFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
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

  return results;
}
