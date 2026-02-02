/**
 * Data migration script: local filesystem -> S3/MinIO.
 *
 * Usage:
 *   npx ts-node scripts/migrate-to-s3.ts [--dry-run] [--projects] [--avatars] [--templates] [--versions]
 *
 * Args:
 *   --dry-run    Check only; do not actually migrate
 *   --projects   Migrate project files only
 *   --avatars    Migrate user avatars only
 *   --templates  Migrate template files only
 *   --versions   Migrate version snapshots only
 *   (If omitted, migrate everything)
 *
 * Environment variables:
 *   STORAGE_PROVIDER=s3
 *   S3_ENDPOINT=http://localhost:9000
 *   S3_BUCKET=litewrite
 *   S3_ACCESS_KEY_ID=minioadmin
 *   S3_SECRET_ACCESS_KEY=minioadmin
 *   S3_FORCE_PATH_STYLE=true
 */

import { promises as fs } from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

// Dynamically import storage modules
async function getStorageModule() {
  // Force S3 storage
  process.env.STORAGE_PROVIDER = "s3";
  const { getStorage, StoragePaths, getMimeType } = await import("../lib/storage");
  const { uploadSnapshot } = await import("../lib/storage/snapshot");
  return { getStorage, StoragePaths, getMimeType, uploadSnapshot };
}

const prisma = new PrismaClient();

// CLI args parsing
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const migrateProjects = args.includes("--projects") || !args.some(a => a.startsWith("--") && a !== "--dry-run");
const migrateAvatars = args.includes("--avatars") || !args.some(a => a.startsWith("--") && a !== "--dry-run");
const migrateTemplates = args.includes("--templates") || !args.some(a => a.startsWith("--") && a !== "--dry-run");
const migrateVersions = args.includes("--versions") || !args.some(a => a.startsWith("--") && a !== "--dry-run");

// Local paths
const PROJECTS_DIR = process.env.PROJECTS_DIR || path.join(process.cwd(), "projects");
const AVATARS_DIR = path.join(process.cwd(), "public", "avatars");
const TEMPLATES_DIR = path.join(process.cwd(), "templates");

// Stats
const stats = {
  projects: { total: 0, migrated: 0, skipped: 0, failed: 0 },
  avatars: { total: 0, migrated: 0, skipped: 0, failed: 0 },
  templates: { total: 0, migrated: 0, skipped: 0, failed: 0 },
  versions: { total: 0, migrated: 0, skipped: 0, failed: 0 },
  files: { total: 0, migrated: 0, bytes: 0 },
};

/**
 * Recursively read all files within a directory.
 */
async function readDirRecursive(
  dirPath: string,
  prefix: string = ""
): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

      // Skip hidden files and directories
      if (entry.name.startsWith(".")) {
        continue;
      }

      if (entry.isDirectory()) {
        const subFiles = await readDirRecursive(fullPath, relativePath);
        subFiles.forEach((content, path) => files.set(path, content));
      } else if (entry.isFile()) {
        const content = await fs.readFile(fullPath);
        files.set(relativePath, content);
      }
    }
  } catch (error) {
    // Directory does not exist
  }

  return files;
}

/**
 * Migrate project files.
 */
async function migrateProjectFiles() {
  if (!migrateProjects) return;

  console.log("\n📁 Migrating project files...\n");

  const { getStorage, StoragePaths, getMimeType } = await getStorageModule();
  const storage = await getStorage();

  // Fetch all projects
  const projects = await prisma.project.findMany({
    select: { id: true, name: true },
  });

  stats.projects.total = projects.length;

  for (const project of projects) {
    const projectDir = path.join(PROJECTS_DIR, project.id);

    try {
      // Check whether local directory exists
      await fs.access(projectDir);
    } catch {
      console.log(`  ⏭️  Skipping ${project.name} (${project.id}) - local directory not found`);
      stats.projects.skipped++;
      continue;
    }

    try {
      // Read all files
      const files = await readDirRecursive(projectDir);

      if (files.size === 0) {
        console.log(`  ⏭️  Skipping ${project.name} (${project.id}) - no files`);
        stats.projects.skipped++;
        continue;
      }

      console.log(`  📤 ${project.name} (${project.id}): ${files.size} file(s)`);

      if (!dryRun) {
        for (const [filePath, content] of files) {
          const key = StoragePaths.projectFile(project.id, filePath);
          await storage.upload(key, content, getMimeType(filePath));
          stats.files.migrated++;
          stats.files.bytes += content.length;
        }
      }

      stats.files.total += files.size;
      stats.projects.migrated++;
      console.log(`  ✅ ${project.name} migration completed`);
    } catch (error) {
      console.error(`  ❌ ${project.name} migration failed:`, error);
      stats.projects.failed++;
    }
  }
}

