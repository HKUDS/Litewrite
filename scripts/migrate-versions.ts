/**
 * Version migration script.
 *
 * Migrates old version formats (tar.gz and FileSnapshot) to the new Merkle Tree format.
 *
 * Usage:
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/migrate-versions.ts
 *
 * Or add --dry-run to preview:
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/migrate-versions.ts --dry-run
 */

import { PrismaClient } from "@prisma/client";
import { createHash } from "crypto";

const prisma = new PrismaClient();

// CLI args
const isDryRun = process.argv.includes("--dry-run");

// Stats
const stats = {
  totalVersions: 0,
  migratedVersions: 0,
  skippedVersions: 0,
  errors: 0,
  newBlobs: 0,
  reusedBlobs: 0,
  newTrees: 0,
};

/**
 * Compute SHA-256 hash for content.
 */
function computeHash(content: Buffer | string): string {
  const hash = createHash("sha256");
  hash.update(content);
  return hash.digest("hex");
}

/**
 * Compute Tree hash.
 */
function computeTreeHash(
  entries: Array<{ name: string; type: string; hash: string; mode: number }>
): string {
  const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
  const content = sorted
    .map((e) => `${e.mode} ${e.type} ${e.hash} ${e.name}`)
    .join("\n");
  return computeHash(content);
}

/**
 * Store a Blob (deduped; uses upsert for concurrency safety).
 */
async function storeBlob(
  hash: string,
  content: Buffer,
  mimeType?: string
): Promise<boolean> {
  if (isDryRun) {
    // Dry-run: only check whether it exists
    const existing = await prisma.blob.findUnique({ where: { hash } });
    if (existing) {
      stats.reusedBlobs++;
      return false;
    }
    stats.newBlobs++;
    return true;
  }

  // Use upsert to guarantee atomicity
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

  // Determine whether it was newly created or reused
  const isNew = result.refCount === 1;

  if (isNew) {
    // Upload to storage (requires dynamic import)
    const { getStorage, StoragePaths } = await import("../lib/storage");
    const storage = await getStorage();
    const key = StoragePaths.blob(hash);

    // Check whether it already exists in storage (upload may have failed previously)
    const storageExists = await storage.exists(key);
    if (!storageExists) {
      await storage.upload(key, content, mimeType);
    }

    stats.newBlobs++;
  } else {
    stats.reusedBlobs++;
  }

  return isNew;
}

/**
 * Store a Tree.
 */
async function storeTree(
  entries: Array<{ name: string; type: string; hash: string; mode: number }>
): Promise<string> {
  const hash = computeTreeHash(entries);

  const existing = await prisma.tree.findUnique({ where: { hash } });

  if (existing) {
    return hash;
  }

  if (!isDryRun) {
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
  }

  stats.newTrees++;
  return hash;
}

/**
 * Build a Tree from a file list.
 */
async function buildTreeFromFiles(
  files: Map<string, Buffer>
): Promise<string> {
  // Build directory structure
  interface DirNode {
    files: Map<string, { hash: string; size: number }>;
    dirs: Map<string, DirNode>;
  }

  const root: DirNode = { files: new Map(), dirs: new Map() };

  // Get MIME type
  const { getMimeType } = await import("../lib/storage");

  // Process each file
  for (const [filePath, content] of files) {
    const parts = filePath.split("/");
    const filename = parts.pop()!;
    const hash = computeHash(content);
    const mimeType = getMimeType(filename);

    // Store Blob
    await storeBlob(hash, content, mimeType);

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

  // Recursively build Tree
  const buildTree = async (node: DirNode): Promise<string> => {
    const entries: Array<{
      name: string;
      type: string;
      hash: string;
      mode: number;
    }> = [];

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

    return storeTree(entries);
  };

  return buildTree(root);
}

/**
 * Migrate a single version.
 */
async function migrateVersion(
  version: {
    id: string;
    projectId: string;
    name: string;
    snapshotKey: string | null;
    rootTreeHash: string | null;
    snapshots: Array<{ filePath: string; content: string }>;
  }
): Promise<void> {
  // Already new format; skip
  if (version.rootTreeHash) {
    console.log(`  Skipping ${version.id} (${version.name}) - already in new format`);
    stats.skippedVersions++;
    return;
  }

  console.log(`  Migrating ${version.id} (${version.name})...`);

  let files: Map<string, Buffer>;

  if (version.snapshotKey) {
    // Extract from tar.gz
    try {
      const { downloadSnapshot } = await import("../lib/storage/snapshot");
      files = await downloadSnapshot(version.projectId, version.id);
    } catch (error) {
      console.error(`    Error: failed to download snapshot ${version.snapshotKey}`, error);
      stats.errors++;
      return;
    }
  } else if (version.snapshots.length > 0) {
    // Read from database
    files = new Map();
    for (const snapshot of version.snapshots) {
      files.set(snapshot.filePath, Buffer.from(snapshot.content, "utf8"));
    }
  } else {
    console.log(`    Skipping - no file data`);
    stats.skippedVersions++;
    return;
  }

  if (files.size === 0) {
    console.log(`    Skipping - empty file list`);
    stats.skippedVersions++;
    return;
  }

  // Build Merkle Tree
  const rootTreeHash = await buildTreeFromFiles(files);

  // Update version record
  if (!isDryRun) {
    await prisma.projectVersion.update({
      where: { id: version.id },
      data: {
        rootTreeHash,
        fileCount: files.size,
        totalSize: Array.from(files.values()).reduce(
          (sum, buf) => sum + buf.length,
          0
        ),
      },
    });
  }

  console.log(`    Done - rootTreeHash: ${rootTreeHash.substring(0, 12)}...`);
  stats.migratedVersions++;
}

/**
 * Main entry.
 */
async function main() {
  console.log("=".repeat(60));
  console.log("Version migration - migrate legacy versions to Merkle Tree format");
  console.log("=".repeat(60));

  if (isDryRun) {
    console.log("\n⚠️  DRY RUN - no data will be written\n");
  }

  // Fetch all versions
  const versions = await prisma.projectVersion.findMany({
    include: {
      snapshots: {
        select: { filePath: true, content: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  stats.totalVersions = versions.length;
  console.log(`\nFound ${versions.length} version(s)\n`);

  // Group by project
  const versionsByProject = new Map<string, typeof versions>();
  for (const version of versions) {
    const list = versionsByProject.get(version.projectId) || [];
    list.push(version);
    versionsByProject.set(version.projectId, list);
  }

  // Migrate each project
  for (const [projectId, projectVersions] of versionsByProject) {
    console.log(`\nProject ${projectId}:`);

    for (const version of projectVersions) {
      try {
        await migrateVersion(version);
      } catch (error) {
        console.error(`  Error: ${version.id}`, error);
        stats.errors++;
      }
    }
  }

  // Print stats
  console.log("\n" + "=".repeat(60));
  console.log("Migration summary:");
  console.log("=".repeat(60));
  console.log(`Total versions:  ${stats.totalVersions}`);
  console.log(`Migrated:        ${stats.migratedVersions}`);
  console.log(`Skipped:         ${stats.skippedVersions}`);
  console.log(`Errors:          ${stats.errors}`);
  console.log(`New blobs:       ${stats.newBlobs}`);
  console.log(`Reused blobs:    ${stats.reusedBlobs}`);
  console.log(`New trees:       ${stats.newTrees}`);
  console.log("=".repeat(60));

  if (isDryRun) {
    console.log("\n⚠️  This is DRY RUN. Remove --dry-run to perform the actual migration.\n");
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
