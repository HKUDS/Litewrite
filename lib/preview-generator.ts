/**
 * Async template preview generation service.
 *
 * Responsibilities:
 * 1. Download template files from storage
 * 2. Call the compile service to generate a PDF
 * 3. Use the compile service to convert the PDF to PNG
 * 4. Upload the preview image to storage
 * 5. Update the database thumbnailUrl
 *
 * Design:
 * - Runs asynchronously to avoid blocking API responses
 * - Fails silently (frontend uses a placeholder image)
 */

import { prisma } from "@/lib/prisma";
import { getStorage, StoragePaths, getMimeType } from "@/lib/storage";
import { VALID_COMPILERS, inferTemplateCompilerFromTex, Compiler } from "@/lib/compiler-utils";

const COMPILE_SERVER_URL = process.env.COMPILE_SERVER_URL || "http://localhost:3002";

interface GeneratePreviewOptions {
  templateId: string;  // Template ID in the database
  filesPath: string;   // Template files path (storage prefix)
  mainFile: string;    // Main file name
}

/**
 * Generate a template preview asynchronously.
 * Does not block the caller; failures are handled silently.
 */
export async function generateTemplatePreviewAsync(options: GeneratePreviewOptions): Promise<void> {
  // Use setImmediate to ensure asynchronous execution
  setImmediate(async () => {
    try {
      await generateTemplatePreview(options);
    } catch (error) {
      console.error(`[Preview] Failed to generate preview for ${options.filesPath}:`, error);
      // Swallow errors; the frontend will show a placeholder image
    }
  });
}

/**
 * Generate a template preview (internal).
 */
async function generateTemplatePreview(options: GeneratePreviewOptions): Promise<void> {
  const { templateId, filesPath, mainFile } = options;

  console.log(`[Preview] Starting preview generation for ${filesPath}...`);

  const storage = await getStorage();

  // 1) Download template files from storage
  const templatePrefix = StoragePaths.templatePrefix(filesPath);
  const fileList = await storage.list(templatePrefix);

  if (fileList.length === 0) {
    throw new Error(`No files found for template ${filesPath}`);
  }

  // Build projectFiles and binaryFiles objects
  const projectFiles: Record<string, string> = {};
  const binaryFiles: Record<string, string> = {};

  for (const file of fileList) {
    const relativePath = file.key.replace(templatePrefix, "");
    if (!relativePath) continue;

    try {
      const content = await storage.download(file.key);
      const mimeType = getMimeType(relativePath);

      // Detect whether this is a binary file
      if (isBinaryFile(relativePath, mimeType)) {
        // Binary files are base64-encoded
        binaryFiles[relativePath] = content.toString("base64");
      } else {
        // Text files are stored as strings
        projectFiles[relativePath] = content.toString("utf-8");
      }
    } catch (error) {
      console.log(`[Preview] Failed to download ${relativePath}, skipping...`);
    }
  }

  if (!projectFiles[mainFile]) {
    throw new Error(`Main file ${mainFile} not found in template`);
  }

  console.log(`[Preview] Downloaded ${Object.keys(projectFiles).length} text files, ${Object.keys(binaryFiles).length} binary files`);

  // 1.5 Read template default compiler from DB (backward-compatible: infer if missing)
  let compiler = "pdflatex";
  try {
    const template = await prisma.template.findUnique({
      where: { id: templateId },
      select: { defaultCompiler: true },
    });
    if (template?.defaultCompiler && VALID_COMPILERS.has(template.defaultCompiler as Compiler)) {
      compiler = template.defaultCompiler;
    } else {
      compiler = inferTemplateCompilerFromTex(projectFiles[mainFile]);
    }
  } catch {
    // Fallback to inference if DB read fails
    compiler = inferTemplateCompilerFromTex(projectFiles[mainFile]);
  }

  // 2) Call compile service to generate PDF
  const compileResponse = await fetch(`${COMPILE_SERVER_URL}/compile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mainFile,
      compiler,
      projectFiles,
      binaryFiles,
    }),
  });

  if (!compileResponse.ok) {
    throw new Error(`Compile service returned ${compileResponse.status}`);
  }

  const compileResult = await compileResponse.json();

  if (!compileResult.success || !compileResult.pdfBase64) {
    console.log(`[Preview] Compilation failed for ${filesPath}:`, compileResult.errors?.[0]?.message || "Unknown error");
    throw new Error("PDF compilation failed");
  }

  console.log(`[Preview] PDF compiled successfully for ${filesPath}`);

  // 3) Call compile service to convert PDF to PNG
  const convertResponse = await fetch(`${COMPILE_SERVER_URL}/pdf-to-image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pdfBase64: compileResult.pdfBase64,
      page: 1,
      dpi: 150,
    }),
  });

  let imageBase64: string | null = null;

  if (convertResponse.ok) {
    const convertResult = await convertResponse.json();
    if (convertResult.success && convertResult.image) {
      imageBase64 = convertResult.image;
    }
  }

  // If pdf-to-image API is missing or fails, try a fallback approach
  if (!imageBase64) {
    console.log(`[Preview] pdf-to-image API not available, using fallback...`);
    // Without a dedicated API, we'd need compile service support for a PDF-base64 preview
    // (otherwise, we skip).
    throw new Error("PDF to image conversion not supported");
  }

  // 4) Upload preview image to storage
  const previewBuffer = Buffer.from(imageBase64, "base64");
  const s3Key = StoragePaths.templatePreview(filesPath);
  await storage.upload(s3Key, previewBuffer, "image/png");

  console.log(`[Preview] Uploaded preview to S3: ${s3Key}`);

  // 5) Update database
  const thumbnailUrl = `/api/templates/preview/${filesPath}`;
  await prisma.template.update({
    where: { id: templateId },
    data: { thumbnailUrl },
  });

  console.log(`[Preview] Successfully generated preview for ${filesPath}`);
}

/**
 * Determine whether a file should be treated as binary.
 */
function isBinaryFile(filename: string, mimeType: string): boolean {
  const binaryExtensions = [".png", ".jpg", ".jpeg", ".gif", ".pdf", ".eps", ".ps", ".zip", ".tar", ".gz"];
  const ext = filename.toLowerCase().substring(filename.lastIndexOf("."));

  if (binaryExtensions.includes(ext)) {
    return true;
  }

  if (mimeType.startsWith("image/") || mimeType.startsWith("application/")) {
    return !mimeType.includes("json") && !mimeType.includes("xml") && !mimeType.includes("text");
  }

  return false;
}

export { generateTemplatePreview };
