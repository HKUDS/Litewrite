/**
 * Template preview generator script.
 * Compiles each template to PDF, renders the first page as a preview image, and uploads it to storage.
 *
 * Prerequisites: Docker with the litewrite-compile image/container available.
 *
 * Run: npx tsx scripts/generate-previews.ts
 *
 * Args:
 *   --force    Regenerate all previews (ignore existing ones)
 *   --docker   Compile via Docker container (recommended; default when available)
 *   --local    Compile via local TeXLive (requires TeXLive installed locally)
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { getStorage, StoragePaths, getStorageConfig } from "@/lib/storage";

const prisma = new PrismaClient();

// Check whether Docker is available
function isDockerAvailable(): boolean {
  try {
    execSync("docker ps", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// Check whether the litewrite-compile image exists
function isCompileImageAvailable(): boolean {
  try {
    const result = execSync("docker images litewrite-compile --format '{{.Repository}}'", { encoding: "utf-8" });
    // There may be multiple lines (multiple images with the same name); any match counts.
    return result.trim().includes("litewrite-compile");
  } catch {
    return false;
  }
}

async function generatePreviews() {
  const force = process.argv.includes("--force");
  const useLocal = process.argv.includes("--local");
  const useDocker = !useLocal && (process.argv.includes("--docker") || isDockerAvailable());
  const templatesDir = path.join(process.cwd(), "templates");

  if (useDocker) {
    if (!isCompileImageAvailable()) {
      console.log("Warning: litewrite-compile Docker image not found, falling back to local compilation");
    } else {
      console.log("Using Docker container for compilation (litewrite-compile)");
    }
  } else {
    console.log("Using local TeXLive for compilation");
  }

  // Get storage config
  const storageConfig = getStorageConfig();
  const storage = await getStorage();

  console.log(`Storage provider: ${storageConfig.provider}`);
  if (force) {
    console.log("Force mode: regenerating all previews\n");
  }

  // Fetch all system templates
  const templates = await prisma.template.findMany({
    where: { source: "system" },
  });

  console.log(`Found ${templates.length} system templates\n`);

  const results = {
    generated: 0,
    skipped: 0,
    failed: 0,
  };

  for (const template of templates) {
    const templatePath = path.join(templatesDir, template.filesPath);
    const mainFile = path.join(templatePath, template.mainFile);
    const s3Key = StoragePaths.templatePreview(template.filesPath);

    // Check whether preview already exists (unless force mode)
    if (!force) {
      try {
        const exists = await storage.exists(s3Key);
        if (exists) {
          console.log(`✓ Preview exists for ${template.name}, skipping...`);
          results.skipped++;
          continue;
        }
      } catch {
        // If existence check fails, continue generating
      }
    }

    // Check whether the main file exists
    if (!fs.existsSync(mainFile)) {
      console.log(`✗ [ERROR] Main file not found: ${template.mainFile} for ${template.name}`);
      results.failed++;
      continue;
    }

    console.log(`Generating preview for ${template.name}...`);

    try {
      // Create temp directory
      const tempDir = path.join(process.cwd(), "tmp", `preview-${Date.now()}`);
      fs.mkdirSync(tempDir, { recursive: true });

      // Copy template files into the temp directory (including subdirectories)
      copyDirRecursive(templatePath, tempDir);

      // Compile LaTeX
      const mainFileName = path.basename(template.mainFile, ".tex");
      let compilationSuccess = false;

      // Use stdio: ignore to avoid output buffer overflow
      const execOptions = { cwd: tempDir, timeout: 120000, stdio: "ignore" as const };

      // Read main file content to determine which compiler to use
      const texContent = fs.readFileSync(path.join(tempDir, template.mainFile), "utf-8");

      // Detect whether xelatex is needed (CJK templates, fontspec usage, special CV classes, etc.)
      const needsXelatex = /\\documentclass.*\{(thuthesis|pkuthss|fduthesis|hithesis|hustthesis|njuthesis|sysuthesis|uestcthesis|cquthesis|sduthesis|seuthesis|sjtuthesis|ustcthesis|zjuthesis|buaathesis|xjtuthesis|tongjithesis|whu-thesis|ctex|ctexart|ctexrep|ctexbook|awesome-cv|Dissertate|altacv)\}|\\usepackage.*\{(fontspec|xeCJK|ctex)\}|%!TEX.*program.*=.*xelatex/i.test(texContent);

      const compiler = needsXelatex ? "xelatex" : "pdflatex";

      // Build compile command
      const buildCompileCmd = (comp: string, shellEscape: boolean = false) => {
        const escapeFlag = shellEscape ? "-shell-escape" : "--no-shell-escape";
        if (useDocker && isCompileImageAvailable()) {
          // Compile via Docker container
          return `docker run --rm -v "${tempDir}:/work" -w /work litewrite-compile ${comp} -interaction=nonstopmode ${escapeFlag} ${template.mainFile}`;
        } else {
          // Compile via local TeXLive
          return `${comp} -interaction=nonstopmode ${escapeFlag} ${template.mainFile}`;
        }
      };

      const compileCmd = buildCompileCmd(compiler, false);
      const compileCmdWithShellEscape = buildCompileCmd(compiler, true);

      // Try compiling (ignore exit code; only check whether the PDF is generated)
      try {
        // First pass
        execSync(compileCmd, execOptions);
      } catch {
        // Try shell-escape (some templates may require it)
        try {
          execSync(compileCmdWithShellEscape, execOptions);
        } catch {
          // Ignore compile errors; we'll check PDF existence later
        }
      }

      try {
        // Second pass to ensure cross-references are correct
        execSync(compileCmd, execOptions);
      } catch {
        try {
          execSync(compileCmdWithShellEscape, execOptions);
        } catch {
          // Ignore
        }
      }

      // If there are bibliographies, run bibtex and recompile
      const bibFiles = fs.readdirSync(tempDir).filter(f => f.endsWith(".bib"));
      if (bibFiles.length > 0) {
        try {
          const bibtexCmd = useDocker && isCompileImageAvailable()
            ? `docker run --rm -v "${tempDir}:/work" -w /work litewrite-compile bibtex ${mainFileName}`
            : `bibtex ${mainFileName}`;
          execSync(bibtexCmd, execOptions);
          execSync(buildCompileCmd(compiler), execOptions);
          execSync(buildCompileCmd(compiler), execOptions);
        } catch {
          // BibTeX failure shouldn't block the main flow
        }
      }

      const pdfPath = path.join(tempDir, `${mainFileName}.pdf`);
      compilationSuccess = fs.existsSync(pdfPath);

      // If the PDF is missing, try draft mode
      if (!compilationSuccess) {
        console.log(`  PDF not generated, trying draft mode...`);
        try {
          const draftContent = texContent.replace("\\documentclass", "\\documentclass[draft]");
          fs.writeFileSync(path.join(tempDir, template.mainFile), draftContent);
          execSync(buildCompileCmd(compiler), execOptions);
          compilationSuccess = fs.existsSync(pdfPath);
        } catch {
          // Ignore
        }
      }

      if (compilationSuccess) {
        // Use pdftoppm to convert the first page to PNG
        try {
          execSync(
            `pdftoppm -png -f 1 -l 1 -r 150 -singlefile "${pdfPath}" "${path.join(tempDir, "preview")}"`,
            { stdio: "ignore" }
          );

          const tempPreview = path.join(tempDir, "preview.png");
          if (fs.existsSync(tempPreview)) {
            // Read preview image and upload it
            const previewBuffer = fs.readFileSync(tempPreview);
            await storage.upload(s3Key, previewBuffer, "image/png");

            // Update the preview URL in the database (via API route)
            const thumbnailUrl = `/api/templates/preview/${template.filesPath}`;
            await prisma.template.update({
              where: { id: template.id },
              data: { thumbnailUrl },
            });

            console.log(`  ✓ Generated and uploaded preview for ${template.name}`);
            results.generated++;
          } else {
          console.log(`  ✗ [ERROR] Preview file not created for ${template.name}`);
          results.failed++;
          }
        } catch (error) {
          console.log(`  ✗ [ERROR] Failed to convert PDF to image for ${template.name}`);
          results.failed++;
        }
      } else {
        console.log(`  ✗ [ERROR] PDF not generated for ${template.name} (compiler: ${compiler})`);
        results.failed++;
      }

      // Clean up temp directory
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (error) {
      console.error(`  Error processing ${template.name}:`, error);
      results.failed++;
    }
  }

  console.log("\n========================================");
  console.log("Preview generation completed!");
  console.log(`  Generated: ${results.generated}`);
  console.log(`  Skipped: ${results.skipped}`);
  console.log(`  Failed: ${results.failed}`);
  console.log("========================================");
}

/**
 * Recursively copy a directory.
 */
function copyDirRecursive(src: string, dest: string) {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Run script directly
generatePreviews()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

export { generatePreviews };
