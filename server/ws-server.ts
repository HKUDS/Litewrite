/**
 * Yjs WebSocket collaboration server
 *
 * Provides full Yjs collaboration support based on y-websocket utilities.
 * Optional: incremental persistence via Redis (enabled when REDIS_URL is set).
 * If Redis is not configured, it falls back to in-memory mode (RelativePosition is not preserved across restarts).
 *
 * Run: npx tsx server/ws-server.ts
 *
 * Environment variables:
 *   REDIS_URL - Redis connection URL (optional)
 */

import { WebSocketServer, WebSocket } from "ws";
import http from "http";
import * as Y from "yjs";
import crypto from "crypto";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import {
  parseRoomName,
  restoreDocument,
  bindDocumentToPersistence,
  clearPersistence,
  closeAllPersistence,
} from "./yjs-persistence";
import {
  createRelPosForEdit,
} from "./edit-position-tracker";

const PORT = process.env.WS_PORT ? parseInt(process.env.WS_PORT) : 1234;

// Message type constants
const messageSync = 0;
const messageAwareness = 1;
const messageChat = 2; // Chat message type

function requireInternalSecret(req: http.IncomingMessage): boolean {
  const expected = process.env.INTERNAL_API_SECRET || "";
  if (!expected) return false;
  const provided = (req.headers["x-internal-secret"] as string | undefined) || "";
  if (!provided) return false;
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(provided);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// Chat message payload
interface ChatMessageData {
  id: string;
  content: string;
  userId: string;
  userName: string;
  userImage?: string;
  timestamp: number;
}

// Document state container
interface DocData {
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  clients: Set<WebSocket>;
  persistenceCleanup?: () => void; // Persistence cleanup function
  isRestoring?: boolean; // Whether doc is being restored
}

const docs = new Map<string, DocData>();

// Track docs being initialized (avoid concurrent initialization)
const initializingDocs = new Map<string, Promise<DocData>>();

// Project chat rooms (projectId -> clients)
const chatRooms = new Map<string, Set<WebSocket>>();

// Get or create a chat room
function getChatRoom(projectId: string): Set<WebSocket> {
  if (!chatRooms.has(projectId)) {
    chatRooms.set(projectId, new Set());
  }
  return chatRooms.get(projectId)!;
}

// Broadcast chat message to all users in a project
function broadcastChatMessage(projectId: string, message: ChatMessageData, sender: WebSocket) {
  const room = chatRooms.get(projectId);
  if (!room) return;

  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageChat);
  encoding.writeVarString(encoder, JSON.stringify(message));
  const data = encoding.toUint8Array(encoder);

  room.forEach((client) => {
    if (client !== sender && client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

// Get a doc (sync version; only for already-initialized docs)
function getYDocSync(docName: string): DocData | null {
  return docs.get(docName) || null;
}

// Get or create a doc (async; with Redis restore)
async function getYDoc(docName: string): Promise<DocData> {
  // If already exists, return directly
  if (docs.has(docName)) {
    return docs.get(docName)!;
  }

  // If initialization is in progress, wait for it
  if (initializingDocs.has(docName)) {
    return initializingDocs.get(docName)!;
  }

  // Start initialization
  const initPromise = (async () => {
    try {
      const doc = new Y.Doc();
      const awareness = new awarenessProtocol.Awareness(doc);

      // Parse room name to get projectId and fileId
      const parsed = parseRoomName(docName);
      let persistenceCleanup: (() => void) | undefined;

      if (parsed) {
        const { projectId, fileId } = parsed;

        // Try restoring document from Redis
        const restored = await restoreDocument(doc, projectId, fileId);

        if (restored) {
          console.log(`📥 Document restored from persistence: ${docName}`);
        }

        // Bind persistence to auto-save subsequent updates
        persistenceCleanup = bindDocumentToPersistence(doc, projectId, fileId);
        console.log(`💾 Persistence bound: ${docName}`);
      } else {
        console.log(`⚠️ Failed to parse room name; skipping persistence: ${docName}`);
      }

      // NOTE: We no longer auto-update line numbers for pending edits.
      // startLine/endLine only keep initial values for chat display.
      // Editor inline diff uses RelativePosition for precise real-time positions.

      // Listen for awareness changes
      awareness.on("update", ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
        const changedClients = added.concat(updated).concat(removed);
        const docData = docs.get(docName);
        if (docData) {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, messageAwareness);
          encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients));
          const message = encoding.toUint8Array(encoder);

          docData.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(message);
            }
          });
        }
      });

      const docData: DocData = {
        doc,
        awareness,
        clients: new Set(),
        persistenceCleanup,
      };

      docs.set(docName, docData);

      return docData;
    } finally {
      // Always clean up initializingDocs, whether the init succeeded or failed.
      // Without this, a rejected promise would remain in the map forever,
      // causing all subsequent getYDoc() calls for this room to fail permanently.
      initializingDocs.delete(docName);
    }
  })();

  initializingDocs.set(docName, initPromise);
  return initPromise;
}

