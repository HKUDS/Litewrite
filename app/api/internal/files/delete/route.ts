/**
 * Internal API: Delete File/Folder
 * ==================================
 *
 * Internal endpoint for nanobot to delete a file or folder in a project.
 * Handles both single files and recursive folder deletion,
 * clears Yjs cache for deleted files.
 * Protected by INTERNAL_API_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import { getStorage, StoragePaths } from "@/lib/storage";

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
    const { projectId, filePath } = body as {
      projectId: string;
      filePath: string;
    };

    if (!projectId || typeof projectId !== "string") {
      return NextResponse.json(
        { success: false, error: "Project ID is required" },
        { status: 400 }
      );
    }

    if (!filePath || typeof filePath !== "string") {
      return NextResponse.json(
        { success: false, error: "File path is required" },
        { status: 400 }
      );
    }

    const storage = await getStorage();
    const projectPrefix = StoragePaths.projectPrefix(projectId);
    const key = StoragePaths.projectFile(projectId, filePath);

    const wsServerUrl =
      process.env.WS_SERVER_URL ||
      process.env.NEXT_PUBLIC_WS_URL?.replace(/^wss?:\/\//, (m) =>
        m === "wss://" ? "https://" : "http://"
      ) ||
      "http://localhost:1234";

    const clearWsDoc = async (relPath: string) => {
      if (!wsServerUrl) return;
      try {
        const base = wsServerUrl.replace(/\/+$/, "");
        await fetch(
          `${base}/clear/${projectId}/${encodeURIComponent(relPath)}`,
          {
            method: "POST",
            headers: process.env.INTERNAL_API_SECRET
              ? { "x-internal-secret": process.env.INTERNAL_API_SECRET }
              : undefined,
          }
        );
      } catch {
        // ignore
      }
    };

    let deletedCount = 0;

    // Try deleting a single file
    const exists = await storage.exists(key);
    if (exists) {
      await storage.delete(key);
      await clearWsDoc(filePath);
      deletedCount = 1;
    } else {
      // Might be a folder; delete everything under the prefix
      const folderPrefix = `${key}/`;
      const folderFiles = await storage.list(folderPrefix);

      if (folderFiles.length === 0) {
        return NextResponse.json(
          { success: false, error: "File or folder not found" },
          { status: 404 }
        );
      }

      await storage.deletePrefix(folderPrefix);
      await Promise.all(
        folderFiles.map(async (f) => {
          const relPath = f.key
            .replace(projectPrefix, "")
            .replace(/^\/+/, "");
          if (!relPath) return;
          await clearWsDoc(relPath);
        })
      );
      deletedCount = folderFiles.length;
    }

    console.log(
      `[Internal/DeleteFile] Deleted "${filePath}" (${deletedCount} file(s)) from project ${projectId}`
    );

    return NextResponse.json({
      success: true,
      data: { path: filePath, deletedCount },
    });
  } catch (error) {
    console.error("[Internal/DeleteFile] Error:", error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
