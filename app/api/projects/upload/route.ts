import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { v4 as uuidv4 } from "uuid";
import AdmZip from "adm-zip";
import * as tar from "tar";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStorage, StoragePaths, getMimeType } from "@/lib/storage";
import { apiError, AUTH_ERRORS, FILE_ERRORS, IMPORT_ERRORS } from "@/lib/api-errors";

// Supported file types
const SUPPORTED_ARCHIVE_TYPES = [".zip", ".tar.gz", ".tgz", ".tar"];
const SUPPORTED_TEX_TYPES = [".tex", ".bib", ".cls", ".sty"];

/**
 * POST /api/projects/upload - Upload files and create a new project.
 *
 * Supported formats:
 * - ZIP archive (.zip)
 * - tar.gz archive (.tar.gz, .tgz)
 * - A single .tex file
 * - Multiple files (auto-create project structure)
 *
 * Request: multipart/form-data
 * - file: a single file
 * - files: multiple files (for multi-file uploads)
 * - name: project name (optional; defaults to filename)
 * - description: project description (optional)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    // Parse FormData
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const files = formData.getAll("files") as File[];
    let projectName = (formData.get("name") as string) || "";
    const description = (formData.get("description") as string) || "";

    // Multi-file upload
    if (files.length > 0) {
      return handleMultiFileUpload(files, projectName, description, session.user.id);
    }

    // Single-file upload
    if (!file) {
      return apiError(FILE_ERRORS.SELECT_FILE, 400);
    }

    const fileName = file.name.toLowerCase();

    // Detect file type and dispatch handling
    if (fileName.endsWith(".zip")) {
      return handleZipUpload(file, projectName, description, session.user.id);
    } else if (fileName.endsWith(".tar.gz") || fileName.endsWith(".tgz")) {
      return handleTarGzUpload(file, projectName, description, session.user.id);
    } else if (fileName.endsWith(".tar")) {
      return handleTarUpload(file, projectName, description, session.user.id);
    } else if (SUPPORTED_TEX_TYPES.some(ext => fileName.endsWith(ext))) {
      return handleSingleTexUpload(file, projectName, description, session.user.id);
    } else {
      return apiError(IMPORT_ERRORS.UNSUPPORTED_FORMAT, 400, {
        supportedFormats: [...SUPPORTED_ARCHIVE_TYPES, ...SUPPORTED_TEX_TYPES],
      });
    }
  } catch (error) {
    console.error("Error uploading project:", error);
    return apiError(IMPORT_ERRORS.UPLOAD_FAILED, 500);
  }
}

/**
 * Handle ZIP file upload.
 */
async function handleZipUpload(
  file: File,
  projectName: string,
  description: string,
  userId: string
) {
  const fileName = file.name;

  // If project name is not provided, use the filename
  if (!projectName.trim()) {
    projectName = fileName.replace(/\.zip$/i, "");
  }

  // Read ZIP content
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Parse ZIP
  const zip = new AdmZip(buffer);
  const zipEntries = zip.getEntries();

  if (zipEntries.length === 0) {
    return apiError(IMPORT_ERRORS.ZIP_EMPTY, 400);
  }

  // Detect whether we need to strip a single top-level directory
  const topLevelPrefix = detectTopLevelDirectory(zipEntries);

  // Create project id
  const projectId = uuidv4();
  const storage = await getStorage();

  // Extract files
  let mainFile = "main.tex";
  let hasMainTex = false;
  const extractedFiles: string[] = [];

  for (const entry of zipEntries) {
    // Skip directory entries and hidden files
    if (entry.isDirectory || entry.entryName.startsWith("__MACOSX")) {
      continue;
    }

    // Get relative path (strip top-level directory if present)
    let relativePath = entry.entryName;
    if (topLevelPrefix && relativePath.startsWith(topLevelPrefix)) {
      relativePath = relativePath.substring(topLevelPrefix.length);
    }

    // Skip empty paths and unsafe paths
    if (!relativePath || relativePath === "" || relativePath.includes("..")) {
      continue;
    }

    // Upload file to storage
    const content = entry.getData();
    const storageKey = StoragePaths.projectFile(projectId, relativePath);
    await storage.upload(storageKey, content, getMimeType(relativePath));
    extractedFiles.push(relativePath);

    // Detect main.tex
    if (relativePath === "main.tex" || relativePath.endsWith("/main.tex")) {
      hasMainTex = true;
      if (relativePath === "main.tex") {
        mainFile = "main.tex";
      }
    }
  }

  // If main.tex isn't found, use the first top-level .tex as the main file
  if (!hasMainTex) {
    const texFile = extractedFiles.find(f => f.endsWith(".tex") && !f.includes("/"));
    if (texFile) {
      mainFile = texFile;
    }
  }

  return createProject(projectId, projectName, description, mainFile, userId, extractedFiles);
}

