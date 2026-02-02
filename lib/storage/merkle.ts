/**
 * Merkle Tree Version Control Service
 *
 * A version control system based on content-addressable storage (CAS).
 * Inspired by Git's Merkle Tree structure.
 */

import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { getStorage, StoragePaths, getMimeType } from "./index";

// ============================================
// Type definitions
// ============================================

export interface TreeEntryData {
  name: string;
  type: "blob" | "tree";
  hash: string;
  mode: number;
}

export interface FileDiff {
  filePath: string;
  status: "added" | "removed" | "modified" | "unchanged";
  oldHash?: string;
  newHash?: string;
}

export interface DiffLine {
  type: "added" | "removed" | "unchanged";
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface FileChange extends FileDiff {
  diff: DiffLine[];
}

export interface GarbageCollectResult {
  deletedBlobCount: number;
  deletedTreeCount: number;
  freedBytes: number;
  errors: string[];
}

// ============================================
// Hash utilities
// ============================================

/**
 * Compute SHA-256 hash of content.
 */
export function computeHash(content: Buffer | string): string {
  const hash = createHash("sha256");
  hash.update(content);
  return hash.digest("hex");
}

/**
 * Compute a tree hash.
 * Tree hash = SHA-256(sorted entry list)
 */
export function computeTreeHash(entries: TreeEntryData[]): string {
  // Sort by name
  const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));

  // Hash input: one entry per line: "mode type hash name"
  const content = sorted
    .map((e) => `${e.mode} ${e.type} ${e.hash} ${e.name}`)
    .join("\n");

  return computeHash(content);
}

// ============================================
// MerkleService class
// ============================================

export class MerkleService {
  /**
   * Store a blob (deduplicated).
   * If a blob with the same content already exists, increment its ref count.
   * Uses upsert for concurrency safety.
   */
  async storeBlob(
    content: Buffer,
    mimeType?: string
  ): Promise<{ hash: string; isNew: boolean }> {
    const hash = computeHash(content);
    const storage = await getStorage();
    const key = StoragePaths.blob(hash);

    // Check object storage first (to decide whether upload is needed)
    const storageExists = await storage.exists(key);

    // Use upsert to make DB operation atomic.
    // If exists: increment refCount; otherwise: create a new record.
    const result = await prisma.blob.upsert({
      where: { hash },
      update: {
        refCount: { increment: 1 },
      },
      create: {
        hash,
        size: content.length,
        mimeType,
        refCount: 1,
      },
    });

    // Upload if it's newly created or missing in object storage.
    // Here refCount === 1 indicates the record was created just now.
    const isNew = result.refCount === 1;
    if (!storageExists) {
      await storage.upload(key, content, mimeType);
    }

    return { hash, isNew };
  }

  /**
   * Download blob content.
   */
  async downloadBlob(hash: string): Promise<Buffer> {
    const storage = await getStorage();
    const key = StoragePaths.blob(hash);
    return storage.download(key);
  }

  /**
   * Decrement blob ref count.
   * If the blob does not exist, silently ignore (it may have been deleted).
   */
  async decrementBlobRef(hash: string): Promise<void> {
    try {
      await prisma.blob.update({
        where: { hash },
        data: { refCount: { decrement: 1 } },
      });
    } catch (error) {
      // If blob doesn't exist (P2025), silently ignore
      if (error instanceof Error && error.message.includes("Record to update not found")) {
        console.warn(`Blob ${hash.substring(0, 12)}... not found, skipping decrement`);
        return;
      }
      throw error;
    }
  }

  /**
   * Store a tree.
   * If an identical tree already exists, return its hash.
   * Uses try/catch to handle concurrent create conflicts.
   */
  async storeTree(entries: TreeEntryData[]): Promise<string> {
    const hash = computeTreeHash(entries);

    // Check if it already exists
    const existing = await prisma.tree.findUnique({
      where: { hash },
    });

    if (existing) {
      return hash;
    }

    // Create Tree and TreeEntry records.
    // Use try/catch for concurrent conflicts (multiple requests creating the same tree).
    try {
      await prisma.tree.create({
        data: {
          hash,
          entries: {
            create: entries.map((e) => ({
              name: e.name,
              type: e.type,
              targetHash: e.hash,
              mode: e.mode,
            })),
          },
        },
      });
    } catch (error) {
      // If it's a unique constraint conflict (P2002), another request already created it; ignore.
      if (
        error instanceof Error &&
        "code" in error &&
        (error as { code: string }).code === "P2002"
      ) {
        // The tree was created by another concurrent request; return the hash.
        return hash;
      }
      throw error;
    }

    return hash;
  }

