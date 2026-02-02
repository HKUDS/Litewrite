/**
 * Local Filesystem Storage Provider
 *
 * Local filesystem storage implementation for development environments.
 */

import { promises as fs } from "fs";
import path from "path";
import type { StorageProvider, FileInfo } from "./index";
import { getMimeType } from "./index";

export class LocalStorageProvider implements StorageProvider {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = path.resolve(basePath);
  }

  /**
   * Get the absolute path for a key.
   */
  private getFullPath(key: string): string {
    // Prevent path traversal attacks
    const normalized = path.normalize(key).replace(/^(\.\.(\/|\\|$))+/, "");
    return path.join(this.basePath, normalized);
  }

  /**
   * Ensure directory exists.
   */
  private async ensureDir(filePath: string): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
  }

  async upload(key: string, content: Buffer | string, _contentType?: string): Promise<void> {
    const fullPath = this.getFullPath(key);
    await this.ensureDir(fullPath);

    if (typeof content === "string") {
      await fs.writeFile(fullPath, content, "utf8");
    } else {
      await fs.writeFile(fullPath, content);
    }
  }

  async download(key: string): Promise<Buffer> {
    const fullPath = this.getFullPath(key);
    return fs.readFile(fullPath);
  }

  async delete(key: string): Promise<void> {
    const fullPath = this.getFullPath(key);
    try {
      const stats = await fs.stat(fullPath);
      if (stats.isDirectory()) {
        // If it's a directory, delete recursively
        await fs.rm(fullPath, { recursive: true, force: true });
      } else {
        // If it's a file, delete via unlink
        await fs.unlink(fullPath);
      }
    } catch (error: unknown) {
      // Ignore file/directory-not-found errors
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  async exists(key: string): Promise<boolean> {
    const fullPath = this.getFullPath(key);
    try {
      const stats = await fs.stat(fullPath);
      // Only return true for files, not directories
      // This makes behavior consistent with S3's HeadObjectCommand
      // which only matches exact object keys
      return stats.isFile();
    } catch {
      return false;
    }
  }

  async list(prefix: string): Promise<FileInfo[]> {
    const fullPath = this.getFullPath(prefix);
    const results: FileInfo[] = [];

    try {
      await this.listRecursive(fullPath, prefix, results);
    } catch (error: unknown) {
      // If directory doesn't exist, return empty array
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }

    return results;
  }

  private async listRecursive(
    dirPath: string,
    prefix: string,
    results: FileInfo[]
  ): Promise<void> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);
      const key = path.join(prefix, entry.name).replace(/\\/g, "/");

      if (entry.isDirectory()) {
        await this.listRecursive(entryPath, key, results);
      } else if (entry.isFile()) {
        const stats = await fs.stat(entryPath);
        results.push({
          key,
          size: stats.size,
          lastModified: stats.mtime,
          contentType: getMimeType(entry.name),
        });
      }
    }
  }

  async deletePrefix(prefix: string): Promise<void> {
    const fullPath = this.getFullPath(prefix);
    try {
      await fs.rm(fullPath, { recursive: true, force: true });
    } catch (error: unknown) {
      // Ignore directory-not-found errors
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  async copy(sourceKey: string, destKey: string): Promise<void> {
    const sourcePath = this.getFullPath(sourceKey);
    const destPath = this.getFullPath(destKey);
    await this.ensureDir(destPath);
    await fs.copyFile(sourcePath, destPath);
  }

  getPublicUrl(key: string): string {
    // Local storage doesn't have a real public URL; return the API path
    // In practice, access should be routed via the API.
    return `/api/storage/${encodeURIComponent(key)}`;
  }

  async getSignedUrl(key: string, _expiresIn?: number): Promise<string> {
    // Local storage does not support signed URLs; return a normal URL
    return this.getPublicUrl(key);
  }

  async getInfo(key: string): Promise<FileInfo | null> {
    const fullPath = this.getFullPath(key);
    try {
      const stats = await fs.stat(fullPath);
      if (!stats.isFile()) {
        return null;
      }
      return {
        key,
        size: stats.size,
        lastModified: stats.mtime,
        contentType: getMimeType(key),
      };
    } catch {
      return null;
    }
  }
}
