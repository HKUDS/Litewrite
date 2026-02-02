/**
 * Version Snapshot Utilities (deprecated)
 *
 * @deprecated Since Dec 2025, new versions use Merkle Tree storage (lib/storage/merkle.ts)
 *
 * This file is only used for:
 * 1. Reading legacy tar.gz snapshots (downloadSnapshot)
 * 2. Data migration scripts (migrate-to-s3.ts, migrate-versions.ts)
 * 3. Compatibility support
 *
 * For new versions, use MerkleService.createCommit().
 */

import * as tar from "tar";
import { Readable, PassThrough } from "stream";
import { pipeline } from "stream/promises";
import { createGzip, createGunzip } from "zlib";
import { createHash } from "crypto";
import { getStorage, StoragePaths } from "./index";

/**
 * Truncate a string by UTF-8 byte length.
 * Ensures we don't cut in the middle of a multi-byte character.
 *
 * @param str String to truncate
 * @param maxBytes Max bytes
 * @returns Truncated string
 */
function truncateToUtf8Bytes(str: string, maxBytes: number): string {
  const buf = Buffer.from(str, "utf8");
  if (buf.length <= maxBytes) {
    return str;
  }

  // Slice from the end to keep the tail of the filename (more meaningful).
  // Find a safe cut position that won't split multi-byte characters.
  let truncatedBuf = buf.subarray(buf.length - maxBytes);

  // Check whether the cut lands in the middle of a multi-byte character.
  // In UTF-8, continuation bytes start with 10xxxxxx (0x80-0xBF).
  // If the first byte is a continuation byte, skip until a valid leading byte.
  let skipBytes = 0;
  while (skipBytes < truncatedBuf.length) {
    const byte = truncatedBuf[skipBytes];
    // If it's not a continuation byte (not in 0x80-0xBF), it's a valid start
    if (byte < 0x80 || byte >= 0xc0) {
      break;
    }
    skipBytes++;
  }

  if (skipBytes > 0) {
    truncatedBuf = truncatedBuf.subarray(skipBytes);
  }

  return truncatedBuf.toString("utf8");
}

/**
 * Pack project files into tar.gz and upload to storage.
 *
 * @param projectId Project ID
 * @param versionId Version ID
 * @param files File content map { relativePath: content }
 * @returns { fileCount, totalSize }
 */
export async function createSnapshot(
  projectId: string,
  versionId: string,
  files: Map<string, string | Buffer>
): Promise<{ fileCount: number; totalSize: number }> {
  const storage = await getStorage();
  const snapshotKey = StoragePaths.versionSnapshot(projectId, versionId);

  // Create tar archive
  const chunks: Buffer[] = [];
  const passThrough = new PassThrough();

  // Collect output chunks
  passThrough.on("data", (chunk: Buffer) => chunks.push(chunk));

  // Create gzip stream
  const gzip = createGzip();

  // Create tar pack using tar.Pack
  const pack = new tar.Pack({ gzip: false });

  let fileCount = 0;
  let totalSize = 0;

  // Add files to tar archive
  for (const [filePath, content] of files) {
    const buffer = typeof content === "string" ? Buffer.from(content, "utf8") : content;
    totalSize += buffer.length;
    fileCount++;

    // Create tar entry
    const entry = new tar.ReadEntry(
      new tar.Header({
        path: filePath,
        type: "File",
        size: buffer.length,
        mode: 0o644,
        mtime: new Date(),
      })
    );

    // Manually write entry to the pack
    pack.write(entry);
    entry.write(buffer);
    entry.end();
  }

  // Finalize pack
  pack.end();

  // Pipeline: pack -> gzip -> passThrough
  await pipeline(pack, gzip, passThrough);

  // Concatenate chunks
  const tarGzBuffer = Buffer.concat(chunks);

  // Upload to storage
  await storage.upload(snapshotKey, tarGzBuffer, "application/gzip");

  return { fileCount, totalSize };
}

/**
 * Simplified: pack files directly into a tar.gz Buffer.
 */
export async function createSnapshotBuffer(
  files: Map<string, string | Buffer>
): Promise<{ buffer: Buffer; fileCount: number; totalSize: number }> {
  // Build tar-formatted data
  const tarEntries: Buffer[] = [];
  let fileCount = 0;
  let totalSize = 0;

  for (const [filePath, content] of files) {
    const data = typeof content === "string" ? Buffer.from(content, "utf8") : content;
    totalSize += data.length;
    fileCount++;

    // TAR header (512 bytes)
    const header = Buffer.alloc(512);

    // Filename (max 100 bytes)
    // NOTE: must truncate by UTF-8 byte length, not character count
    const name = truncateToUtf8Bytes(filePath, 100);
    header.write(name, 0, "utf8");

    // File mode (8 bytes, octal)
    header.write("0000644\0", 100, "utf8");

    // UID (8 bytes)
    header.write("0000000\0", 108, "utf8");

    // GID (8 bytes)
    header.write("0000000\0", 116, "utf8");

    // File size (12 bytes, octal)
    header.write(data.length.toString(8).padStart(11, "0") + "\0", 124, "utf8");

    // mtime (12 bytes, octal)
    const mtime = Math.floor(Date.now() / 1000);
    header.write(mtime.toString(8).padStart(11, "0") + "\0", 136, "utf8");

    // Checksum placeholder (8 bytes)
    header.write("        ", 148, "utf8");

    // Type flag (1 byte) - '0' means regular file
    header.write("0", 156, "utf8");

    // Compute checksum
    let checksum = 0;
    for (let i = 0; i < 512; i++) {
      checksum += header[i];
    }
    header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, "utf8");

    tarEntries.push(header);

    // File data (must be padded to a multiple of 512 bytes)
    const padding = (512 - (data.length % 512)) % 512;
    const paddedData = Buffer.concat([data, Buffer.alloc(padding)]);
    tarEntries.push(paddedData);
  }

  // Add end-of-archive markers (two empty 512-byte blocks)
  tarEntries.push(Buffer.alloc(1024));

  // Concatenate entries
  const tarBuffer = Buffer.concat(tarEntries);

  // Gzip compress
  const gzipBuffer = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const gzip = createGzip();
    const input = Readable.from(tarBuffer);

    input.pipe(gzip);

    gzip.on("data", (chunk: Buffer) => chunks.push(chunk));
    gzip.on("end", () => resolve(Buffer.concat(chunks)));
    gzip.on("error", reject);
  });

  return { buffer: gzipBuffer, fileCount, totalSize };
}