  /**
   * Get all entries of a tree.
   */
  async getTreeEntries(treeHash: string): Promise<TreeEntryData[]> {
    const entries = await prisma.treeEntry.findMany({
      where: { treeHash },
    });

    return entries.map((e) => ({
      name: e.name,
      type: e.type as "blob" | "tree",
      hash: e.targetHash,
      mode: e.mode,
    }));
  }

  /**
   * Build a tree from the project's current files.
   * Recursively walks the project directory and builds a Merkle Tree.
   */
  async buildTreeFromProject(projectId: string): Promise<{
    rootTreeHash: string;
    fileCount: number;
    totalSize: number;
  }> {
    const storage = await getStorage();
    const prefix = StoragePaths.projectPrefix(projectId);

    // List all project files
    const files = await storage.list(prefix);

    // Filter out hidden files and .gitkeep
    const validFiles = files.filter((f) => {
      const relativePath = f.key.substring(prefix.length);
      const filename = relativePath.split("/").pop() || "";
      return !filename.startsWith(".") && filename !== ".gitkeep";
    });

    if (validFiles.length === 0) {
      throw new Error("NO_FILES_TO_SAVE");
    }

    // Build directory structure
    interface DirNode {
      files: Map<string, { hash: string; size: number }>;
      dirs: Map<string, DirNode>;
    }

    const root: DirNode = { files: new Map(), dirs: new Map() };
    let fileCount = 0;
    let totalSize = 0;

    // Process each file
    for (const file of validFiles) {
      const relativePath = file.key.substring(prefix.length);
      const parts = relativePath.split("/");
      const filename = parts.pop()!;

      // Download file content
      const content = await storage.download(file.key);
      const mimeType = getMimeType(filename);

      // Store blob
      const { hash } = await this.storeBlob(content, mimeType);

      fileCount++;
      totalSize += content.length;

      // Locate directory
      let currentDir = root;
      for (const dir of parts) {
        if (!currentDir.dirs.has(dir)) {
          currentDir.dirs.set(dir, { files: new Map(), dirs: new Map() });
        }
        currentDir = currentDir.dirs.get(dir)!;
      }

      // Add file
      currentDir.files.set(filename, { hash, size: content.length });
    }

    // Recursively build tree
    const buildTree = async (node: DirNode): Promise<string> => {
      const entries: TreeEntryData[] = [];

      // Add file entries
      for (const [name, { hash }] of node.files) {
        entries.push({
          name,
          type: "blob",
          hash,
          mode: 644,
        });
      }

      // Add subdirectory entries
      for (const [name, subDir] of node.dirs) {
        const subTreeHash = await buildTree(subDir);
        entries.push({
          name,
          type: "tree",
          hash: subTreeHash,
          mode: 755,
        });
      }

      return this.storeTree(entries);
    };

    const rootTreeHash = await buildTree(root);

    return { rootTreeHash, fileCount, totalSize };
  }

  /**
   * Create a version (commit).
   */
  async createCommit(
    projectId: string,
    name: string,
    userId: string,
    description?: string
  ): Promise<{
    id: string;
    rootTreeHash: string;
    fileCount: number;
    totalSize: number;
  }> {
    // Get parent version
    const parentVersion = await prisma.projectVersion.findFirst({
      where: { projectId, rootTreeHash: { not: null } },
      orderBy: { createdAt: "desc" },
    });

    // Build tree
    const { rootTreeHash, fileCount, totalSize } = await this.buildTreeFromProject(projectId);

    // Check for changes
    if (parentVersion?.rootTreeHash === rootTreeHash) {
      throw new Error("NO_CHANGES_DETECTED");
    }

    // Create version record
    const version = await prisma.projectVersion.create({
      data: {
        projectId,
        name,
        description,
        userId,
        rootTreeHash,
        parentHash: parentVersion?.id,
        fileCount,
        totalSize,
      },
    });

    return {
      id: version.id,
      rootTreeHash,
      fileCount,
      totalSize,
    };
  }

