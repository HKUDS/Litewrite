/**
 * Internal API: Create File/Folder
 * ==================================
 *
 * Internal endpoint for nanobot to create a new file or folder in a project.
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
    const {
      projectId,
      name,
      type = "file",
      parentPath = "",
      content = "",
    } = body as {
      projectId: string;
      name: string;
      type?: "file" | "folder";
      parentPath?: string;
      content?: string;
    };

    if (!projectId || typeof projectId !== "string") {
      return NextResponse.json(
        { success: false, error: "Project ID is required" },
        { status: 400 }
      );
    }

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: "File name is required" },
        { status: 400 }
      );
    }

    const storage = await getStorage();

    // Build full path
    const relativePath = parentPath ? `${parentPath}/${name}` : name;
    const key = StoragePaths.projectFile(projectId, relativePath);

    // Check whether a same-name file already exists
    const fileExists = await storage.exists(key);

    // Check whether a same-name folder already exists
    const folderPrefix = key.endsWith("/") ? key : `${key}/`;
    const folderContents = await storage.list(folderPrefix);
    const folderExists = folderContents.length > 0;

    if (type === "folder") {
      if (folderExists) {
        return NextResponse.json(
          { success: false, error: "FOLDER_EXISTS" },
          { status: 409 }
        );
      }
      if (fileExists) {
        return NextResponse.json(
          { success: false, error: "FILE_EXISTS_WITH_SAME_NAME" },
          { status: 409 }
        );
      }
      // Create a .keep file to make the folder visible
      await storage.upload(`${key}/.keep`, "", "text/plain");
    } else {
      if (fileExists) {
        return NextResponse.json(
          { success: false, error: "FILE_EXISTS" },
          { status: 409 }
        );
      }
      if (folderExists) {
        return NextResponse.json(
          { success: false, error: "FOLDER_EXISTS_WITH_SAME_NAME" },
          { status: 409 }
        );
      }
      // Clear WS server in-memory doc (if cached)
      const wsServerUrl =
        process.env.WS_SERVER_URL ||
        process.env.NEXT_PUBLIC_WS_URL?.replace(/^wss?:\/\//, (m) =>
          m === "wss://" ? "https://" : "http://"
        ) ||
        "http://localhost:1234";
      if (wsServerUrl) {
        try {
          const base = wsServerUrl.replace(/\/+$/, "");
          await fetch(
            `${base}/clear/${projectId}/${encodeURIComponent(relativePath)}`,
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
      }
      await storage.upload(key, content, "text/plain");
    }

    console.log(
      `[Internal/CreateFile] Created ${type} "${relativePath}" in project ${projectId}`
    );

    return NextResponse.json({
      success: true,
      data: { path: relativePath, type },
    });
  } catch (error) {
    console.error("[Internal/CreateFile] Error:", error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