/**
 * Migrate compiled artifacts.
 */
async function migrateCompiledFiles() {
  if (!migrateProjects) return;

  console.log("\n📄 Migrating compiled artifacts...\n");

  const { getStorage, StoragePaths, getMimeType } = await getStorageModule();
  const storage = await getStorage();

  // Fetch all projects
  const projects = await prisma.project.findMany({
    select: { id: true, name: true },
  });

  for (const project of projects) {
    const compiledDir = path.join(PROJECTS_DIR, project.id, ".compiled");

    try {
      await fs.access(compiledDir);
    } catch {
      continue; // No compiled artifacts; skip
    }

    try {
      const files = await readDirRecursive(compiledDir);

      if (files.size === 0) continue;

      console.log(`  📤 ${project.name}: ${files.size} compiled file(s)`);

      if (!dryRun) {
        for (const [filePath, content] of files) {
          const key = StoragePaths.compiledFile(project.id, filePath);
          await storage.upload(key, content, getMimeType(filePath));
          stats.files.migrated++;
          stats.files.bytes += content.length;
        }
      }

      stats.files.total += files.size;
      console.log(`  ✅ ${project.name} compiled artifacts migration completed`);
    } catch (error) {
      console.error(`  ❌ ${project.name} compiled artifacts migration failed:`, error);
    }
  }
}

/**
 * Migrate user avatars.
 */
async function migrateAvatarFiles() {
  if (!migrateAvatars) return;

  console.log("\n🖼️  Migrating user avatars...\n");

  const { getStorage, StoragePaths } = await getStorageModule();
  const storage = await getStorage();

  try {
    await fs.access(AVATARS_DIR);
  } catch {
    console.log("  ⏭️  Avatar directory not found; skipping");
    return;
  }

  const files = await fs.readdir(AVATARS_DIR);
  const avatarFiles = files.filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f));

  stats.avatars.total = avatarFiles.length;

  for (const fileName of avatarFiles) {
    const filePath = path.join(AVATARS_DIR, fileName);
    const userId = fileName.replace(/\.[^.]+$/, "");
    const ext = fileName.split(".").pop() || "jpg";

    try {
      const content = await fs.readFile(filePath);

      console.log(`  📤 ${fileName}`);

      if (!dryRun) {
        const key = StoragePaths.avatar(userId, ext);
        await storage.upload(key, content, `image/${ext === "jpg" ? "jpeg" : ext}`);
        stats.files.migrated++;
        stats.files.bytes += content.length;
      }

      stats.files.total++;
      stats.avatars.migrated++;
    } catch (error) {
      console.error(`  ❌ ${fileName} migration failed:`, error);
      stats.avatars.failed++;
    }
  }

  console.log(`  ✅ Avatar migration completed`);
}

/**
 * Migrate template files.
 */
async function migrateTemplateFiles() {
  if (!migrateTemplates) return;

  console.log("\n📋 Migrating template files...\n");

  const { getStorage, StoragePaths, getMimeType } = await getStorageModule();
  const storage = await getStorage();

  // Fetch all templates
  const templates = await prisma.template.findMany({
    select: { id: true, name: true, filesPath: true },
  });

  stats.templates.total = templates.length;

  for (const template of templates) {
    const templateDir = path.join(TEMPLATES_DIR, template.filesPath);

    try {
      await fs.access(templateDir);
    } catch {
      console.log(`  ⏭️  Skipping ${template.name} - local directory not found`);
      stats.templates.skipped++;
      continue;
    }

    try {
      const files = await readDirRecursive(templateDir);

      if (files.size === 0) {
        console.log(`  ⏭️  Skipping ${template.name} - no files`);
        stats.templates.skipped++;
        continue;
      }

      console.log(`  📤 ${template.name}: ${files.size} file(s)`);

      if (!dryRun) {
        for (const [filePath, content] of files) {
          const key = StoragePaths.templateFile(template.filesPath, filePath);
          await storage.upload(key, content, getMimeType(filePath));
          stats.files.migrated++;
          stats.files.bytes += content.length;
        }
      }

      stats.files.total += files.size;
      stats.templates.migrated++;
      console.log(`  ✅ ${template.name} migration completed`);
    } catch (error) {
      console.error(`  ❌ ${template.name} migration failed:`, error);
      stats.templates.failed++;
    }
  }
}

/**
 * Migrate version snapshots.
 */