  /**
   * Restore a version.
   * Restores project files to the state of the specified version.
   */
  async restoreCommit(projectId: string, versionId: string): Promise<number> {
    const version = await prisma.projectVersion.findUnique({
      where: { id: versionId, projectId },
    });

    if (!version) {
      throw new Error("VERSION_NOT_FOUND");
    }

    if (!version.rootTreeHash) {
      throw new Error("VERSION_FORMAT_UNSUPPORTED");
    }

    const storage = await getStorage();
    const projectPrefix = StoragePaths.projectPrefix(projectId);

    // Delete current project files (keep hidden files)
    const currentFiles = await storage.list(projectPrefix);
    for (const file of currentFiles) {
      const filename = file.key.split("/").pop() || "";
      if (!filename.startsWith(".")) {
        await storage.delete(file.key);
      }
    }

    // Restore files recursively
    const restoreTree = async (treeHash: string, basePath: string): Promise<number> => {
      const entries = await this.getTreeEntries(treeHash);
      let count = 0;

      for (const entry of entries) {
        const fullPath = basePath ? `${basePath}/${entry.name}` : entry.name;

        if (entry.type === "blob") {
          // Restore file
          const content = await this.downloadBlob(entry.hash);
          const key = StoragePaths.projectFile(projectId, fullPath);
          await storage.upload(key, content);
          count++;
        } else {
          // Restore subdirectory recursively
          count += await restoreTree(entry.hash, fullPath);
        }
      }

      return count;
    };

    return restoreTree(version.rootTreeHash, "");
  }

  /**
   * Compare two trees and return file diffs.
   */
  async compareTrees(
    fromTreeHash: string | null,
    toTreeHash: string | null,
    basePath: string = ""
  ): Promise<FileDiff[]> {
    const diffs: FileDiff[] = [];

    // Get entries of both trees
    const fromEntries = fromTreeHash
      ? await this.getTreeEntries(fromTreeHash)
      : [];
    const toEntries = toTreeHash
      ? await this.getTreeEntries(toTreeHash)
      : [];

    // Build maps
    const fromMap = new Map(fromEntries.map((e) => [e.name, e]));
    const toMap = new Map(toEntries.map((e) => [e.name, e]));

    // Walk entries from "from" tree
    for (const [name, fromEntry] of fromMap) {
      const fullPath = basePath ? `${basePath}/${name}` : name;
      const toEntry = toMap.get(name);

      if (!toEntry) {
        // Removed
        if (fromEntry.type === "blob") {
          diffs.push({
            filePath: fullPath,
            status: "removed",
            oldHash: fromEntry.hash,
          });
        } else {
          // Recursively handle removed directory
          const subDiffs = await this.compareTrees(fromEntry.hash, null, fullPath);
          diffs.push(...subDiffs);
        }
      } else if (fromEntry.hash !== toEntry.hash) {
        // Modified
        if (fromEntry.type === "blob" && toEntry.type === "blob") {
          diffs.push({
            filePath: fullPath,
            status: "modified",
            oldHash: fromEntry.hash,
            newHash: toEntry.hash,
          });
        } else if (fromEntry.type === "tree" && toEntry.type === "tree") {
          // Recursively compare subdirectories
          const subDiffs = await this.compareTrees(
            fromEntry.hash,
            toEntry.hash,
            fullPath
          );
          diffs.push(...subDiffs);
        } else {
          // Type changed (file ↔ directory)
          if (fromEntry.type === "blob") {
            diffs.push({
              filePath: fullPath,
              status: "removed",
              oldHash: fromEntry.hash,
            });
          } else {
            const subDiffs = await this.compareTrees(fromEntry.hash, null, fullPath);
            diffs.push(...subDiffs);
          }
          if (toEntry.type === "blob") {
            diffs.push({
              filePath: fullPath,
              status: "added",
              newHash: toEntry.hash,
            });
          } else {
            const subDiffs = await this.compareTrees(null, toEntry.hash, fullPath);
            diffs.push(...subDiffs);
          }
        }
      }
      // If hashes match, there is no change; skip.
    }

    // Walk entries newly added in "to" tree
    for (const [name, toEntry] of toMap) {
      if (!fromMap.has(name)) {
        const fullPath = basePath ? `${basePath}/${name}` : name;
        if (toEntry.type === "blob") {
          diffs.push({
            filePath: fullPath,
            status: "added",
            newHash: toEntry.hash,
          });
        } else {
          // Recursively handle added directory
          const subDiffs = await this.compareTrees(null, toEntry.hash, fullPath);
          diffs.push(...subDiffs);
        }
      }
    }

    return diffs;
  }