// Cleanup document
function cleanupDoc(docName: string) {
  const docData = docs.get(docName);
  if (docData && docData.clients.size === 0) {
    // Cleanup persistence binding
    if (docData.persistenceCleanup) {
      docData.persistenceCleanup();
    }
    docData.doc.destroy();
    docs.delete(docName);
    console.log(`🧹 Cleaned up empty document: ${docName} (persisted data kept)`);
  }
}

// HTTP server - APIs for accessing document content
const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = req.url || "";
  // POST /admin/clear-project/:projectId - clear all rooms in a project (force clients to reconnect after version restore)
  const clearProjectMatch = url.match(/^\/admin\/clear-project\/([^\/]+)$/);
  if (req.method === "POST" && clearProjectMatch) {
    const [, projectId] = clearProjectMatch;

    // Internal auth: secret must be configured and validated
    if (!process.env.INTERNAL_API_SECRET) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "INTERNAL_API_SECRET not configured" }));
      return;
    }
    if (!requireInternalSecret(req)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid internal secret" }));
      return;
    }

    const prefix = `${projectId}-`;
    const matchesProject = (name: string) =>
      name === projectId || name.startsWith(prefix) || name.startsWith(`ws/${prefix}`);

    // Collect from both docs AND initializingDocs so we don't miss in-flight inits
    // that would otherwise resurrect stale content after clear finishes.
    const docNames = new Set([
      ...Array.from(docs.keys()).filter(matchesProject),
      ...Array.from(initializingDocs.keys()).filter(matchesProject),
    ]);

    let closedClients = 0;
    let clearedDocs = 0;

    for (const docName of docNames) {
      // If initialization is in-flight, await it so we can tear it down properly.
      let docData = docs.get(docName);
      if (!docData && initializingDocs.has(docName)) {
        try {
          docData = await initializingDocs.get(docName)!;
        } catch {
          // Init failed — nothing to clean up
        }
      }
      if (!docData) continue;

      // Close all websocket clients to force reconnect
      docData.clients.forEach((client) => {
        try {
          if (client.readyState === WebSocket.OPEN) {
            closedClients++;
            client.close(4001, "version_restore");
          }
        } catch {
          // ignore
        }
      });

      // Clear in-memory doc immediately
      try {
        docData.persistenceCleanup?.();
      } catch {
        // ignore
      }
      try {
        docData.doc.destroy();
      } catch {
        // ignore
      }
      docs.delete(docName);
      initializingDocs.delete(docName);
      clearedDocs++;
    }

    // Also clear project chat room clients (best-effort)
    const chatRoom = chatRooms.get(projectId);
    if (chatRoom) {
      chatRoom.forEach((client) => {
        try {
          if (client.readyState === WebSocket.OPEN) {
            closedClients++;
            client.close(4001, "version_restore");
          }
        } catch {
          // ignore
        }
      });
      chatRooms.delete(projectId);
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, projectId, clearedDocs, closedClients }));
    return;
  }
  // POST /clear/:projectId/:fileId - clear a document (memory + Redis persistence)
  // Used for: delete/recreate same-name files to prevent old Yjs content from being resurrected from memory or Redis
  const clearMatch = url.match(/^\/clear\/([^\/]+)\/(.+)$/);
  if (req.method === "POST" && clearMatch) {
    const [, projectId, fileId] = clearMatch;
    const decodedFileId = decodeURIComponent(fileId);
    const roomName = `${projectId}-${decodedFileId}`;

    try {
      // Internal auth: secret must be configured and validated
      if (!process.env.INTERNAL_API_SECRET) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "INTERNAL_API_SECRET not configured" }));
        return;
      }
      if (!requireInternalSecret(req)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid internal secret" }));
        return;
      }

      // Resolve the document — if initialization is in-flight, await it so we
      // can properly tear it down. Simply deleting from initializingDocs does NOT
      // cancel the running promise; the promise would still call docs.set() and
      // resurrect the stale content after /clear finishes.
      let docData = docs.get(roomName);
      if (!docData && initializingDocs.has(roomName)) {
        try {
          docData = await initializingDocs.get(roomName)!;
        } catch {
          // Init failed — nothing to clean up from it
        }
      }

      // Clear in-memory doc (if present — including freshly-awaited init result)
      if (docData) {
        // Critical: unbind persistence writer first to avoid re-writing updates back to Redis after clearing (race)
        if (docData.persistenceCleanup) {
          docData.persistenceCleanup();
        }
        // Proactively disconnect connected clients (prevent subsequent writes)
        docData.clients.forEach((client) => {
          try {
            client.close();
          } catch {
            // ignore
          }
        });

        docData.doc.destroy();
        docs.delete(roomName);
      }

      // Finally clear Redis persistence (even if the doc isn't in memory)
      await clearPersistence(projectId, decodedFileId);

      console.log(`🧹 /clear: ${projectId}/${decodedFileId}, clearedMemory=${!!docData}`);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, roomName, clearedMemory: !!docData }));
    } catch (err) {
      console.error("❌ Failed to clear document:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: "Failed to clear document" }));
    }
    return;
  }

  // POST /replace/:projectId/:fileId - replace document content with new text
  // Used by: /api/internal/files/edit to push bot-written content into Yjs
  // so that connected browsers receive the update via sync protocol instead
  // of losing changes when the browser re-syncs its stale local state.
  const replaceMatch = url.match(/^\/replace\/([^\/]+)\/(.+)$/);
  if (req.method === "POST" && replaceMatch) {
    const [, projectId, fileId] = replaceMatch;
    const decodedFileId = decodeURIComponent(fileId);
    const roomName = `${projectId}-${decodedFileId}`;

    // Internal auth
    if (!process.env.INTERNAL_API_SECRET) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "INTERNAL_API_SECRET not configured" }));
      return;
    }
    if (!requireInternalSecret(req)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid internal secret" }));
      return;
    }

    // Read request body
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", async () => {
      try {
        const { content } = JSON.parse(body) as { content: string };
        if (typeof content !== "string") {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "content must be a string" }));
          return;
        }

        // Resolve the target document.
        // We must check initializingDocs as well: if a client just connected,
        // getYDoc() may be restoring stale state from Redis. Awaiting the
        // init promise lets us replace content on the fully-initialized doc
        // so the new content wins over whatever was restored.
        let docData = docs.get(roomName);

        if (!docData && initializingDocs.has(roomName)) {
          // Document initialization is in-flight — wait for it to finish
          // so we can replace its (potentially stale) content in-place.
          console.log(
            `🔄 /replace: Awaiting in-flight init for ${projectId}/${decodedFileId}`
          );
          docData = await initializingDocs.get(roomName)!;
        }

        if (docData) {
          // Document is in memory — replace Y.Text content in-place
          // This will automatically sync to all connected browsers via the
          // Yjs update broadcast, and persist to Redis via the bound persistence.
          const ytext = docData.doc.getText("content");
          docData.doc.transact(() => {
            ytext.delete(0, ytext.length);
            ytext.insert(0, content);
          });
          console.log(
            `🔄 /replace: Updated in-memory doc ${projectId}/${decodedFileId}, ` +
            `${content.length} chars, clients=${docData.clients.size}`
          );
        } else {
          // Document is NOT in memory (no active connections, no in-flight init).
          // Clear any stale Redis state so the next connection loads from S3
          // (which was already updated by the caller).
          await clearPersistence(projectId, decodedFileId);
          console.log(
            `🔄 /replace: No in-memory doc for ${projectId}/${decodedFileId}, ` +
            `cleared Redis persistence`
          );
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          success: true,
          roomName,
          inMemory: !!docData,
          contentLength: content.length,
        }));
      } catch (err) {
        console.error("❌ Failed to replace document:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: "Failed to replace document" }));
      }
    });
    return;
  }

  // GET /doc/:projectId/:fileId - get document content (used by TAP completion)
  const docMatch = url.match(/^\/doc\/([^\/]+)\/(.+)$/);
  if (req.method === "GET" && docMatch) {
    const [, projectId, fileId] = docMatch;
    // Decode URL-encoded filename (e.g. main.tex)
    const decodedFileId = decodeURIComponent(fileId);
    const roomName = `${projectId}-${decodedFileId}`;
    // Also await in-flight initialization so we don't 404 while a doc is loading.
    let docData = docs.get(roomName);
    if (!docData && initializingDocs.has(roomName)) {
      try {
        docData = await initializingDocs.get(roomName)!;
      } catch (err) {
        console.error(`❌ GET /doc: init failed for ${roomName}:`, err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Document initialization failed" }));
        return;
      }
    }

    if (!docData) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        error: "Document not found",
        roomName,
        availableRooms: Array.from(docs.keys())
      }));
      return;
    }

    const ytext = docData.doc.getText("content");
    const content = ytext.toString();

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      projectId,
      fileId: decodedFileId,
      content,
      length: content.length,
    }));
    return;
  }

  // GET /rooms - list all active rooms (debug)
  if (req.method === "GET" && url === "/rooms") {
    const rooms = Array.from(docs.entries()).map(([name, data]) => ({
      name,
      clients: data.clients.size,
      contentLength: data.doc.getText("content").toString().length,
    }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ rooms }));
    return;
  }

  // POST /doc/:projectId/:fileId - update document content (used by Keep All cross-file edits)
  if (req.method === "POST" && docMatch) {
    const [, projectId, fileId] = docMatch;
    const decodedFileId = decodeURIComponent(fileId);
    const roomName = `${projectId}-${decodedFileId}`;

    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });

    req.on("end", async () => {
      try {
        const { content, blocks } = JSON.parse(body);
        // Also await in-flight initialization so updates aren't silently dropped.
        let docData = docs.get(roomName);
        if (!docData && initializingDocs.has(roomName)) {
          docData = await initializingDocs.get(roomName)!;
        }

        if (!docData) {
          console.log(`[POST] ❌ Document not in memory: ${roomName}, rooms:`, Array.from(docs.keys()));
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            success: true,
            message: "Document not in memory, no update needed"
          }));
          return;
        }
        console.log(`[POST] ✅ Document found: ${roomName}, clients: ${docData.clients.size}`);

        const ytext = docData.doc.getText("content");

        // Apply line-based blocks (incremental update, from bottom to top)
        if (blocks && Array.isArray(blocks)) {
          const sortedBlocks = [...blocks].sort((a, b) => b.startLine - a.startLine);

          docData.doc.transact(() => {
            for (const block of sortedBlocks) {
              const content = ytext.toString();
              const lines = content.split('\n');
              const startIdx = block.startLine - 1;
              const endIdx = block.endLine - 1;

              if (startIdx < 0 || endIdx >= lines.length || startIdx > endIdx) {
                console.warn(`Invalid line range: ${block.startLine}-${block.endLine}`);
                continue;
              }

              // Compute character offsets
              let fromOffset = 0;
              for (let i = 0; i < startIdx; i++) {
                fromOffset += lines[i].length + 1; // +1 for newline
              }
              let toOffset = fromOffset;
              for (let i = startIdx; i <= endIdx; i++) {
                toOffset += lines[i].length;
                // Include the newline after each line (except the very last line of the file)
                if (i < lines.length - 1) {
                  toOffset += 1;
                }
              }

              // 🔑 FIX: Handle newline properly when inserting
              // If we're NOT replacing the last line of the file, and the updated content
              // doesn't end with a newline, we need to add one to maintain line structure
              let contentToInsert = block.updated;
              const isReplacingLastLine = endIdx === lines.length - 1;
              const updatedEndsWithNewline = contentToInsert.endsWith('\n');

              if (!isReplacingLastLine && !updatedEndsWithNewline) {
                // We deleted a range that included a trailing newline,
                // so we need to add it back to separate from the next line
                contentToInsert = contentToInsert + '\n';
              }

              // Incremental update: delete range and insert new content
              ytext.delete(fromOffset, toOffset - fromOffset);
              ytext.insert(fromOffset, contentToInsert);
            }
          });

          console.log(`✏️ Document updated: ${roomName}`);
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          success: true,
          message: "Document updated",
          roomName
        }));
      } catch (err) {
        console.error("❌ Failed to update document:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to update document" }));
      }
    });
    return;
  }

  // POST /relpos/:projectId/:fileId - compute RelativePosition for edit blocks
  const relposMatch = url.match(/^\/relpos\/([^\/]+)\/(.+)$/);
  if (req.method === "POST" && relposMatch) {
    const [, projectId, fileId] = relposMatch;
    const decodedFileId = decodeURIComponent(fileId);
    const roomName = `${projectId}-${decodedFileId}`;

    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });

    req.on("end", async () => {
      try {
        const { blocks } = JSON.parse(body) as { blocks: Array<{ startLine: number; endLine: number; updated: string }> };

        // Get or create document (RelPos computation requires Yjs)
        const docData = await getYDoc(roomName);
        const ytext = docData.doc.getText("content");

        // Compute RelativePosition for each block
        const blocksWithRelPos = blocks.map(block => {
          const { startRelPos, endRelPos } = createRelPosForEdit(ytext, block.startLine, block.endLine);
          return {
            ...block,
            startRelPos,
            endRelPos,
          };
        });

        console.log(`📍 Computed RelPos for ${blocksWithRelPos.length} block(s) in ${roomName}`);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          success: true,
          blocks: blocksWithRelPos
        }));
      } catch (err) {
        console.error("❌ Failed to calculate RelPos:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to calculate RelativePosition" }));
      }
    });
    return;
  }

  // POST /update-line-numbers/:projectId/:fileId - update block line numbers using RelPos
  const updateLineNumbersMatch = url.match(/^\/update-line-numbers\/([^\/]+)\/(.+)$/);
  if (req.method === "POST" && updateLineNumbersMatch) {
    const [, projectId, fileId] = updateLineNumbersMatch;
    const decodedFileId = decodeURIComponent(fileId);
    const roomName = `${projectId}-${decodedFileId}`;

    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });

    req.on("end", async () => {
      try {
        const parsed = JSON.parse(body);
        const blocks = parsed.blocks as Array<{
          startLine: number;
          endLine: number;
          updated: string;
          original?: string;
          startRelPos?: object;
          endRelPos?: object;
        }>;

        // Validate blocks input
        if (!blocks || !Array.isArray(blocks)) {
          console.warn(`[WS] Invalid blocks input:`, typeof blocks);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            success: true,
            blocks: [],
            message: "Invalid blocks input, returning empty array"
          }));
          return;
        }

        // Get document
        const docData = docs.get(roomName);
        if (!docData) {
          // Doc not in memory: return original blocks
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            success: true,
            blocks,
            message: "Document not in memory, using original line numbers"
          }));
          return;
        }

        const ydoc = docData.doc;
        const ytext = ydoc.getText("content");
        const content = ytext.toString();

        // Update line numbers for each block using RelPos
        const updatedBlocks = blocks.map(block => {
          if (!block.startRelPos || !block.endRelPos) {
            // No RelPos: return as-is
            return block;
          }

          try {
            // Parse startRelPos
            const startRelPos = Y.createRelativePositionFromJSON(block.startRelPos);
            const startAbsPos = Y.createAbsolutePositionFromRelativePosition(startRelPos, ydoc);

            // Parse endRelPos
            const endRelPos = Y.createRelativePositionFromJSON(block.endRelPos);
            const endAbsPos = Y.createAbsolutePositionFromRelativePosition(endRelPos, ydoc);

            if (!startAbsPos || !endAbsPos) {
              console.warn(`[WS] Failed to resolve RelPos: ${roomName}`);
              return block;
            }

            // Compute line numbers
            const textBeforeStart = content.slice(0, startAbsPos.index);
            const textBeforeEnd = content.slice(0, endAbsPos.index);
            const newStartLine = textBeforeStart.split("\n").length;
            const newEndLine = textBeforeEnd.split("\n").length;

            return {
              ...block,
              startLine: newStartLine,
              endLine: newEndLine,
            };
          } catch (err) {
            console.error(`[WS] Failed to update line numbers:`, err);
            return block;
          }
        });

        console.log(`📍 Updated line numbers for ${updatedBlocks.length} block(s) in ${roomName}`);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          success: true,
          blocks: updatedBlocks
        }));
      } catch (err) {
        console.error("❌ Failed to update line numbers:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to update line numbers" }));
      }
    });
    return;
  }

  // GET /locks/:projectId/:fileId - get file lock info (other users' pending edits)
  const locksMatch = url.match(/^\/locks\/([^\/]+)\/(.+)$/);
  if (req.method === "GET" && locksMatch) {
    const [, projectId, fileId] = locksMatch;
    const decodedFileId = decodeURIComponent(fileId);
    const roomName = `${projectId}-${decodedFileId}`;

    const docData = docs.get(roomName);

    if (!docData) {
      // Document not in memory - no locks
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        projectId,
        fileId: decodedFileId,
        locks: [],
        message: "Document not in memory"
      }));
      return;
    }

    try {
      // Get the pendingLocks map from the document
      const locksMap = docData.doc.getMap<{
        id: string;
        userId: string;
        userName: string;
        userColor: string;
        fileId: string;
        startLine: number;
        endLine: number;
        startRelPos?: object;
        endRelPos?: object;
      }>("pendingLocks");

      const locks: Array<{
        userId: string;
        userName: string;
        startLine: number;
        endLine: number;
      }> = [];

      // Iterate through all locks and filter for this file
      locksMap.forEach((lock, key) => {
        // Check if this lock is for the requested file
        if (lock.fileId === decodedFileId ||
            lock.fileId === fileId ||
            lock.fileId?.endsWith(decodedFileId) ||
            decodedFileId.endsWith(lock.fileId || '')) {

          // If we have RelativePosition, calculate current line numbers
          let startLine = lock.startLine;
          let endLine = lock.endLine;

          if (lock.startRelPos && lock.endRelPos) {
            try {
              const ydoc = docData.doc;
              const ytext = ydoc.getText("content");
              const content = ytext.toString();

              const startRelPos = Y.createRelativePositionFromJSON(lock.startRelPos);
              const startAbsPos = Y.createAbsolutePositionFromRelativePosition(startRelPos, ydoc);

              const endRelPos = Y.createRelativePositionFromJSON(lock.endRelPos);
              const endAbsPos = Y.createAbsolutePositionFromRelativePosition(endRelPos, ydoc);

              if (startAbsPos && endAbsPos) {
                const textBeforeStart = content.slice(0, startAbsPos.index);
                const textBeforeEnd = content.slice(0, endAbsPos.index);
                startLine = textBeforeStart.split("\n").length;
                endLine = textBeforeEnd.split("\n").length;
              }
            } catch (err) {
              console.warn(`[Locks] Failed to resolve RelPos for lock ${key}:`, err);
            }
          }

          locks.push({
            userId: lock.userId,
            userName: lock.userName,
            startLine,
            endLine,
          });
        }
      });

      console.log(`🔒 Get lock info: ${roomName}, ${locks.length} lock(s)`);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        projectId,
        fileId: decodedFileId,
        locks,
      }));
    } catch (err) {
      console.error("❌ Failed to get locks:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to get locks" }));
    }
    return;
  }

  // GET /vibe-lock/:projectId/:fileId - get Vibe Lock state (AI processing)
  const vibeLockMatch = url.match(/^\/vibe-lock\/([^\/]+)\/(.+)$/);
  if (req.method === "GET" && vibeLockMatch) {
    const [, projectId, fileId] = vibeLockMatch;
    const decodedFileId = decodeURIComponent(fileId);
    const roomName = `${projectId}-${decodedFileId}`;

    const docData = docs.get(roomName);

    if (!docData) {
      // Document not in memory - no vibe lock
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        projectId,
        fileId: decodedFileId,
        isLocked: false,
        message: "Document not in memory"
      }));
      return;
    }

    try {
      // Check awareness states for vibeWriting field
      const awarenessStates = docData.awareness.getStates();
      let lockedBy: { userId: string; userName: string } | null = null;

      awarenessStates.forEach((state, clientId) => {
        // Check if this client has vibeWriting set to this file
        if (state.vibeWriting === decodedFileId || state.vibeWriting === fileId) {
          const user = state.user as { id?: string; name?: string } | undefined;
          if (user) {
            lockedBy = {
              userId: user.id || `client_${clientId}`,
              userName: user.name || "Unknown User",
            };
          }
        }
      });

      console.log(`🔒 Get vibe lock: ${roomName}, locked=${!!lockedBy}`);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        projectId,
        fileId: decodedFileId,
        isLocked: !!lockedBy,
        lockedBy,
      }));
    } catch (err) {
      console.error("❌ Failed to get vibe lock:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to get vibe lock" }));
    }
    return;
  }

  // Default status endpoint
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    status: "ok",
    service: "litewrite-websocket",
    docs: docs.size,
    connections: Array.from(docs.values()).reduce((sum, d) => sum + d.clients.size, 0),
    endpoints: [
      "GET / - Service status",
      "GET /doc/:projectId/:fileId - Get document content",
      "GET /locks/:projectId/:fileId - Get file lock info",
      "GET /vibe-lock/:projectId/:fileId - Get AI-processing lock status",
      "GET /rooms - List active rooms",
      "POST /relpos/:projectId/:fileId - Compute RelativePosition",
      "POST /update-line-numbers/:projectId/:fileId - Update line numbers using RelPos",
    ]
  }));
});