async function migrateVersionSnapshots() {
  if (!migrateVersions) return;

  console.log("\n📦 Migrating version snapshots...\n");

  const { uploadSnapshot } = await getStorageModule();

  // Fetch all versions without snapshotKey (i.e., older versions stored in DB)
  const versions = await prisma.projectVersion.findMany({
    where: {
      snapshotKey: null,
    },
    include: {
      snapshots: true,
      project: { select: { name: true } },
    },
  });

  stats.versions.total = versions.length;

  for (const version of versions) {
    if (version.snapshots.length === 0) {
      console.log(`  ⏭️  Skipping ${version.project.name}/${version.name} - no snapshots`);
      stats.versions.skipped++;
      continue;
    }

    try {
      // Convert snapshots to a Map
      const files = new Map<string, string>();
      for (const snapshot of version.snapshots) {
        files.set(snapshot.filePath, snapshot.content);
      }

      console.log(`  📤 ${version.project.name}/${version.name}: ${files.size} file(s)`);

      if (!dryRun) {
        // Upload to S3
        const { fileCount, totalSize } = await uploadSnapshot(
          version.projectId,
          version.id,
          files
        );

        // Update database
        await prisma.projectVersion.update({
          where: { id: version.id },
          data: {
            snapshotKey: `versions/${version.projectId}/${version.id}.tar.gz`,
            fileCount,
            totalSize,
          },
        });

        stats.files.migrated += fileCount;
        stats.files.bytes += totalSize;
      }

      stats.files.total += version.snapshots.length;
      stats.versions.migrated++;
      console.log(`  ✅ ${version.project.name}/${version.name} migration completed`);
    } catch (error) {
      console.error(`  ❌ ${version.project.name}/${version.name} migration failed:`, error);
      stats.versions.failed++;
    }
  }
}

/**
 * Print stats.
 */
function printStats() {
  console.log("\n" + "=".repeat(60));
  console.log("📊 Migration summary\n");

  if (dryRun) {
    console.log("⚠️  This is DRY RUN. No files were actually migrated.\n");
  }

  console.log(`📁 Projects: ${stats.projects.migrated}/${stats.projects.total} (skipped: ${stats.projects.skipped}, failed: ${stats.projects.failed})`);
  console.log(`🖼️  Avatars: ${stats.avatars.migrated}/${stats.avatars.total} (skipped: ${stats.avatars.skipped}, failed: ${stats.avatars.failed})`);
  console.log(`📋 Templates: ${stats.templates.migrated}/${stats.templates.total} (skipped: ${stats.templates.skipped}, failed: ${stats.templates.failed})`);
  console.log(`📦 Versions: ${stats.versions.migrated}/${stats.versions.total} (skipped: ${stats.versions.skipped}, failed: ${stats.versions.failed})`);
  console.log(`\n📄 Total files: ${stats.files.total}`);
  console.log(`📤 Migrated: ${stats.files.migrated}`);
  console.log(`💾 Data size: ${(stats.files.bytes / 1024 / 1024).toFixed(2)} MB`);

  console.log("\n" + "=".repeat(60));
}

/**
 * Main entry.
 */
async function main() {
  console.log("🚀 Litewrite storage migration tool");
  console.log("=".repeat(60));

  if (dryRun) {
    console.log("\n⚠️  DRY RUN - validate only; no files will be migrated\n");
  }

  // Validate environment variables
  const requiredEnvVars = ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"];
  const missingVars = requiredEnvVars.filter(v => !process.env[v]);

  if (missingVars.length > 0 && !dryRun) {
    console.error("❌ Missing required environment variables:", missingVars.join(", "));
    console.log("\nPlease set the following environment variables:");
    console.log("  S3_ENDPOINT=http://localhost:9000");
    console.log("  S3_BUCKET=litewrite");
    console.log("  S3_ACCESS_KEY_ID=minioadmin");
    console.log("  S3_SECRET_ACCESS_KEY=minioadmin");
    console.log("  S3_FORCE_PATH_STYLE=true");
    process.exit(1);
  }

  console.log("📌 Target configuration:");
  console.log(`  S3 endpoint: ${process.env.S3_ENDPOINT || "(not set)"}`);
  console.log(`  S3 bucket: ${process.env.S3_BUCKET || "(not set)"}`);

  try {
    await migrateProjectFiles();
    await migrateCompiledFiles();
    await migrateAvatarFiles();
    await migrateTemplateFiles();
    await migrateVersionSnapshots();

    printStats();

    if (!dryRun && stats.files.migrated > 0) {
      console.log("\n✅ Migration completed.\n");
      console.log("Next steps:");
      console.log("1. Verify files in S3");
      console.log("2. Set the STORAGE_PROVIDER=s3 environment variable");
      console.log("3. Restart the app");
      console.log("4. Test key features");
      console.log("5. If everything looks good, remove local files\n");
    }
  } catch (error) {
    console.error("\n❌ Migration error:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