/**
 * Extract files from a tar.gz Buffer.
 */
export async function extractSnapshotBuffer(
  tarGzBuffer: Buffer
): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();

  // Gunzip
  const tarBuffer = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const gunzip = createGunzip();
    const input = Readable.from(tarGzBuffer);

    input.pipe(gunzip);

    gunzip.on("data", (chunk: Buffer) => chunks.push(chunk));
    gunzip.on("end", () => resolve(Buffer.concat(chunks)));
    gunzip.on("error", reject);
  });

  // Parse tar
  let offset = 0;
  while (offset < tarBuffer.length - 512) {
    const header = tarBuffer.subarray(offset, offset + 512);

    // Check for empty block (end marker)
    if (header.every((b) => b === 0)) {
      break;
    }

    // Parse filename
    let nameEnd = 0;
    while (nameEnd < 100 && header[nameEnd] !== 0) {
      nameEnd++;
    }
    const name = header.subarray(0, nameEnd).toString("utf8");

    // Parse file size
    const sizeStr = header.subarray(124, 136).toString("utf8").trim();
    const size = parseInt(sizeStr, 8) || 0;

    // Parse type
    const type = String.fromCharCode(header[156]);

    offset += 512;

    // Only handle regular files
    if (type === "0" || type === "\0") {
      const data = tarBuffer.subarray(offset, offset + size);
      files.set(name, Buffer.from(data));
    }

    // Skip data block (including padding)
    const padding = (512 - (size % 512)) % 512;
    offset += size + padding;
  }

  return files;
}

/**
 * Create a version snapshot and upload to storage.
 */
export async function uploadSnapshot(
  projectId: string,
  versionId: string,
  files: Map<string, string | Buffer>
): Promise<{ fileCount: number; totalSize: number }> {
  const storage = await getStorage();
  const snapshotKey = StoragePaths.versionSnapshot(projectId, versionId);

  // Create tar.gz buffer
  const { buffer, fileCount, totalSize } = await createSnapshotBuffer(files);

  // Upload to storage
  await storage.upload(snapshotKey, buffer, "application/gzip");

  return { fileCount, totalSize };
}

/**
 * Download and extract a version snapshot from storage.
 */
export async function downloadSnapshot(
  projectId: string,
  versionId: string
): Promise<Map<string, Buffer>> {
  const storage = await getStorage();
  const snapshotKey = StoragePaths.versionSnapshot(projectId, versionId);

  // Download tar.gz
  const tarGzBuffer = await storage.download(snapshotKey);

  // Extract and return files
  return extractSnapshotBuffer(tarGzBuffer);
}

/**
 * Read all current project files from storage.
 * Uses the unified isTextFile helper to determine text files.
 *
 * Note: Binary files are also included in the result, but stored as a stable placeholder.
 * This matches the Merkle Tree version behavior so that during version comparison,
 * binary files won't be incorrectly marked as \"removed\".
 */
export async function readProjectFilesFromStorage(
  projectId: string
): Promise<Map<string, string>> {
  const { isTextFile } = await import("./index");
  const storage = await getStorage();
  const prefix = StoragePaths.projectPrefix(projectId);
  const prefixLen = prefix.length;

  const files = new Map<string, string>();

  // List all files under the project prefix
  const fileList = await storage.list(prefix);

  for (const file of fileList) {
    const relativePath = file.key.substring(prefixLen);
    if (!relativePath) continue;

    // Skip hidden files and .gitkeep
    const filename = relativePath.split("/").pop() || "";
    if (filename.startsWith(".") || filename === ".gitkeep") continue;

    // Text files: read content
    // Binary files: compute a content hash for comparison (stored as [binary:HASH])
    try {
      const content = await storage.download(file.key);
      if (isTextFile(filename)) {
        files.set(relativePath, content.toString("utf8"));
      } else {
        // Binary file: compute content hash for version comparison
        const hash = createHash("sha256").update(content).digest("hex").substring(0, 16);
        files.set(relativePath, `[binary:${hash}]`);
      }
    } catch (error) {
      console.error(`Failed to read file: ${file.key}`, error);
    }
  }

  return files;
}