/**
 * Handle tar.gz file upload.
 */
async function handleTarGzUpload(
  file: File,
  projectName: string,
  description: string,
  userId: string
) {
  const fileName = file.name;

  // If project name is not provided, use the filename
  if (!projectName.trim()) {
    projectName = fileName.replace(/\.(tar\.gz|tgz)$/i, "");
  }

  // Read file content
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Create project id and temp dir
  const projectId = uuidv4();
  const tempDir = path.join(os.tmpdir(), `upload-${projectId}`);
  const storage = await getStorage();

  await fs.mkdir(tempDir, { recursive: true });

  try {
    // Write to a temp file first
    const tempFile = path.join(tempDir, "archive.tar.gz");
    await fs.writeFile(tempFile, buffer);

    // Extract into the temp directory
    await tar.extract({
      file: tempFile,
      cwd: tempDir,
    });

    // Delete the temp archive file
    await fs.unlink(tempFile);

    // Get extracted file list and detect top-level directory
    const entries = await getAllFiles(tempDir);
    const topLevelPrefix = detectTopLevelFromPaths(entries, tempDir);

    // Upload files to storage
    const extractedFiles: string[] = [];
    let mainFile = "main.tex";
    let hasMainTex = false;

    for (const fullPath of entries) {
      let relativePath = path.relative(tempDir, fullPath);

      // Strip top-level directory if present
      if (topLevelPrefix && relativePath.startsWith(topLevelPrefix)) {
        relativePath = relativePath.substring(topLevelPrefix.length);
      }

      if (!relativePath || relativePath.includes("..")) continue;

      // Read file content and upload to storage
      const content = await fs.readFile(fullPath);
      const storageKey = StoragePaths.projectFile(projectId, relativePath);
      await storage.upload(storageKey, content, getMimeType(relativePath));
      extractedFiles.push(relativePath);

      // Detect main.tex
      if (relativePath === "main.tex") {
        hasMainTex = true;
        mainFile = "main.tex";
      }
    }

    // If main.tex isn't found, try the first top-level .tex file
    if (!hasMainTex) {
      const texFile = extractedFiles.find(f => f.endsWith(".tex") && !f.includes("/") && !f.includes("\\"));
      if (texFile) {
        mainFile = texFile;
      }
    }

    // Clean up temp dir
    await fs.rm(tempDir, { recursive: true, force: true });

    return createProject(projectId, projectName, description, mainFile, userId, extractedFiles);
  } catch (error) {
    // Cleanup
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    // Also clean up already-uploaded files
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
  file: File,
  projectName: string,
  description: string,
  userId: string
) {
  const fileName = file.name;

  if (!projectName.trim()) {
    projectName = fileName.replace(/\.tar$/i, "");
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const projectId = uuidv4();
  const tempDir = path.join(os.tmpdir(), `upload-${projectId}`);
  const storage = await getStorage();

  await fs.mkdir(tempDir, { recursive: true });

  try {
    const tempFile = path.join(tempDir, "archive.tar");
    await fs.writeFile(tempFile, buffer);

    await tar.extract({
      file: tempFile,
      cwd: tempDir,
    });

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
      const texFile = extractedFiles.find(f => f.endsWith(".tex") && !f.includes("/") && !f.includes("\\"));
      if (texFile) {
        mainFile = texFile;
      }
    }

    await fs.rm(tempDir, { recursive: true, force: true });

    return createProject(projectId, projectName, description, mainFile, userId, extractedFiles);
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
  file: File,
  projectName: string,
  description: string,
  userId: string
) {
  const fileName = file.name;

  // If project name is not provided, use the filename (without extension)
  if (!projectName.trim()) {
    projectName = fileName.replace(/\.[^.]+$/, "");
  }

  // Read file content
  const arrayBuffer = await file.arrayBuffer();
  const content = Buffer.from(arrayBuffer);

  // Create project id
  const projectId = uuidv4();
  const storage = await getStorage();

  // Determine main filename
  const mainFile = fileName.endsWith(".tex") ? fileName : "main.tex";
  const targetFileName = fileName.endsWith(".tex") ? fileName : fileName;

  // Upload file
  const storageKey = StoragePaths.projectFile(projectId, targetFileName);
  await storage.upload(storageKey, content, getMimeType(targetFileName));

  // If the uploaded file isn't a .tex but the project needs main.tex, create a basic main.tex
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
  }

  const extractedFiles = fileName.endsWith(".tex") ? [fileName] : [fileName, "main.tex"];

  return createProject(projectId, projectName, description, mainFile, userId, extractedFiles);
}

/**
 * Handle multi-file uploads.
 */
async function handleMultiFileUpload(
  files: File[],
  projectName: string,
  description: string,
  userId: string
) {
  if (files.length === 0) {
    return apiError(FILE_ERRORS.SELECT_FILES_TO_UPLOAD, 400);
  }

  // If project name is not provided, use the first .tex filename or a default name
  if (!projectName.trim()) {
    const firstTexFile = files.find(f => f.name.endsWith(".tex"));
    if (firstTexFile) {
      projectName = firstTexFile.name.replace(/\.tex$/, "");
    } else {
      projectName = "New Project";
    }
  }

  // Create project id
  const projectId = uuidv4();
  const storage = await getStorage();

  const extractedFiles: string[] = [];
  let mainFile = "main.tex";
  let hasMainTex = false;

  // Upload all files
  for (const file of files) {
    const fileName = file.name;
    const arrayBuffer = await file.arrayBuffer();
    const content = Buffer.from(arrayBuffer);

    // Safety check
    if (fileName.includes("..") || fileName.startsWith("/")) {
      console.warn(`Skipping unsafe filename: ${fileName}`);
      continue;
    }

    const storageKey = StoragePaths.projectFile(projectId, fileName);
    await storage.upload(storageKey, content, getMimeType(fileName));
    extractedFiles.push(fileName);

    if (fileName === "main.tex") {
      hasMainTex = true;
    }
  }

  // If main.tex doesn't exist, use the first .tex file
  if (!hasMainTex) {
    const texFile = extractedFiles.find(f => f.endsWith(".tex"));
    if (texFile) {
      mainFile = texFile;
    } else {
      // Create a basic main.tex
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
  }

  return createProject(projectId, projectName, description, mainFile, userId, extractedFiles);
}

/**
 * Create a project record.
 */
async function createProject(
  projectId: string,
  projectName: string,
  description: string,
  mainFile: string,
  userId: string,
  extractedFiles: string[]
) {
  // Create database record
  const project = await prisma.project.create({
    data: {
      id: projectId,
      name: projectName.trim(),
      description: description.trim() || null,
      mainFile,
      ownerId: userId,
      visibility: "private",
      status: "active",
    },
  });

  // Create project.json (backward compatibility)
  const storage = await getStorage();
  const meta = {
    id: projectId,
    name: projectName.trim(),
    description: description.trim() || undefined,
    mainFile,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    template: "uploaded",
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
    filesCount: extractedFiles.length,
  });
}

/**
 * Detect whether all files in a ZIP are under the same top-level directory.
 */
function detectTopLevelDirectory(entries: AdmZip.IZipEntry[]): string {
  const paths = entries
    .map(e => e.entryName)
    .filter(p => p && !p.startsWith("__MACOSX"));

  if (paths.length === 0) return "";

  const firstPath = paths[0];
  const firstSlash = firstPath.indexOf("/");

  if (firstSlash === -1) {
    return "";
  }

  const topDir = firstPath.substring(0, firstSlash + 1);
  const allInSameDir = paths.every(p => p.startsWith(topDir) || p === topDir.slice(0, -1));

  if (allInSameDir) {
    return topDir;
  }

  return "";
}

/**
 * Detect the top-level directory from extracted file paths.
 */
function detectTopLevelFromPaths(files: string[], baseDir: string): string {
  const relativePaths = files.map(f => path.relative(baseDir, f));

  if (relativePaths.length === 0) return "";

  // Get the top-level directory from the first path
  const firstPath = relativePaths[0];
  const sep = path.sep;
  const firstSepIndex = firstPath.indexOf(sep);

  if (firstSepIndex === -1) return "";

  const topDir = firstPath.substring(0, firstSepIndex + 1);
  const allInSameDir = relativePaths.every(p => p.startsWith(topDir));

  if (allInSameDir) {
    return topDir;
  }

  return "";
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
