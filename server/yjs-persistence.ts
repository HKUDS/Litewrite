/**
 * Yjs Redis Persistence Manager
 * =======================
 *
 * Store Yjs document updates incrementally in Redis while preserving the full CRDT structure.
 * This ensures RelativePosition remains valid after server restarts.
 *
 * Redis data structures:
 *   yjs:{projectId}:{fileId}:updates - List, stores incremental updates
 *   yjs:{projectId}:{fileId}:meta    - Hash, stores metadata
 *
 * Environment variables:
 *   REDIS_URL - Redis connection URL
 *     Local: redis://localhost:6379
 *     Upstash: redis://default:xxx@xxx.upstash.io:6379
 */

import * as Y from "yjs";
import { getRedis, closeRedis } from "./redis-client";

// ============================================================================
// Key generation helpers
// ============================================================================

/**
 * Generate the Redis key prefix.
 */
function getKeyPrefix(projectId: string, fileId: string): string {
  // IMPORTANT:
  // 1) Encoding must be reversible/non-colliding; otherwise different paths may map to the same
  //    Redis key and cause cross-document corruption.
  // 2) Compatible with Redis Cluster / MemoryDB: avoid assuming multiple keys share the same slot.
  const b64url = Buffer.from(fileId, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `yjs:${projectId}:${b64url}`;
}

/**
 * Legacy (potentially colliding) key prefix: used for restoring/cleaning up historical data.
 */
function getLegacyKeyPrefix(projectId: string, fileId: string): string {
  const safeFileId = fileId.replace(/[\/\\:*?"<>|]/g, "_");
  return `yjs:${projectId}:${safeFileId}`;
}

/**
 * Get the updates list key.
 */
function getUpdatesKey(projectId: string, fileId: string): string {
  return `${getKeyPrefix(projectId, fileId)}:updates`;
}

/**
 * Get the metadata key.
 */
function getMetaKey(projectId: string, fileId: string): string {
  return `${getKeyPrefix(projectId, fileId)}:meta`;
}

function getLegacyUpdatesKey(projectId: string, fileId: string): string {
  return `${getLegacyKeyPrefix(projectId, fileId)}:updates`;
}

function getLegacyMetaKey(projectId: string, fileId: string): string {
  return `${getLegacyKeyPrefix(projectId, fileId)}:meta`;
}

// ============================================================================
// Room name parsing
// ============================================================================

/**
 * Parse a room name to extract projectId and fileId.
 * Room name formats:
 *   - projectId-fileId (e.g. d001c596-ccab-4466-af08-533d01cc6cef-main.tex)
 *   - ws/projectId-fileId (with a ws/ prefix)
 *
 * Non-matching room types (return null):
 *   - ws/project-{uuid} - project collaboration rooms
 *   - ws/chat-{uuid} - chat rooms
 */
export function parseRoomName(roomName: string): { projectId: string; fileId: string } | null {
  // Remove ws/ prefix (if present)
  let cleanName = roomName;
  if (cleanName.startsWith("ws/")) {
    cleanName = cleanName.slice(3);
  }

  // Skip project rooms and chat rooms (no persistence needed)
  if (cleanName.startsWith("project-") || cleanName.startsWith("chat-")) {
    return null;
  }

  // UUID format: 8-4-4-4-12 characters
  const uuidPattern = /^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})-(.+)$/;
  const match = cleanName.match(uuidPattern);

  if (match) {
    return {
      projectId: match[1],
      fileId: match[2]
    };
  }
  return null;
}

// ============================================================================
// Core persistence operations
// ============================================================================

/**
 * Restore a Yjs document from Redis.
 * Returns whether existing data was successfully restored.
 */
export async function restoreDocument(
  doc: Y.Doc,
  projectId: string,
  fileId: string
): Promise<boolean> {
  try {
    const redis = await getRedis();
    if (!redis) {
      return false;
    }
    const updatesKey = getUpdatesKey(projectId, fileId);

    // Fetch all stored updates (as an array of Buffers)
    let updates = await redis.lrangeBuffer(updatesKey, 0, -1);
    let restoredFromLegacy = false;

    // Legacy key compatibility: if the new key has no data, try restoring from the legacy key.
    if (!updates || updates.length === 0) {
      const legacyUpdatesKey = getLegacyUpdatesKey(projectId, fileId);
      const legacyUpdates = await redis.lrangeBuffer(legacyUpdatesKey, 0, -1);
      if (legacyUpdates && legacyUpdates.length > 0) {
        updates = legacyUpdates;
        restoredFromLegacy = true;
        console.log(`♻️ Restored document from legacy key: ${projectId}/${fileId}, ${legacyUpdates.length} update(s)`);
      }
    }

    // Compatibility for URL-encoded fileId:
    // Before ws-server.ts added decodeURIComponent, non-ASCII filenames (e.g. Chinese) were stored
    // URL-encoded (e.g. %E4%B8%AD%E6%96%87.tex). Now fileId is decoded, so we need to try restoring
    // legacy data from keys built with the encoded fileId.
    if (!updates || updates.length === 0) {
      const encodedFileId = encodeURIComponent(fileId);
      // Only try when the encoded value differs (i.e. fileId contains non-ASCII characters)
      if (encodedFileId !== fileId) {
        // Try new-format key (base64url of URL-encoded fileId)
        const encodedUpdatesKey = getUpdatesKey(projectId, encodedFileId);
        let encodedUpdates = await redis.lrangeBuffer(encodedUpdatesKey, 0, -1);
        if (encodedUpdates && encodedUpdates.length > 0) {
          updates = encodedUpdates;
          restoredFromLegacy = true;
          console.log(`♻️ Restored document from URL-encoded key: ${projectId}/${fileId}, ${encodedUpdates.length} update(s)`);
        } else {
          // Try legacy-format key (directly uses URL-encoded fileId)
          const encodedLegacyUpdatesKey = getLegacyUpdatesKey(projectId, encodedFileId);
          encodedUpdates = await redis.lrangeBuffer(encodedLegacyUpdatesKey, 0, -1);
          if (encodedUpdates && encodedUpdates.length > 0) {
            updates = encodedUpdates;
            restoredFromLegacy = true;
            console.log(`♻️ Restored document from URL-encoded legacy key: ${projectId}/${fileId}, ${encodedUpdates.length} update(s)`);
          }
        }
      }
    }

    if (updates && updates.length > 0) {
      console.log(`📥 Restoring document from Redis: ${projectId}/${fileId}, ${updates.length} update(s)`);

      // Apply all updates to the document
      for (const update of updates) {
        Y.applyUpdate(doc, new Uint8Array(update));
      }

      // Check whether the document has any real content
      const state = Y.encodeStateAsUpdate(doc);
      if (state.length > 2) { // Empty doc state is ~2 bytes
        console.log(`✅ Document restored: ${projectId}/${fileId}, state size: ${state.length} bytes`);

        // Update metadata
        const metaKey = getMetaKey(projectId, fileId);
        await redis.hset(metaKey, {
          lastRestore: Date.now().toString(),
          updateCount: updates.length.toString(),
          stateSize: state.length.toString(),
        });

        // If restored from a legacy key, perform a lazy migration:
        // write to the new key and clean up legacy keys (best-effort).
        if (restoredFromLegacy) {
          try {
            const newUpdatesKey = getUpdatesKey(projectId, fileId);
            await redis.del(newUpdatesKey);
            await redis.rpush(newUpdatesKey, Buffer.from(state));

            const legacyUpdatesKey = getLegacyUpdatesKey(projectId, fileId);
            const legacyMetaKey = getLegacyMetaKey(projectId, fileId);
            await redis.del(legacyUpdatesKey);
            await redis.del(legacyMetaKey);

            // Also clean up URL-encoded variants of legacy keys (if any)
            const encodedFileId = encodeURIComponent(fileId);
            if (encodedFileId !== fileId) {
              const encodedUpdatesKey = getUpdatesKey(projectId, encodedFileId);
              const encodedMetaKey = getMetaKey(projectId, encodedFileId);
              const encodedLegacyUpdatesKey = getLegacyUpdatesKey(projectId, encodedFileId);
              const encodedLegacyMetaKey = getLegacyMetaKey(projectId, encodedFileId);
              await redis.del(encodedUpdatesKey);
              await redis.del(encodedMetaKey);
              await redis.del(encodedLegacyUpdatesKey);
              await redis.del(encodedLegacyMetaKey);
            }

            console.log(`✅ Migrated legacy key → new key: ${projectId}/${fileId}`);
          } catch (err) {
            console.warn(`⚠️ Legacy key migration failed (restore still OK):`, err);
          }
        }

        return true;
      }
    }

    console.log(`📄 New document; nothing to restore: ${projectId}/${fileId}`);
    return false;
  } catch (error) {
    console.error(`❌ Failed to restore document (${projectId}/${fileId}):`, error);
    return false;
  }
}

/**
 * Persist a document update to Redis (incremental).
 */
export async function storeUpdate(
  update: Uint8Array,
  projectId: string,
  fileId: string
): Promise<void> {
  try {
    const redis = await getRedis();
    if (!redis) {
      return;
    }
    const updatesKey = getUpdatesKey(projectId, fileId);

    // Append update to the list
    await redis.rpush(updatesKey, Buffer.from(update));

    // Update metadata
    const metaKey = getMetaKey(projectId, fileId);
    await redis.hset(metaKey, {
      lastUpdate: Date.now().toString(),
    });
    await redis.hincrby(metaKey, "totalUpdates", 1);

    // NOTE: no need to log every update; it's too noisy.
  } catch (error) {
    console.error(`❌ Failed to store update (${projectId}/${fileId}):`, error);
  }
}

/**
 * Compact document updates (optional optimization).
 * Merge multiple incremental updates into a single state snapshot to reduce storage usage.
 */
export async function compactDocument(
  projectId: string,
  fileId: string
): Promise<boolean> {
  try {
    const redis = await getRedis();
    if (!redis) return false;
    const updatesKey = getUpdatesKey(projectId, fileId);

    // Fetch all updates
    const updates = await redis.lrangeBuffer(updatesKey, 0, -1);

    if (!updates || updates.length < 10) {
      // Too few updates; no need to compact
      return false;
    }

    console.log(`🗜️ Compacting document: ${projectId}/${fileId}, ${updates.length} update(s)`);

    // Create a temporary doc and apply all updates
    const doc = new Y.Doc();
    for (const update of updates) {
      Y.applyUpdate(doc, new Uint8Array(update));
    }

    // Get the compacted state
    const compactedState = Y.encodeStateAsUpdate(doc);
    doc.destroy();

    // Replace the updates list using a transaction
    const multi = redis.multi();
    multi.del(updatesKey);
    multi.rpush(updatesKey, Buffer.from(compactedState));
    await multi.exec();

    // Update metadata
    const metaKey = getMetaKey(projectId, fileId);
    await redis.hset(metaKey, {
      lastCompact: Date.now().toString(),
      compactedFrom: updates.length.toString(),
    });

    console.log(`✅ Compaction done: ${updates.length} update(s) → 1 state snapshot`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to compact document (${projectId}/${fileId}):`, error);
    return false;
  }
}

/**
 * Clear persisted data for a specific document.
 */
export async function clearPersistence(projectId: string, fileId: string): Promise<void> {
  try {
    const redis = await getRedis();
    if (!redis) {
      return;
    }
    const updatesKey = getUpdatesKey(projectId, fileId);
    const metaKey = getMetaKey(projectId, fileId);

    // IMPORTANT (Redis Cluster / MemoryDB):
    // Multi-key commands like `DEL k1 k2` require all keys to hash to the same slot.
    // Our `updatesKey` and `metaKey` do not use hash tags, so this can fail with CROSSSLOT.
    // Delete keys separately to be cluster-safe.
    await redis.del(updatesKey);
    await redis.del(metaKey);

    // Also clean up legacy keys (historical data / written by older versions)
    const legacyUpdatesKey = getLegacyUpdatesKey(projectId, fileId);
    const legacyMetaKey = getLegacyMetaKey(projectId, fileId);
    await redis.del(legacyUpdatesKey);
    await redis.del(legacyMetaKey);

    // Also clean up URL-encoded variants (compatibility with pre-decodeURIComponent data)
    const encodedFileId = encodeURIComponent(fileId);
    if (encodedFileId !== fileId) {
      const encodedUpdatesKey = getUpdatesKey(projectId, encodedFileId);
      const encodedMetaKey = getMetaKey(projectId, encodedFileId);
      const encodedLegacyUpdatesKey = getLegacyUpdatesKey(projectId, encodedFileId);
      const encodedLegacyMetaKey = getLegacyMetaKey(projectId, encodedFileId);
      await redis.del(encodedUpdatesKey);
      await redis.del(encodedMetaKey);
      await redis.del(encodedLegacyUpdatesKey);
      await redis.del(encodedLegacyMetaKey);
    }

    console.log(`🗑️ Cleared persisted data: ${projectId}/${fileId}`);
  } catch (error) {
    console.error(`❌ Failed to clear persistence:`, error);
  }
}

/**
 * Close all Redis connections.
 */
export async function closeAllPersistence(): Promise<void> {
  console.log(`🔒 Closing Yjs persistence connection...`);
  await closeRedis();
}

/**
 * Bind a document to the persistence layer.
 * Installs a listener that automatically persists updates.
 */
export function bindDocumentToPersistence(
  doc: Y.Doc,
  projectId: string,
  fileId: string
): () => void {
  const updateHandler = (update: Uint8Array, origin: unknown) => {
    // Store asynchronously to avoid blocking the sync flow
    storeUpdate(update, projectId, fileId).catch(err => {
      console.error(`Error while storing update:`, err);
    });
  };

  doc.on("update", updateHandler);

  // Return cleanup function
  return () => {
    doc.off("update", updateHandler);
  };
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Get document metadata.
 */
export async function getDocumentMeta(
  projectId: string,
  fileId: string
): Promise<Record<string, string> | null> {
  try {
    const redis = await getRedis();
    if (!redis) {
      return null;
    }
    const metaKey = getMetaKey(projectId, fileId);
    const meta = await redis.hgetall(metaKey);
    return Object.keys(meta).length > 0 ? meta : null;
  } catch {
    return null;
  }
}

/**
 * Get the update count for a document.
 */
export async function getUpdateCount(
  projectId: string,
  fileId: string
): Promise<number> {
  try {
    const redis = await getRedis();
    if (!redis) {
      return 0;
    }
    const updatesKey = getUpdatesKey(projectId, fileId);
    return await redis.llen(updatesKey);
  } catch {
    return 0;
  }
}

/**
 * List all persisted documents.
 */
export async function listPersistedDocuments(): Promise<string[]> {
  try {
    const redis = await getRedis();
    if (!redis) {
      return [];
    }
    const keys = await redis.keys("yjs:*:updates");
    return keys.map((key: string) => key.replace(":updates", "").replace("yjs:", ""));
  } catch {
    return [];
  }
}

// ============================================================================
// Legacy interface compatibility (keep ws-server.ts compatible)
// ============================================================================

/**
 * @deprecated Use getKeyPrefix instead.
 */
export function getLevelDBPath(projectId: string, fileId: string): string {
  // Return the Redis key prefix to keep the interface compatible
  return getKeyPrefix(projectId, fileId);
}

/**
 * @deprecated Redis doesn't need this.
 */
export async function getPersistence(projectId: string, fileId: string): Promise<null> {
  // Redis doesn't require a separate persistence instance
  return null;
}

export default {
  parseRoomName,
  restoreDocument,
  storeUpdate,
  compactDocument,
  clearPersistence,
  closeAllPersistence,
  bindDocumentToPersistence,
  getDocumentMeta,
  getUpdateCount,
  listPersistedDocuments,
  // Compatibility
  getLevelDBPath,
  getPersistence,
};
