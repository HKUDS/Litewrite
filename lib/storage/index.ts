/**
 * Storage Provider Abstraction Layer
 *
 * Unified storage interface supporting local filesystem and S3/MinIO object storage.
 * Switch via STORAGE_PROVIDER env var:
 * - "local": local filesystem (development)
 * - "s3": S3/MinIO (production)
 */

export interface FileInfo {
  key: string;
  size: number;
  lastModified: Date;
  contentType?: string;
}

export interface StorageProvider {
  /**
   * Upload a file.
   * @param key File path (relative to bucket/root)
   * @param content File content
   * @param contentType MIME type (optional)
   */
  upload(key: string, content: Buffer | string, contentType?: string): Promise<void>;

  /**
   * Download a file.
   * @param key File path
   * @returns File content
   */
  download(key: string): Promise<Buffer>;

  /**
   * Delete a file.
   * @param key File path
   */
  delete(key: string): Promise<void>;

  /**
   * Check whether a file exists.
   * @param key File path
   */
  exists(key: string): Promise<boolean>;

  /**
   * List all files under a prefix.
   * @param prefix Prefix path
   * @returns List of file infos
   */
  list(prefix: string): Promise<FileInfo[]>;

  /**
   * Delete all files under a prefix.
   * @param prefix Prefix path
   */
  deletePrefix(prefix: string): Promise<void>;

  /**
   * Copy a file.
   * @param sourceKey Source file path
   * @param destKey Destination file path
   */
  copy(sourceKey: string, destKey: string): Promise<void>;

  /**
   * Get a public URL for the file.
   * @param key File path
   * @returns Public URL
   */
  getPublicUrl(key: string): string;

  /**
   * Get a signed URL (temporary access).
   * @param key File path
   * @param expiresIn Expiration in seconds (default: 3600)
   * @returns Signed URL
   */
  getSignedUrl(key: string, expiresIn?: number): Promise<string>;

  /**
   * Get file metadata.
   * @param key File path
   * @returns File info, or null if it doesn't exist
   */
  getInfo(key: string): Promise<FileInfo | null>;
}

/**
 * Storage configuration
 */
export interface StorageConfig {
  provider: "local" | "s3";

  // Local storage config
  localBasePath?: string;

  // S3/MinIO config
  s3Endpoint?: string;
  s3Region?: string;
  s3Bucket?: string;
  s3AccessKeyId?: string;
  s3SecretAccessKey?: string;
  s3ForcePathStyle?: boolean; // Required for MinIO
}

/**
 * Load storage configuration from environment variables.
 */
export function getStorageConfig(): StorageConfig {
  const provider = (process.env.STORAGE_PROVIDER || "local") as "local" | "s3";

  return {
    provider,
    localBasePath: process.env.STORAGE_LOCAL_PATH || process.env.PROJECTS_DIR || "./projects",
    s3Endpoint: process.env.S3_ENDPOINT,
    s3Region: process.env.S3_REGION || "us-east-1",
    s3Bucket: process.env.S3_BUCKET || "litewrite",
    s3AccessKeyId: process.env.S3_ACCESS_KEY_ID,
    s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
  };
}

// Singleton instance
let storageInstance: StorageProvider | null = null;

/**
 * Get a storage provider instance (singleton).
 */
export async function getStorage(): Promise<StorageProvider> {
  if (storageInstance) {
    return storageInstance;
  }

  const config = getStorageConfig();

  if (config.provider === "s3") {
    const { S3StorageProvider } = await import("./s3");
    storageInstance = new S3StorageProvider(config);
  } else {
    const { LocalStorageProvider } = await import("./local");
    storageInstance = new LocalStorageProvider(config.localBasePath || "./storage");
  }

  return storageInstance;
}

/**
 * Reset storage instance (for tests).
 */
export function resetStorage(): void {
  storageInstance = null;
}

/**
 * Storage path helpers
 */
