/**
 * Internal API: Import from GitHub/GitLab
 * =========================================
 *
 * Internal endpoint for nanobot to import a project from GitHub or GitLab.
 * Replicates the logic of the public /api/projects/import/github endpoint
 * but uses INTERNAL_API_SECRET + ownerId instead of user session auth.
 *
 * Protected by INTERNAL_API_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import AdmZip from "adm-zip";
import { prisma } from "@/lib/prisma";
import { getStorage, StoragePaths, getMimeType } from "@/lib/storage";

interface GitHubUrlInfo {
  owner: string;
  repo: string;
  branch: string;
  subPath: string;
}

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
    const { url, ownerId, name, description } = body as {
      url: string;
      ownerId: string;
      name?: string;
      description?: string;
    };

    if (!url) {
      return NextResponse.json(
        { success: false, error: "Repository URL is required" },
        { status: 400 }
      );
    }

    if (!ownerId) {
      return NextResponse.json(
        { success: false, error: "ownerId is required" },
        { status: 400 }
      );
    }

    // Parse URL
    const urlInfo = parseGitUrl(url);
    if (!urlInfo) {
      return NextResponse.json(
        { success: false, error: "Invalid GitHub/GitLab URL" },
        { status: 400 }
      );
    }

    // Build download URL
    const isGitLab = url.includes("gitlab.com");
    let downloadUrl: string;

    if (isGitLab) {
      downloadUrl = `https://gitlab.com/${urlInfo.owner}/${urlInfo.repo}/-/archive/${urlInfo.branch}/${urlInfo.repo}-${urlInfo.branch}.zip`;
    } else {
      downloadUrl = `https://github.com/${urlInfo.owner}/${urlInfo.repo}/archive/refs/heads/${urlInfo.branch}.zip`;
    }

    // Download ZIP
    const response = await fetch(downloadUrl);

    if (!response.ok) {
      return NextResponse.json(
        {
          success: false,
          error:
            response.status === 404
              ? "Repository not found"
              : `Download failed with status ${response.status}`,
        },
        { status: response.status === 404 ? 404 : 500 }
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Parse ZIP
    const zip = new AdmZip(buffer);
    const zipEntries = zip.getEntries();

    if (zipEntries.length === 0) {
      return NextResponse.json(
        { success: false, error: "Repository is empty" },
        { status: 400 }
      );
    }

    // Detect and strip top-level directory
    const topLevelPrefix = detectTopLevelDirectory(zipEntries);

    // Create project
    const projectId = uuidv4();
    const storage = await getStorage();
    const projectName = name?.trim() || urlInfo.repo;
    const projectDescription = description?.trim() || `Imported from ${url}`;

    let mainFile = "main.tex";
    let hasMainTex = false;
    const extractedFiles: string[] = [];

    // If subPath is provided, only extract files under that path
    const subPathPrefix = urlInfo.subPath ? urlInfo.subPath + "/" : "";

    for (const entry of zipEntries) {
      if (
        entry.isDirectory ||
        entry.entryName.startsWith("__MACOSX") ||
        entry.entryName.includes("/.")
      ) {
        continue;
      }

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

      if (!relativePath || relativePath === "" || relativePath.includes("..")) {
        continue;
      }

      const content = entry.getData();
      const storageKey = StoragePaths.projectFile(projectId, relativePath);
      await storage.upload(storageKey, content, getMimeType(relativePath));
      extractedFiles.push(relativePath);

      if (relativePath === "main.tex") {
        hasMainTex = true;
        mainFile = "main.tex";
      }
    }

    if (extractedFiles.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: urlInfo.subPath
            ? `No files found in path: ${urlInfo.subPath}`
            : "No files found in repository",
        },
        { status: 400 }
      );
    }

    if (!hasMainTex) {
      const texFile = extractedFiles.find(
        (f) => f.endsWith(".tex") && !f.includes("/")
      );
      if (texFile) mainFile = texFile;
    }

    // Create database record
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
      template: "github-import",
      sourceUrl: url,
    };
    const metaKey = StoragePaths.projectFile(projectId, "project.json");
    await storage.upload(
      metaKey,
      JSON.stringify(meta, null, 2),
      "application/json"
    );

    console.log(
      `[Internal/ImportGithub] Imported ${url} as project "${projectName}" (${projectId}) for owner ${ownerId}`
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
  } catch (error) {
    console.error("[Internal/ImportGithub] Error:", error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

/**
 * Parse a GitHub/GitLab URL.
 */
function parseGitUrl(url: string): GitHubUrlInfo | null {
  try {
    url = url.trim();
    if (!url.startsWith("http")) {
      url = "https://" + url;
    }

    const urlObj = new URL(url);
    const host = urlObj.hostname.toLowerCase();

    if (!host.includes("github.com") && !host.includes("gitlab.com")) {
      return null;
    }

    const pathParts = urlObj.pathname.split("/").filter(Boolean);
    if (pathParts.length < 2) return null;

    const owner = pathParts[0];
    const repo = pathParts[1].replace(/\.git$/, "");
    let branch = "main";
    let subPath = "";

    if (pathParts.length >= 4 && pathParts[2] === "tree") {
      branch = pathParts[3];
      if (pathParts.length > 4) {
        subPath = pathParts.slice(4).join("/");
      }
    } else if (
      pathParts.length >= 4 &&
      pathParts[2] === "-" &&
      pathParts[3] === "tree"
    ) {
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
