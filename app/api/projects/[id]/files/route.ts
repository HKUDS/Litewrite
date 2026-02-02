import { NextRequest, NextResponse } from "next/server";
import { getStorage, StoragePaths, isTextFile } from "@/lib/storage";

interface FileData {
  id: string;
  name: string;
  type: "file" | "folder";
  content?: string;
  children?: FileData[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Build a tree structure from a flat file list.
 */
function buildFileTree(
  files: Array<{ key: string; size: number; lastModified: Date; content?: string }>,
  projectPrefix: string
): FileData[] {
  const tree: FileData[] = [];
  const folderMap = new Map<string, FileData>();
  const nodeMap = new Map<string, FileData>(); // Avoid inserting the same path twice (file or folder)

  // Sort by path so parent directories are processed first
  const sortedFiles = [...files].sort((a, b) => a.key.localeCompare(b.key));

  // When object storage contains both:
  // - a file: X
  // - and an "object under a directory": X/Y
  // we get a conflict where the same path needs to be treated as both a file and a folder.
  //
  // The old behavior showed duplicates. The current implementation dedupes via nodeMap, which means
  // a folder created by ensureFolderPath might not be pushed into the visible tree (because a file
  // node at the same path already exists in nodeMap), but it is still recorded into folderMap.
  // This causes later child files to attach to an invisible orphan folder (regression bug).
  //
  // We solve this by using a "virtual folder node":
  // - folderMap still uses the real path as the key (so children can reliably attach)
  // - the virtual folder id becomes a unique distinguishable value, avoiding collisions with real file ids
  const VIRTUAL_FOLDER_PREFIX = "__lw_vfolder__:";
  const makeVirtualFolderId = (path: string) => `${VIRTUAL_FOLDER_PREFIX}${path}`;

  const ensureFolderPath = (parts: string[], lastModified: Date) => {
    if (parts.length === 0) return;

    let parentId = "";
    let currentLevel = tree;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      parentId = parentId ? `${parentId}/${part}` : part;

      let folder = folderMap.get(parentId);
      if (!folder) {
        const existingNodeAtPath = nodeMap.get(parentId);
        const hasFileWithSamePath = existingNodeAtPath?.type === "file";
        const folderNodeId = hasFileWithSamePath ? makeVirtualFolderId(parentId) : parentId;

        folder = {
          id: folderNodeId,
          name: part,
          type: "folder",
          children: [],
          createdAt: lastModified.toISOString(),
          updatedAt: lastModified.toISOString(),
        };
        // Prevent duplicate pushes (the same folder can be triggered by .keep and by child files).
        // Note: in the conflict scenario we must not dedupe by parentId (it might be a same-path file);
        // use folderNodeId instead.
        if (!nodeMap.has(folderNodeId)) {
          currentLevel.push(folder);
          nodeMap.set(folderNodeId, folder);
        }
        // folderMap is indexed by the real path: even if folder.id is virtual, children must find it.
        folderMap.set(parentId, folder);
      }

      if (!folder.children) folder.children = [];
      currentLevel = folder.children;
    }
  };

  for (const file of sortedFiles) {
    // Remove the project prefix to get the relative path
    const relativePath = file.key.replace(projectPrefix, "");
    if (!relativePath) continue;

    const parts = relativePath.split("/").filter(Boolean);
    if (parts.length === 0) continue;

    // `.keep`/`.gitkeep` are used as "empty folder placeholders". They aren't shown in the tree,
    // but we still need to create their parent directory nodes.
    const lastPart = parts[parts.length - 1];
    if (lastPart === ".keep" || lastPart === ".gitkeep") {
      const folderParts = parts.slice(0, -1);
      // IMPORTANT: if `.keep` is in a hidden directory (e.g. `.git/hooks/.gitkeep`),
      // we must not create hidden directory nodes due to a placeholder file, otherwise we'd bypass
      // the "skip hidden files and directories" rule.
      if (folderParts.some(part => part.startsWith("."))) continue;
      ensureFolderPath(folderParts, file.lastModified);
      continue;
    }

    // Skip hidden files and directories
    if (parts.some(part => part.startsWith("."))) continue;

    const fileName = parts[parts.length - 1];
    // Only treat explicit "directory marker objects" (keys ending with /) as folders.
    // ⚠️ Do NOT infer folders from size=0 + no extension, otherwise empty no-extension files
    // (e.g. `1234`) would be misclassified as folders.
    const isFolder = file.key.endsWith("/");

    // Object storage "directory marker objects" only exist to make empty folders visible; actual tree
    // nodes are generated uniformly by ensureFolderPath.
    // This also avoids the issue where, if a same-name file already exists, folderMap gets an invisible folder.
    if (isFolder) {
      ensureFolderPath(parts, file.lastModified);
      continue;
    }

    // Build file id (used by the frontend).
    // Keep slashes to preserve the real path, so the assets API can use it directly.
    const fileId = parts.join("/");

    const fileData: FileData = {
      id: fileId,
      name: fileName,
      type: "file",
      createdAt: file.lastModified.toISOString(),
      updatedAt: file.lastModified.toISOString(),
    };

    // If it's a text file, attach content
    if (file.content !== undefined) {
      fileData.content = file.content;
    }

    // Find or create parent directory
    if (parts.length === 1) {
      // Root-level file/folder
      if (!nodeMap.has(fileId)) {
        tree.push(fileData);
        nodeMap.set(fileId, fileData);
      }
      if (isFolder) {
        folderMap.set(fileId, fileData);
      }
    } else {
      // Nested file/folder
      const parentParts = parts.slice(0, -1);
      ensureFolderPath(parentParts, file.lastModified);

      const parentId = parentParts.join("/");
      const parentFolder = folderMap.get(parentId);
      const targetLevel = parentFolder?.children || tree;

      if (!nodeMap.has(fileId)) {
        targetLevel.push(fileData);
        nodeMap.set(fileId, fileData);
      }
    }
  }

  return tree;
}

/**
 * GET - Get the project file tree.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;
    const storage = await getStorage();
    const prefix = StoragePaths.projectPrefix(projectId);

    // List all files
    const fileList = await storage.list(prefix);

    // Read text file contents
    const filesWithContent = await Promise.all(
      fileList.map(async (file) => {
        const fileName = file.key.split("/").pop() || "";
        let content: string | undefined;

        if (isTextFile(fileName)) {
          try {
            const buffer = await storage.download(file.key);
            content = buffer.toString("utf-8");
          } catch {
            // File read failed; skip content
          }
        }

        return { ...file, content };
      })
    );

    // Build file tree
    const files = buildFileTree(filesWithContent, prefix);

    return NextResponse.json({ projectId, files });
  } catch (error) {
    console.error("Error getting project files:", error);
    return NextResponse.json(
      { error: "Failed to get project files" },
      { status: 500 }
    );
  }
}

/**
 * POST - Create a file/folder.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;
    const body = await request.json();
    const { name, type, parentPath = "", content = "" } = body;

    const storage = await getStorage();

    // Build full path
    const relativePath = parentPath ? `${parentPath}/${name}` : name;
    const key = StoragePaths.projectFile(projectId, relativePath);

    // Check whether a same-name file already exists
    const fileExists = await storage.exists(key);

    // Check whether a same-name folder already exists (whether any object exists under that prefix)
    const folderPrefix = key.endsWith("/") ? key : `${key}/`;
    const folderContents = await storage.list(folderPrefix);
    const folderExists = folderContents.length > 0;

    if (type === "folder") {
      // Folder creation checks
      if (folderExists) {
        return NextResponse.json(
          { error: "FOLDER_EXISTS" },
          { status: 409 }
        );
      }
      if (fileExists) {
        return NextResponse.json(
          { error: "FILE_EXISTS_WITH_SAME_NAME", message: "Cannot create folder: a file with the same name already exists" },
          { status: 409 }
        );
      }
      // In object storage, folders can be represented by an empty object ending with `/`,
      // or by not creating anything and letting it exist implicitly once files are created.
      // Here we create a .keep file to keep the folder visible.
      await storage.upload(`${key}/.keep`, "", "text/plain");
    } else {
      // File creation checks
      if (fileExists) {
        return NextResponse.json(
          { error: "FILE_EXISTS" },
          { status: 409 }
        );
      }
      if (folderExists) {
        return NextResponse.json(
          { error: "FOLDER_EXISTS_WITH_SAME_NAME", message: "Cannot create file: a folder with the same name already exists" },
          { status: 409 }
        );
      }
      // Also clear the WS server in-memory doc (if cached)
      const wsServerUrl =
        process.env.WS_SERVER_URL ||
        process.env.NEXT_PUBLIC_WS_URL?.replace(/^wss?:\/\//, (m) => (m === "wss://" ? "https://" : "http://")) ||
        "http://localhost:1234";
      if (wsServerUrl) {
        try {
          const base = wsServerUrl.replace(/\/+$/, "");
          await fetch(`${base}/clear/${projectId}/${encodeURIComponent(relativePath)}`, {
            method: "POST",
            headers: process.env.INTERNAL_API_SECRET ? { "x-internal-secret": process.env.INTERNAL_API_SECRET } : undefined,
          });
        } catch {
          // ignore: WS server may be unavailable; Redis cleanup is sufficient for most scenarios
        }
      }
      await storage.upload(key, content, "text/plain");
    }

    return NextResponse.json({ success: true, path: relativePath });
  } catch (error) {
    console.error("Error creating file:", error);
    return NextResponse.json(
      { error: "Failed to create file" },
      { status: 500 }
    );
  }
}

/**
 * PUT - Update file content.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;
    const body = await request.json();
    const { filePath, content } = body;

    const storage = await getStorage();
    const key = StoragePaths.projectFile(projectId, filePath);

    await storage.upload(key, content, "text/plain");

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating file:", error);
    return NextResponse.json(
      { error: "Failed to update file" },
      { status: 500 }
    );
  }
}

/**
 * DELETE - Delete a file/folder.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;
    const { searchParams } = new URL(request.url);
    const filePath = searchParams.get("path");

    if (!filePath) {
      return NextResponse.json(
        { error: "File path is required" },
        { status: 400 }
      );
    }

    const storage = await getStorage();
    const projectPrefix = StoragePaths.projectPrefix(projectId);
    const key = StoragePaths.projectFile(projectId, filePath);
    const wsServerUrl =
      process.env.WS_SERVER_URL ||
      process.env.NEXT_PUBLIC_WS_URL?.replace(/^wss?:\/\//, (m) => (m === "wss://" ? "https://" : "http://")) ||
      "http://localhost:1234";
    const clearWsDoc = async (relPath: string) => {
      if (!wsServerUrl) return;
      try {
        const base = wsServerUrl.replace(/\/+$/, "");
        await fetch(`${base}/clear/${projectId}/${encodeURIComponent(relPath)}`, {
          method: "POST",
          headers: process.env.INTERNAL_API_SECRET ? { "x-internal-secret": process.env.INTERNAL_API_SECRET } : undefined,
        });
      } catch {
        // ignore
      }
    };

    // Try deleting a single file
    const exists = await storage.exists(key);
    if (exists) {
      await storage.delete(key);
      await clearWsDoc(filePath);
    } else {
      // Might be a folder; delete everything under the prefix
      const folderPrefix = `${key}/`;

      // First list all objects under the folder, so we can also clear Yjs persistence (by file path).
      // Note: keys here are full storage keys; we must remove the project prefix to get fileId/filePath.
      const folderFiles = await storage.list(folderPrefix);

      await storage.deletePrefix(folderPrefix);
      await Promise.all(
        folderFiles.map(async (f) => {
          const relPath = f.key.replace(projectPrefix, "").replace(/^\/+/, "");
          if (!relPath) return;
          await clearWsDoc(relPath);
        })
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting file:", error);
    return NextResponse.json(
      { error: "Failed to delete file" },
      { status: 500 }
    );
  }
}

/**
 * PATCH - Move/rename a file.
 *
 * Supports two operations:
 * 1. Move a file: provide sourcePath and targetPath (destination folder path)
 * 2. Rename a file: provide sourcePath, targetPath, and newName
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;
    const body = await request.json();
    const { sourcePath, targetPath, newName } = body;

    if (!sourcePath) {
      return NextResponse.json(
        { error: "Source path is required" },
        { status: 400 }
      );
    }

    const storage = await getStorage();
    const sourceKey = StoragePaths.projectFile(projectId, sourcePath);
    const wsServerUrl =
      process.env.WS_SERVER_URL ||
      process.env.NEXT_PUBLIC_WS_URL?.replace(/^wss?:\/\//, (m) => (m === "wss://" ? "https://" : "http://")) ||
      "http://localhost:1234";
    const clearWsDoc = async (relPath: string) => {
      if (!wsServerUrl) return;
      try {
        const base = wsServerUrl.replace(/\/+$/, "");
        await fetch(`${base}/clear/${projectId}/${encodeURIComponent(relPath)}`, {
          method: "POST",
          headers: process.env.INTERNAL_API_SECRET ? { "x-internal-secret": process.env.INTERNAL_API_SECRET } : undefined,
        });
      } catch {
        // ignore
      }
    };

    // Determine filename: use newName if provided, otherwise keep the original
    const originalFileName = sourcePath.split("/").pop() || sourcePath;
    const fileName = newName || originalFileName;
    const destPath = targetPath ? `${targetPath}/${fileName}` : fileName;
    const destKey = StoragePaths.projectFile(projectId, destPath);

    // no-op: if source and destination are identical, return success (avoid treating "unchanged rename" as conflict)
    if (sourceKey === destKey) {
      return NextResponse.json({ success: true, newPath: destPath });
    }

    // Check whether the source exists
    const sourceExists = await storage.exists(sourceKey);
    if (!sourceExists) {
      // Might be a folder; check whether it has children
      const sourcePrefix = sourceKey + "/";
      const files = await storage.list(sourcePrefix);

      if (files.length === 0) {
        return NextResponse.json(
          { error: "Source file not found" },
          { status: 404 }
        );
      }

      // Move a folder: copy all children, then delete the original
      const destPrefix = destKey + "/";

      // Check whether source and destination are the same (renaming to the same name)
      if (sourcePrefix === destPrefix) {
        return NextResponse.json({ success: true, newPath: destPath });
      }

      for (const file of files) {
        const relativePath = file.key.replace(sourcePrefix, "");
        const newKey = destPrefix + relativePath;

        // Critical fix: during folder moves, if the destination path has leftover Yjs data for a same-name file,
        // content can get corrupted. Clear destination Yjs before writing (via ws-server /clear, clears Redis + memory).
        const destRelPath = `${destPath}/${relativePath}`.replace(/\/+/g, "/").replace(/^\/+/, "");
        await clearWsDoc(destRelPath);

        await storage.copy(file.key, newKey);

        // Also clear source Yjs (since the source path will be deleted)
        const sourceRelPath = `${sourcePath}/${relativePath}`.replace(/\/+/g, "/").replace(/^\/+/, "");
        await clearWsDoc(sourceRelPath);
      }
      await storage.deletePrefix(sourcePrefix);
    } else {
      // Move a single file
      // Check whether destination already exists
      const destExists = await storage.exists(destKey);
      if (destExists) {
        return NextResponse.json(
          { error: "A file with the same name already exists in the target location" },
          { status: 409 }
        );
      }

      // Critical fix: clear destination Yjs before writing to the destination path (via ws-server /clear, clears Redis + memory).
      // Otherwise, after "old a.tex is renamed away, then b.ssd is renamed to a.tex", it could inherit old a.tex Yjs content.
      await clearWsDoc(destPath);

      await storage.copy(sourceKey, destKey);
      await storage.delete(sourceKey);

      // Source path is deleted; clear source Yjs too (avoid stale content resurrecting on later same-name reuse)
      await clearWsDoc(sourcePath);
    }

    return NextResponse.json({ success: true, newPath: destPath });
  } catch (error) {
    console.error("Error moving file:", error);
    return NextResponse.json(
      { error: "Failed to move file" },
      { status: 500 }
    );
  }
}