const wss = new WebSocketServer({ server });

console.log(`🚀 Starting Yjs WebSocket server...`);

wss.on("connection", async (ws: WebSocket, req) => {
  // Derive room name from URL
  // 🔑 FIX: Nginx proxy keeps the /ws prefix; strip it.
  // Example: /ws/b140ffee-...-main.tex -> b140ffee-...-main.tex
  let docName = req.url?.slice(1) || "default";
  if (docName.startsWith("ws/")) docName = docName.slice(3);
  // Important: browsers URL-encode non-ASCII paths. We decode here to ensure:
  // - docs Map keys use the real file path (not %E6...)
  // - Redis persistence keys use the same fileId semantics as /clear, /doc, etc.
  try {
    docName = decodeURIComponent(docName);
  } catch {
    // ignore malformed encoding
  }
  console.log(`📝 New connection joined room: ${docName}`);

  // Check whether this is a chat room (chat-projectId)
  const chatMatch = docName.match(/^chat-(.+)$/);
  if (chatMatch) {
    const projectId = chatMatch[1];
    const chatRoom = getChatRoom(projectId);
    chatRoom.add(ws);
    console.log(`💬 Chat room connected: ${projectId}, connections: ${chatRoom.size}`);

    // Handle chat messages
    ws.on("message", (data: Buffer) => {
      try {
        const message = new Uint8Array(data);
        const decoder = decoding.createDecoder(message);
        const messageType = decoding.readVarUint(decoder);

        if (messageType === messageChat) {
          const jsonStr = decoding.readVarString(decoder);
          const chatMessage = JSON.parse(jsonStr) as ChatMessageData;
          console.log(`💬 Received chat message from ${chatMessage.userName}; broadcasting to ${chatRoom.size - 1} other connection(s)`);

          // Broadcast to other users
          broadcastChatMessage(projectId, chatMessage, ws);
        }
      } catch (err) {
        console.error("❌ Chat message handling error:", err);
      }
    });

    ws.on("close", () => {
      chatRoom.delete(ws);
      console.log(`👋 Chat connection closed: ${projectId}, remaining: ${chatRoom.size}`);

      // Cleanup empty chat room
      if (chatRoom.size === 0) {
        chatRooms.delete(projectId);
      }
    });

    ws.on("error", (error) => {
      console.error(`❌ Chat WebSocket error:`, error);
    });

    return; // Chat room does not use Yjs document sync
  }

  // Regular Yjs doc room (async init with Redis restore)
  let docData: DocData;
  try {
    docData = await getYDoc(docName);
  } catch (err) {
    console.error(`❌ Failed to initialize doc for connection: ${docName}`, err);
    try { ws.close(1011, "internal_error"); } catch { /* ignore */ }
    return;
  }

  // If the socket closed while we were waiting for getYDoc(), skip setup
  // to avoid adding a zombie client that can never be removed (the 'close'
  // event already fired before we registered its handler).
  if (ws.readyState !== WebSocket.OPEN) {
    console.log(`⚠️ WebSocket closed during init, skipping setup: ${docName}`);
    // Use delayed cleanup (same as normal close path) to avoid racing with
    // concurrent connections that also awaited the same init promise and
    // haven't added themselves to clients yet.
    setTimeout(() => cleanupDoc(docName), 30_000);
    return;
  }

  const { doc, awareness } = docData;
  docData.clients.add(ws);

  // Track awareness clientID for this connection (the first one received, i.e. the client's own)
  let awarenessClientID: number | null = null;

  // Send sync step 1
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageSync);
  syncProtocol.writeSyncStep1(encoder, doc);
  ws.send(encoding.toUint8Array(encoder));

  // Send current awareness state
  const awarenessStates = awareness.getStates();
  if (awarenessStates.size > 0) {
    const awarenessEncoder = encoding.createEncoder();
    encoding.writeVarUint(awarenessEncoder, messageAwareness);
    encoding.writeVarUint8Array(
      awarenessEncoder,
      awarenessProtocol.encodeAwarenessUpdate(awareness, Array.from(awarenessStates.keys()))
    );
    ws.send(encoding.toUint8Array(awarenessEncoder));
  }

  // Handle incoming messages
  ws.on("message", (data: Buffer) => {
    try {
      const message = new Uint8Array(data);
      const decoder = decoding.createDecoder(message);
      const messageType = decoding.readVarUint(decoder);

      switch (messageType) {
        case messageSync: {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, messageSync);
          syncProtocol.readSyncMessage(decoder, encoder, doc, null);

          // Send response if needed (e.g. SyncStep2)
          if (encoding.length(encoder) > 1) {
            ws.send(encoding.toUint8Array(encoder));
          }
          break;
        }

        case messageAwareness: {
          const update = decoding.readVarUint8Array(decoder);
          awarenessProtocol.applyAwarenessUpdate(awareness, update, ws);

          // Track this connection's awareness clientID (only the first, i.e. the client's own)
          if (awarenessClientID === null) {
            try {
              const decoder2 = decoding.createDecoder(update);
              const len = decoding.readVarUint(decoder2);
              if (len > 0) {
                awarenessClientID = decoding.readVarUint(decoder2);
                console.log(`📋 Recorded connection clientID: ${awarenessClientID}`);
              }
            } catch {
              // Ignore parse errors
            }
          }
          break;
        }
        // Chat messages are only handled via the dedicated chat-${projectId} room
      }
    } catch (err) {
      console.error("❌ Message handling error:", err);
    }
  });

  // Listen for doc updates and broadcast to other clients
  const updateHandler = (update: Uint8Array, origin: unknown) => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeUpdate(encoder, update);
    const message = encoding.toUint8Array(encoder);

    let sent = 0;
    docData.clients.forEach((client) => {
      if (client !== origin && client.readyState === WebSocket.OPEN) {
        client.send(message);
        sent++;
      }
    });
    console.log(`[Broadcast] room=${docName}, clients=${docData.clients.size}, sent=${sent}, origin=${origin === null ? 'null' : origin === undefined ? 'undefined' : 'ws'}`);
  };

  doc.on("update", updateHandler);

  ws.on("close", () => {
    console.log(`👋 Connection closed. Room: ${docName}, removing awareness clientID: ${awarenessClientID}`);
    docData.clients.delete(ws);

    // Remove update listener
    doc.off("update", updateHandler);

    // Remove awareness state for this connection
    if (awarenessClientID !== null) {
      awarenessProtocol.removeAwarenessStates(
        awareness,
        [awarenessClientID],
        null
      );
    }

    // Delay cleanup for empty docs
    if (docData.clients.size === 0) {
      setTimeout(() => cleanupDoc(docName), 5 * 60 * 1000);
    }
  });

  ws.on("error", (error) => {
    console.error(`❌ WebSocket error:`, error);
  });
});

server.listen(PORT, () => {
  console.log(`✅ WebSocket server running at ws://localhost:${PORT}`);
  console.log(`📌 Client URL format: ws://localhost:${PORT}/{room-name}`);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down server...");

  // Cleanup all awareness states and persistence bindings
  docs.forEach((docData, docName) => {
    awarenessProtocol.removeAwarenessStates(
      docData.awareness,
      Array.from(docData.awareness.getStates().keys()),
      null
    );
    if (docData.persistenceCleanup) {
      docData.persistenceCleanup();
    }
    docData.doc.destroy();
  });

  // Close all Redis connections
  await closeAllPersistence();

  wss.close(() => {
    server.close(() => {
      console.log("👋 Server closed");
      process.exit(0);
    });
  });
});