  /**
   * Compute a line-level diff.
   *
   * Note: For large files (more than MAX_DIFF_LINES), detailed diff is skipped to avoid performance issues.
   */
  computeLineDiff(oldContent: string | null, newContent: string | null): DiffLine[] {
    // Large-file threshold: do not compute detailed diff above this line count
    const MAX_DIFF_LINES = 5000;

    if (oldContent === null && newContent === null) {
      return [];
    }

    if (oldContent === null) {
      // New file
      const lines = newContent!.split("\n");
      if (lines.length > MAX_DIFF_LINES) {
        return [{
          type: "added" as const,
          content: `[File too large: ${lines.length} lines - diff skipped]`,
          newLineNumber: 1,
        }];
      }
      return lines.map((line, i) => ({
        type: "added" as const,
        content: line,
        newLineNumber: i + 1,
      }));
    }

    if (newContent === null) {
      // Deleted file
      const lines = oldContent.split("\n");
      if (lines.length > MAX_DIFF_LINES) {
        return [{
          type: "removed" as const,
          content: `[File too large: ${lines.length} lines - diff skipped]`,
          oldLineNumber: 1,
        }];
      }
      return lines.map((line, i) => ({
        type: "removed" as const,
        content: line,
        oldLineNumber: i + 1,
      }));
    }

    // Compute diff using LCS
    const oldLines = oldContent.split("\n");
    const newLines = newContent.split("\n");

    // Large-file guard: skip detailed diff
    if (oldLines.length > MAX_DIFF_LINES || newLines.length > MAX_DIFF_LINES) {
      return [{
        type: "unchanged" as const,
        content: `[File too large: ${Math.max(oldLines.length, newLines.length)} lines - diff skipped]`,
      }];
    }
    const lcs = this.computeLCS(oldLines, newLines);
    const result: DiffLine[] = [];

    let oldIdx = 0;
    let newIdx = 0;

    for (const match of lcs) {
      // Add lines removed from old version
      while (oldIdx < match.oldIndex) {
        result.push({
          type: "removed",
          content: oldLines[oldIdx],
          oldLineNumber: oldIdx + 1,
        });
        oldIdx++;
      }

      // Add lines added in new version
      while (newIdx < match.newIndex) {
        result.push({
          type: "added",
          content: newLines[newIdx],
          newLineNumber: newIdx + 1,
        });
        newIdx++;
      }

      // Add unchanged line
      result.push({
        type: "unchanged",
        content: oldLines[oldIdx],
        oldLineNumber: oldIdx + 1,
        newLineNumber: newIdx + 1,
      });

      oldIdx++;
      newIdx++;
    }

    // Handle remaining lines
    while (oldIdx < oldLines.length) {
      result.push({
        type: "removed",
        content: oldLines[oldIdx],
        oldLineNumber: oldIdx + 1,
      });
      oldIdx++;
    }

    while (newIdx < newLines.length) {
      result.push({
        type: "added",
        content: newLines[newIdx],
        newLineNumber: newIdx + 1,
      });
      newIdx++;
    }

    return result;
  }

