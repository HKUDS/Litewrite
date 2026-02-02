import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import AdmZip from "adm-zip";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStorage, StoragePaths, getMimeType } from "@/lib/storage";
import { apiError, AUTH_ERRORS, IMPORT_ERRORS } from "@/lib/api-errors";

interface GitHubUrlInfo {
  owner: string;
  repo: string;
  branch: string;
  subPath: string;
}

/**
 * POST /api/projects/import/github - Import a project from GitHub/GitLab.
 *
 * Supported URL formats:
 * - https://github.com/user/repo
 * - https://github.com/user/repo/tree/branch
 * - https://github.com/user/repo/tree/branch/path/to/folder
 * - https://gitlab.com/user/repo (same as above)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    const body = await request.json();
    const { url, name, description } = body;

    if (!url) {
      return apiError(IMPORT_ERRORS.ENTER_REPO_URL, 400);
    }

    // Parse URL
    const urlInfo = parseGitUrl(url);
    if (!urlInfo) {
      return apiError(IMPORT_ERRORS.INVALID_GITHUB_URL, 400);
    }

    // Build download URL
    const isGitLab = url.includes("gitlab.com");
    let downloadUrl: string;

    if (isGitLab) {
      // GitLab: https://gitlab.com/user/repo/-/archive/branch/repo-branch.zip
      downloadUrl = `https://gitlab.com/${urlInfo.owner}/${urlInfo.repo}/-/archive/${urlInfo.branch}/${urlInfo.repo}-${urlInfo.branch}.zip`;
    } else {
      // GitHub: https://github.com/user/repo/archive/refs/heads/branch.zip
      downloadUrl = `https://github.com/${urlInfo.owner}/${urlInfo.repo}/archive/refs/heads/${urlInfo.branch}.zip`;
    }

    // Download ZIP
    const response = await fetch(downloadUrl);

    if (!response.ok) {
      if (response.status === 404) {
        return apiError(IMPORT_ERRORS.REPO_NOT_FOUND, 404);
      }
      return apiError(IMPORT_ERRORS.FAILED, response.status);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Parse ZIP
    const zip = new AdmZip(buffer);
    const zipEntries = zip.getEntries();

    if (zipEntries.length === 0) {
      return apiError(IMPORT_ERRORS.REPO_EMPTY, 400);
    }

    // GitHub/GitLab ZIPs usually have a top-level directory (repo-branch/).
    // Detect and strip it.
    const topLevelPrefix = detectTopLevelDirectory(zipEntries);

    // Create project ID
    const projectId = uuidv4();
    const storage = await getStorage();

    // Project name
    const projectName = name?.trim() || urlInfo.repo;
    const projectDescription = description?.trim() || `Imported from ${url}`;

    // Extract files
    let mainFile = "main.tex";
    let hasMainTex = false;
    const extractedFiles: string[] = [];

    // If subPath is provided, only extract files under that path
    const subPathPrefix = urlInfo.subPath ? urlInfo.subPath + "/" : "";

    for (const entry of zipEntries) {
      // Skip directory entries and hidden files
      if (entry.isDirectory || entry.entryName.startsWith("__MACOSX") || entry.entryName.includes("/.")) {
        continue;
      }

      // Get relative path
      let relativePath = entry.entryName;

      // Strip top-level directory
      if (topLevelPrefix && relativePath.startsWith(topLevelPrefix)) {
        relativePath = relativePath.substring(topLevelPrefix.length);
      }

      // If subPath is provided, only extract files under that path
      if (subPathPrefix) {
        if (!relativePath.startsWith(subPathPrefix)) {
          continue;
        }
        relativePath = relativePath.substring(subPathPrefix.length);
      }

      // Skip empty/unsafe paths
      if (!relativePath || relativePath === "" || relativePath.includes("..")) {
        continue;
      }

      // Upload file to storage
      const content = entry.getData();
      const storageKey = StoragePaths.projectFile(projectId, relativePath);
      await storage.upload(storageKey, content, getMimeType(relativePath));
      extractedFiles.push(relativePath);

      // Detect main.tex
      if (relativePath === "main.tex") {
        hasMainTex = true;
        mainFile = "main.tex";
      }
    }

    // If no files were extracted
    if (extractedFiles.length === 0) {
      return apiError(
        urlInfo.subPath ? IMPORT_ERRORS.NO_FILES_IN_PATH : IMPORT_ERRORS.NO_FILES_FOUND,
        400
      );
    }

    // If main.tex is not found, pick the first top-level .tex file
    if (!hasMainTex) {
      const texFile = extractedFiles.find(f => f.endsWith(".tex") && !f.includes("/"));
      if (texFile) {
        mainFile = texFile;
      }
    }

    // Create database record
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
      template: "github-import",
      sourceUrl: url,
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
  } catch (error) {
    console.error("Error importing from GitHub:", error);
    return apiError(IMPORT_ERRORS.FAILED, 500);
  }
}

/**
 * Parse a GitHub/GitLab URL.
 */
function parseGitUrl(url: string): GitHubUrlInfo | null {
  try {
    // Normalize URL
    url = url.trim();
    if (!url.startsWith("http")) {
      url = "https://" + url;
    }

    const urlObj = new URL(url);
    const host = urlObj.hostname.toLowerCase();

    // Validate supported platforms
    if (!host.includes("github.com") && !host.includes("gitlab.com")) {
      return null;
    }

    // Parse path: /user/repo or /user/repo/tree/branch/path
    const pathParts = urlObj.pathname.split("/").filter(Boolean);

    if (pathParts.length < 2) {
      return null;
    }

    const owner = pathParts[0];
    const repo = pathParts[1].replace(/\.git$/, "");
    let branch = "main"; // Default branch
    let subPath = "";

    // Check for tree/branch/path format
    if (pathParts.length >= 4 && pathParts[2] === "tree") {
      branch = pathParts[3];
      if (pathParts.length > 4) {
        subPath = pathParts.slice(4).join("/");
      }
    } else if (pathParts.length >= 4 && pathParts[2] === "-" && pathParts[3] === "tree") {
      // GitLab format: /-/tree/branch/path
      branch = pathParts[4] || "main";
      if (pathParts.length > 5) {
        subPath = pathParts.slice(5).join("/");
      }
    }

    return { owner, repo, branch, subPath };
  } catch {
    return null;
  }
}

/**
 * Detect whether all ZIP entries are under the same top-level directory.
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