export const StoragePaths = {
  // ============================================
  // Merkle Tree content-addressable storage paths
  // ============================================

  /**
   * Blob storage path (content-addressable).
   * Uses the first 2 hash chars as a shard directory to avoid too many files in a single folder.
   * @param hash SHA-256 hash (64 chars)
   * @returns Path like: blobs/ab/cd1234...
   */
  blob: (hash: string) => `blobs/${hash.substring(0, 2)}/${hash}`,

  /**
   * Blob storage prefix
   */
  blobsPrefix: () => "blobs/",

  /**
   * Extract blob hash from a blob path.
   * @param key Blob storage path
   * @returns SHA-256 hash
   */
  extractBlobHash: (key: string) => {
    const parts = key.split("/");
    return parts[parts.length - 1];
  },

  // ============================================
  // Project file paths
  // ============================================

  /**
   * Project file path
   */
  projectFile: (projectId: string, filePath: string) =>
    `projects/${projectId}/${filePath}`.replace(/\/+/g, "/"),

  /**
   * Project root prefix
   */
  projectPrefix: (projectId: string) => `projects/${projectId}/`,

  /**
   * Compiled output path
   */
  compiledFile: (projectId: string, filename: string) =>
    `compiled/${projectId}/${filename}`,

  /**
   * Compiled output prefix
   */
  compiledPrefix: (projectId: string) => `compiled/${projectId}/`,

  // ============================================
  // Version snapshot paths (legacy, deprecated)
  // ============================================

  /**
   * Version snapshot path (deprecated; migration only)
   * @deprecated Use Merkle Tree instead
   */
  versionSnapshot: (projectId: string, versionId: string) =>
    `versions/${projectId}/${versionId}.tar.gz`,

  /**
   * Version snapshot prefix (deprecated; migration only)
   * @deprecated Use Merkle Tree instead
   */
  versionsPrefix: (projectId: string) => `versions/${projectId}/`,

  // ============================================
  // Litewrite metadata paths
  // ============================================

  /**
   * Litewrite project metadata prefix.
   * Includes: sessions, edits, shadow documents, deep-research reports
   */
  litewritePrefix: (projectId: string) => `litewrite/${projectId}/`,

  // ============================================
  // Other asset paths
  // ============================================

  /**
   * User avatar path
   */
  avatar: (userId: string, ext: string) => `avatars/${userId}.${ext}`,

  /**
   * Template file path
   */
  templateFile: (templateId: string, filePath: string) =>
    `templates/${templateId}/${filePath}`.replace(/\/+/g, "/"),

  /**
   * Template prefix
   */
  templatePrefix: (templateId: string) => `templates/${templateId}/`,

  /**
   * Template preview image path
   */
  templatePreview: (templateId: string) => `template-previews/${templateId}.png`,
};

/**
 * MIME type mapping
 */
export const MimeTypes: Record<string, string> = {
  // Text files
  ".tex": "text/x-latex",
  ".bib": "application/x-bibtex",
  ".sty": "text/x-latex",
  ".cls": "text/x-latex",
  ".bst": "text/plain",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",

  // Images
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",

  // PDF
  ".pdf": "application/pdf",

  // Archives
  ".gz": "application/gzip",
  ".tar": "application/x-tar",
  ".zip": "application/zip",
};

/**
 * Get MIME type based on file extension.
 */
export function getMimeType(filename: string): string {
  const ext = filename.toLowerCase().substring(filename.lastIndexOf("."));
  return MimeTypes[ext] || "application/octet-stream";
}

/**
 * Text file extension list.
 * These files can be safely treated as UTF-8 strings for version diff and display.
 */
export const TEXT_FILE_EXTENSIONS = [
  // LaTeX-related
  ".tex", ".bib", ".sty", ".cls", ".bst", ".dtx", ".ins",
  // LaTeX auxiliary files
  ".aux", ".toc", ".lof", ".lot", ".bbl", ".blg", ".out", ".nav", ".snm", ".vrb", ".log",
  // General text
  ".txt", ".md", ".json", ".xml", ".yml", ".yaml", ".toml",
  // Config files
  ".cfg", ".ini",
  // Web-related
  ".html", ".css", ".js", ".ts",
];

/**
 * Determine whether a file is a text file (safe to decode as UTF-8).
 * @param filename Filename or path
 * @returns True if it is a text file
 */
export function isTextFile(filename: string): boolean {
  const ext = filename.toLowerCase().substring(filename.lastIndexOf("."));
  return TEXT_FILE_EXTENSIONS.includes(ext);
}