  /**
   * Compute the Longest Common Subsequence (LCS).
   */
  private computeLCS(
    oldLines: string[],
    newLines: string[]
  ): Array<{ oldIndex: number; newIndex: number }> {
    const m = oldLines.length;
    const n = newLines.length;

    // Build DP table
    const dp: number[][] = Array(m + 1)
      .fill(null)
      .map(() => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (oldLines[i - 1] === newLines[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    // Backtrack to recover LCS
    const result: Array<{ oldIndex: number; newIndex: number }> = [];
    let i = m;
    let j = n;

    while (i > 0 && j > 0) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        result.unshift({ oldIndex: i - 1, newIndex: j - 1 });
        i--;
        j--;
      } else if (dp[i - 1][j] > dp[i][j - 1]) {
        i--;
      } else {
        j--;
      }
    }

    return result;
  }

  /**
   * Garbage collection: delete blobs with refCount = 0 and unreferenced trees.
   */
  async garbageCollect(): Promise<GarbageCollectResult> {
    const storage = await getStorage();
    const result: GarbageCollectResult = {
      deletedBlobCount: 0,
      deletedTreeCount: 0,
      freedBytes: 0,
      errors: [],
    };

    // 1) Clean up orphaned blobs (refCount = 0)
    const orphanedBlobs = await prisma.blob.findMany({
      where: { refCount: { lte: 0 } },
    });

    for (const blob of orphanedBlobs) {
      try {
        // Delete from object storage
        const key = StoragePaths.blob(blob.hash);
        await storage.delete(key);

        // Delete from database
        await prisma.blob.delete({
          where: { hash: blob.hash },
        });

        result.deletedBlobCount++;
        result.freedBytes += blob.size;
      } catch (error) {
        result.errors.push(
          `Failed to delete blob ${blob.hash}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // 2) Clean up orphaned trees (not referenced by any version or other tree)
    // Get all trees directly referenced by versions
    const referencedByVersions = await prisma.projectVersion.findMany({
      where: { rootTreeHash: { not: null } },
      select: { rootTreeHash: true },
    });
    const versionTreeHashes = new Set(
      referencedByVersions.map((v) => v.rootTreeHash).filter(Boolean) as string[]
    );

    // Get all trees referenced by other TreeEntry records
    const referencedByEntries = await prisma.treeEntry.findMany({
      where: { type: "tree" },
      select: { targetHash: true },
    });
    const entryTreeHashes = new Set(referencedByEntries.map((e) => e.targetHash));

    // All referenced trees
    const referencedTreeHashes = new Set([...versionTreeHashes, ...entryTreeHashes]);

    // Fetch all trees
    const allTrees = await prisma.tree.findMany({
      select: { hash: true },
    });

    // Find orphaned trees
    const orphanedTrees = allTrees.filter((t) => !referencedTreeHashes.has(t.hash));

    for (const tree of orphanedTrees) {
      try {
        // Delete tree (cascades to delete TreeEntry)
        await prisma.tree.delete({
          where: { hash: tree.hash },
        });
        result.deletedTreeCount++;
      } catch (error) {
        result.errors.push(
          `Failed to delete tree ${tree.hash}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    return result;
  }

  /**
   * Get all files from a tree (recursive expansion).
   * Optimization: first collect all files recursively, then batch-query blob info to avoid N+1 queries.
   */
  async getTreeFiles(
    treeHash: string,
    basePath: string = ""
  ): Promise<Array<{ path: string; hash: string; size?: number }>> {
    // Step 1: recursively collect all file paths and hashes (no DB reads)
    const collectFiles = async (
      hash: string,
      base: string
    ): Promise<Array<{ path: string; hash: string }>> => {
      const entries = await this.getTreeEntries(hash);
      const result: Array<{ path: string; hash: string }> = [];

      for (const entry of entries) {
        const fullPath = base ? `${base}/${entry.name}` : entry.name;

        if (entry.type === "blob") {
          result.push({ path: fullPath, hash: entry.hash });
        } else {
          // Recursively collect subdirectory files
          const subFiles = await collectFiles(entry.hash, fullPath);
          result.push(...subFiles);
        }
      }

      return result;
    };

    const files = await collectFiles(treeHash, basePath);

    if (files.length === 0) {
      return [];
    }

    // Step 2: batch-query blob sizes
    const uniqueHashes = [...new Set(files.map((f) => f.hash))];
    const blobs = await prisma.blob.findMany({
      where: { hash: { in: uniqueHashes } },
      select: { hash: true, size: true },
    });

    // Build hash -> size map
    const sizeMap = new Map(blobs.map((b) => [b.hash, b.size]));

    // Step 3: assemble result
    return files.map((f) => ({
      path: f.path,
      hash: f.hash,
      size: sizeMap.get(f.hash),
    }));
  }
}

// Export singleton instance
export const merkleService = new MerkleService();
