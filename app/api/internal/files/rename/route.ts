/**
 * Internal API: Rename/Move File
 * ================================
 *
 * Internal endpoint for nanobot to rename or move a file/folder in a project.
 * Handles both single files and folder trees, clears Yjs cache for source and dest.
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
    const { projectId, sourcePath, newName, targetPath } = body as {
      projectId: string;
      sourcePath: string;
      newName?: string;
      targetPath?: string;
    };

    if (!projectId || typeof projectId !== "string") {
      return NextResponse.json(
        { success: false, error: "Project ID is required" },
        { status: 400 }
      );
    }

    if (!sourcePath || typeof sourcePath !== "string") {
      return NextResponse.json(
        { success: false, error: "Source path is required" },
        { status: 400 }
      );
    }

    const storage = await getStorage();
    const sourceKey = StoragePaths.projectFile(projectId, sourcePath);

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

    // Determine destination path
    const originalFileName = sourcePath.split("/").pop() || sourcePath;
    const fileName = newName || originalFileName;
    const destPath = targetPath ? `${targetPath}/${fileName}` : fileName;
    const destKey = StoragePaths.projectFile(projectId, destPath);

    // no-op: if source and destination are identical
    if (sourceKey === destKey) {
      return NextResponse.json({
        success: true,
        data: { oldPath: sourcePath, newPath: destPath },
      });
    }

    // Check whether the source exists
    const sourceExists = await storage.exists(sourceKey);
    if (!sourceExists) {
      // Might be a folder
      const sourcePrefix = sourceKey + "/";
      const files = await storage.list(sourcePrefix);

      if (files.length === 0) {
        return NextResponse.json(
          { success: false, error: "Source file not found" },
          { status: 404 }
        );
      }

      // Move a folder: copy all children, then delete the original
      const destPrefix = destKey + "/";

      if (sourcePrefix === destPrefix) {
        return NextResponse.json({
          success: true,
          data: { oldPath: sourcePath, newPath: destPath },
        });
      }

      for (const file of files) {
        const relativePath = file.key.replace(sourcePrefix, "");
        const newKey = destPrefix + relativePath;

        const destRelPath = `${destPath}/${relativePath}`
          .replace(/\/+/g, "/")
          .replace(/^\/+/, "");
        await clearWsDoc(destRelPath);

        await storage.copy(file.key, newKey);

        const sourceRelPath = `${sourcePath}/${relativePath}`
          .replace(/\/+/g, "/")
          .replace(/^\/+/, "");
        await clearWsDoc(sourceRelPath);
      }
      await storage.deletePrefix(sourcePrefix);
    } else {
      // Move a single file
      const destExists = await storage.exists(destKey);
      if (destExists) {
        return NextResponse.json(
          {
            success: false,
            error:
              "A file with the same name already exists in the target location",
          },
          { status: 409 }
        );
      }

      await clearWsDoc(destPath);
      await storage.copy(sourceKey, destKey);
      await storage.delete(sourceKey);
      await clearWsDoc(sourcePath);
    }

    console.log(
      `[Internal/RenameFile] Moved "${sourcePath}" -> "${destPath}" in project ${projectId}`
    );

    return NextResponse.json({
      success: true,
      data: { oldPath: sourcePath, newPath: destPath },
    });
  } catch (error) {
    console.error("[Internal/RenameFile] Error:", error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
