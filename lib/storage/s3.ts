/**
 * S3/MinIO Storage Provider
 *
 * Object storage implementation for AWS S3 and MinIO.
 * Configured via environment variables:
 * - S3_ENDPOINT: S3 endpoint (required for MinIO; optional for AWS S3)
 * - S3_REGION: region (default: us-east-1)
 * - S3_BUCKET: bucket name
 * - S3_ACCESS_KEY_ID: access key ID
 * - S3_SECRET_ACCESS_KEY: secret access key
 * - S3_FORCE_PATH_STYLE: whether to use path-style addressing (true for MinIO)
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl as s3GetSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { StorageProvider, StorageConfig, FileInfo } from "./index";
import { getMimeType } from "./index";

/**
 * Encode an S3 object key so it is safe to use in a URL/path header.
 *
 * Key points:
 * - S3 keys support UTF-8 (e.g. CJK), but CopyObject's CopySource header must be URL-encoded
 * - Keep path separators ("/") by encoding each segment with encodeURIComponent then joining
 */
function encodeS3KeyForUrl(key: string): string {
  const normalized = key.replace(/^\/+/, "");
  return normalized
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

export class S3StorageProvider implements StorageProvider {
  private client: S3Client;
  private bucket: string;
  private endpoint?: string;

  constructor(config: StorageConfig) {
    this.bucket = config.s3Bucket || "litewrite";
    this.endpoint = config.s3Endpoint;

    // Create S3 client config
    const clientConfig: ConstructorParameters<typeof S3Client>[0] = {
      region: config.s3Region || "us-east-1",
    };

    // MinIO or custom endpoint
    if (config.s3Endpoint) {
      clientConfig.endpoint = config.s3Endpoint;
      clientConfig.forcePathStyle = config.s3ForcePathStyle ?? true; // MinIO typically needs path-style addressing
    }

    // Configure credentials
    if (config.s3AccessKeyId && config.s3SecretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: config.s3AccessKeyId,
        secretAccessKey: config.s3SecretAccessKey,
      };
    }

    this.client = new S3Client(clientConfig);
  }

  async upload(key: string, content: Buffer | string, contentType?: string): Promise<void> {
    const body = typeof content === "string" ? Buffer.from(content, "utf8") : content;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType || getMimeType(key),
      })
    );
  }

  async download(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      })
    );

    if (!response.Body) {
      throw new Error(`Failed to download file: ${key}`);
    }

    // Convert ReadableStream to Buffer
    const chunks: Uint8Array[] = [];
    const stream = response.Body as AsyncIterable<Uint8Array>;

    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    return Buffer.concat(chunks);
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );
    } catch (error: unknown) {
      // Ignore NoSuchKey errors
      if ((error as { name?: string }).name !== "NoSuchKey") {
        throw error;
      }
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );
      return true;
    } catch (error: unknown) {
      if ((error as { name?: string }).name === "NotFound") {
        return false;
      }
      throw error;
    }
  }

  async list(prefix: string): Promise<FileInfo[]> {
    const results: FileInfo[] = [];
    let continuationToken: string | undefined;

    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        })
      );

      if (response.Contents) {
        for (const object of response.Contents) {
          if (object.Key && object.Size !== undefined && object.LastModified) {
            results.push({
              key: object.Key,
              size: object.Size,
              lastModified: object.LastModified,
              contentType: getMimeType(object.Key),
            });
          }
        }
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return results;
  }

  async deletePrefix(prefix: string): Promise<void> {
    // First list all objects
    const objects = await this.list(prefix);

    if (objects.length === 0) {
      return;
    }

    // S3 DeleteObjects can delete at most 1000 objects per request
    const batchSize = 1000;
    for (let i = 0; i < objects.length; i += batchSize) {
      const batch = objects.slice(i, i + batchSize);

      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: {
            Objects: batch.map((obj) => ({ Key: obj.key })),
            Quiet: true,
          },
        })
      );
    }
  }

  async copy(sourceKey: string, destKey: string): Promise<void> {
    // AWS S3 requirement for CopySource: must be URL-encoded, otherwise keys containing
    // CJK/spaces/etc. may fail. See x-amz-copy-source / CopySource header rules.
    const encodedCopySourceKey = encodeS3KeyForUrl(sourceKey);
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        CopySource: `${this.bucket}/${encodedCopySourceKey}`,
        Key: destKey,
      })
    );
  }

  getPublicUrl(key: string): string {
    const encodedKey = encodeS3KeyForUrl(key);
    if (this.endpoint) {
      // MinIO or custom endpoint
      return `${this.endpoint}/${this.bucket}/${encodedKey}`;
    }
    // AWS S3 standard URL
    return `https://${this.bucket}.s3.amazonaws.com/${encodedKey}`;
  }

  async getSignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return s3GetSignedUrl(this.client, command, { expiresIn });
  }

  async getInfo(key: string): Promise<FileInfo | null> {
    try {
      const response = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );

      return {
        key,
        size: response.ContentLength || 0,
        lastModified: response.LastModified || new Date(),
        contentType: response.ContentType,
      };
    } catch (error: unknown) {
      if ((error as { name?: string }).name === "NotFound") {
        return null;
      }
      throw error;
    }
  }
}
