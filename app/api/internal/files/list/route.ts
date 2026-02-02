/**
 * Internal API: List Files
 * =========================
 *
 * Internal endpoint for ai-server to list project files.
 *
 * This is NOT exposed to the public - protected by INTERNAL_API_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import { getStorage, StoragePaths } from "@/lib/storage";

// Verify internal API secret
function verifyInternalAuth(request: NextRequest): boolean {
  const secret = request.headers.get("X-Internal-Secret");
  const expectedSecret = process.env.INTERNAL_API_SECRET;

  if (!expectedSecret) {
    console.warn("[Internal API] INTERNAL_API_SECRET not configured");
    return false;
  }

  return secret === expectedSecret;
}

interface FileInfo {
  path: string;
  type: "file" | "directory";
  size?: number;
}

export async function POST(request: NextRequest) {
  // Verify authentication
  if (!verifyInternalAuth(request)) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const { projectId, directory = "", recursive = true, pattern } = body;

    if (!projectId) {
      return NextResponse.json({
        success: false,
        error: "projectId is required",
      });
    }

    const storage = await getStorage();

    // Build prefix for listing
    const basePrefix = StoragePaths.projectPrefix(projectId);
    const prefix = directory
      ? `${basePrefix}/${directory}`.replace(/\/+/g, "/")
      : basePrefix;

    // List files from storage
    const allFiles = await storage.list(prefix);

    // Process files
    const files: FileInfo[] = [];
    const directories = new Set<string>();

    for (const file of allFiles) {
      // Remove the project prefix to get relative path
      // basePrefix is "projects/{id}/" so we just remove it directly
      let relativePath = file.key.replace(basePrefix, "");
      // Also handle case where basePrefix doesn't have trailing slash
      if (relativePath.startsWith("/")) {
        relativePath = relativePath.slice(1);
      }

      // Skip if in subdirectory and not recursive
      if (!recursive && relativePath.includes("/")) {
        // Add parent directory
        const parentDir = relativePath.split("/")[0];
        directories.add(parentDir);
        continue;
      }

      // Apply pattern filter if specified
      if (pattern) {
        const regex = new RegExp(
          "^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$"
        );
        const fileName = relativePath.split("/").pop() || "";
        if (!regex.test(fileName)) {
          continue;
        }
      }

      files.push({
        path: relativePath,
        type: "file",
        size: file.size,
      });
    }

    // Add directories
    for (const dir of directories) {
      files.push({
        path: dir,
        type: "directory",
      });
    }

    // Sort: directories first, then files
    files.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1;
      }
      return a.path.localeCompare(b.path);
    });

    console.log(`[Internal/ListFiles] Listed ${files.length} items in ${projectId}/${directory || "."}`);

    return NextResponse.json({
      success: true,
      data: {
        files,
        directory: directory || "",
        count: files.length,
      },
    });

  } catch (error) {
    console.error("[Internal/ListFiles] Error:", error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
