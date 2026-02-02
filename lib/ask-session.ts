/**
 * Session Manager
 * ===============
 *
 * Manages conversation sessions for Ask and Agent modes.
 * Each user can have multiple sessions per project.
 * Sessions can contain both Ask (Q&A) and Agent (code editing) interactions.
 *
 * Storage structure (S3/Local Storage):
 *   litewrite/{projectId}/sessions/{userId}/{sessionId}.json
 */

import { getStorage } from "@/lib/storage";
import type { AskSession, SessionMessage, SessionMessageItem, LineRange } from "@/types/ask";

// ============================================================================
// Storage Paths
// ============================================================================

/**
 * Get the S3 key for a session file
 */
function getSessionKey(projectId: string, userId: string, sessionId: string): string {
  return `litewrite/${projectId}/sessions/${userId}/${sessionId}.json`;
}

/**
 * Get the S3 key prefix for listing user sessions
 */
function getUserSessionPrefix(projectId: string, userId: string): string {
  return `litewrite/${projectId}/sessions/${userId}/`;
}

// ============================================================================
// Session ID Generation
// ============================================================================

/**
 * Generate unique session ID
 */
export function generateSessionId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}_${random}`;
}

// ============================================================================
// Session CRUD
// ============================================================================

/**
 * Create a new session
 */
export async function createSession(
  projectId: string,
  userId: string,
  title?: string
): Promise<AskSession> {
  const now = Date.now();
  const sessionId = generateSessionId();

  const session: AskSession = {
    id: sessionId,
    projectId,
    userId,
    title: title || "New Chat",
    messages: [],
    // Context compression fields
    compressedHistory: "",  // Empty initially, grows as conversation progresses
    historyTokens: 0,       // Token count of compressedHistory
    createdAt: now,
    updatedAt: now,
  };

  await saveSession(session);
  return session;
}

/**
 * Get session by ID
 */
export async function getSessionById(
  projectId: string,
  userId: string,
  sessionId: string
): Promise<AskSession | null> {
  try {
    const storage = await getStorage();
    const key = getSessionKey(projectId, userId, sessionId);
    const buffer = await storage.download(key);
    const content = buffer.toString("utf-8");
    const session = JSON.parse(content) as AskSession;

    // Verify ownership
    if (session.userId !== userId) {
      console.error(`[getSessionById] Ownership mismatch: session.userId=${session.userId}, requested userId=${userId}`);
      return null;
    }

    return session;
  } catch (error) {
    // Log the actual error for debugging
    console.error(`[getSessionById] Failed to load session:`);
    console.error(`  Key: ${getSessionKey(projectId, userId, sessionId)}`);
    console.error(`  Error:`, error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Save session to storage
 */
export async function saveSession(session: AskSession): Promise<void> {
  if (!session.userId || !session.id) {
    throw new Error("Session must have userId and id");
  }

  session.updatedAt = Date.now();

  const storage = await getStorage();
  const key = getSessionKey(session.projectId, session.userId, session.id);
  await storage.upload(key, JSON.stringify(session, null, 2), "application/json");
}

/**
 * Delete session by ID
 */
export async function deleteSessionById(
  projectId: string,
  userId: string,
  sessionId: string
): Promise<boolean> {
  try {
    const storage = await getStorage();
    const key = getSessionKey(projectId, userId, sessionId);
    await storage.delete(key);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Session Listing
// ============================================================================

/**
 * Session summary for listing
 */
export interface SessionSummary {
  id: string;
  title: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * List all sessions for a user in a project
 * Returns summaries sorted by updatedAt (newest first)
 */
export async function listUserSessions(
  projectId: string,
  userId: string
): Promise<SessionSummary[]> {
  const sessions: SessionSummary[] = [];
  const prefix = getUserSessionPrefix(projectId, userId);

  try {
    const storage = await getStorage();
    const files = await storage.list(prefix);

    for (const file of files) {
      if (!file.key.endsWith(".json")) continue;

      try {
        const buffer = await storage.download(file.key);
        const content = buffer.toString("utf-8");
        const session = JSON.parse(content) as AskSession;

        sessions.push({
          id: session.id,
          title: session.title || "Untitled",
          messageCount: session.messages.length,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
        });
      } catch {
        // Skip invalid files
      }
    }

    // Sort by updatedAt descending (newest first)
    sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    // Prefix doesn't exist or storage error
  }

  return sessions;
}

// ============================================================================
// Message Operations
// ============================================================================

/**
 * Add user message to session
 */
export async function addUserMessage(
  projectId: string,
  userId: string,
  sessionId: string,
  content: string,
  fileRefs?: Array<{ filePath: string; lineRange?: LineRange }>
): Promise<AskSession | null> {
  const session = await getSessionById(projectId, userId, sessionId);
  if (!session) return null;

  // ============================================================================
  // Backward Compatibility: Migrate old sessions without compressedHistory
  // ============================================================================
  // If session has messages but no compressedHistory, build it from existing messages.
  // This ensures old sessions work correctly with the new context management system.
  // The compressedHistory will be sent to AI server, which may trigger compression
  // if it exceeds the token limit.
  if (!session.compressedHistory && session.messages.length > 0) {
    console.log(`[ask-session] Migrating old session ${sessionId}: building compressedHistory from ${session.messages.length} messages`);

    const historyParts: string[] = [];
    for (const msg of session.messages) {
      if (msg.role === "user" || msg.role === "assistant") {
        const textContent = getTextFromItems(msg.items || []);
        if (textContent) {
          historyParts.push(formatMessageForContext(msg.role, textContent));
        }
      }
    }

    if (historyParts.length > 0) {
      session.compressedHistory = historyParts.join("\n\n");
      // Rough estimate: ~0.4 tokens per character
      session.historyTokens = Math.ceil(session.compressedHistory.length * 0.4);
      console.log(`[ask-session] Built compressedHistory: ${session.compressedHistory.length} chars, ~${session.historyTokens} tokens`);
    }
  }

  const message: SessionMessage = {
    role: "user",
    items: [{ type: "text", content }],
    fileRefs,
    timestamp: Date.now(),
  };

  session.messages.push(message);

  // NOTE: Do NOT append to compressedHistory here!
  // The current user message is sent via the `message` field to AI server.
  // compressedHistory should only contain PREVIOUS conversation history.
  // The complete turn (user + assistant) will be appended in addAssistantMessage().

  // Update title from first user message
  if (session.messages.filter(m => m.role === "user").length === 1) {
    session.title = content.slice(0, 50) + (content.length > 50 ? "..." : "");
    // Remove [[FILE:...]] markers from title
    session.title = session.title.replace(/\[\[FILE:[^\]]+\]\]/g, "").trim() || "New Chat";
  }

  // NOTE: No message trimming - UI displays all messages

  await saveSession(session);
  return session;
}

/**
 * Add assistant message to session
 *
 * @param items - Ordered list of message items (text and actions)
 * @param title - Optional session title update
 */
export async function addAssistantMessage(
  projectId: string,
  userId: string,
  sessionId: string,
  items: SessionMessageItem[],
  title?: string
): Promise<AskSession | null> {
  const session = await getSessionById(projectId, userId, sessionId);
  if (!session) return null;

  const message: SessionMessage = {
    role: "assistant",
    items,
    timestamp: Date.now(),
  };

  session.messages.push(message);

  // Append the COMPLETE conversation turn (user + assistant) to compressedHistory
  // This ensures the history is updated only after a full turn is complete

  // Find the previous user message (should be the second-to-last message now)
  const messagesCount = session.messages.length;
  if (messagesCount >= 2) {
    const prevMessage = session.messages[messagesCount - 2];
    if (prevMessage.role === "user") {
      // Append user message to compressedHistory
      const userContent = getTextFromItems(prevMessage.items || []);
      if (userContent) {
        const userFormatted = formatMessageForContext("user", userContent);
        appendToCompressedHistory(session, userFormatted);
      }
    }
  }

  // Append assistant message to compressedHistory
  const textContent = getTextFromItems(items);
  if (textContent) {
    const formatted = formatMessageForContext("assistant", textContent);
    appendToCompressedHistory(session, formatted);
  }

  // Estimate historyTokens (rough estimate: ~0.4 tokens per character for mixed content)
  // This is a rough estimate; the accurate value will be computed by AI server on next request
  session.historyTokens = Math.ceil((session.compressedHistory?.length || 0) * 0.4);

  // Update title if provided (from LLM-generated title)
  if (title) {
    session.title = title;
  }

  // NOTE: No message trimming - UI displays all messages

  await saveSession(session);
  return session;
}

/**
 * Replace compressedHistory with compressed version from AI server
 * Called when AI server compresses the history due to token limit
 *
 * @param compressedHistory - New compressed history string
 * @param historyTokens - Token count of the compressed history
 */
export async function replaceCompressedHistory(
  projectId: string,
  userId: string,
  sessionId: string,
  compressedHistory: string,
  historyTokens: number
): Promise<AskSession | null> {
  const session = await getSessionById(projectId, userId, sessionId);
  if (!session) return null;

  session.compressedHistory = compressedHistory;
  session.historyTokens = historyTokens;

  await saveSession(session);
  return session;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get text content from message items
 */
function getTextFromItems(items: SessionMessageItem[]): string {
  return items
    .filter((item): item is { type: "text"; content: string } => item.type === "text")
    .map(item => item.content)
    .join("");
}

/**
 * Format a single message for the compressedHistory context
 * Used when appending new messages to compressedHistory
 */
function formatMessageForContext(role: "user" | "assistant", content: string): string {
  const roleLabel = role === "user" ? "User" : "Assistant";
  return `${roleLabel}: ${content}`;
}

/**
 * Append formatted message to session's compressedHistory
 */
function appendToCompressedHistory(session: AskSession, formatted: string): void {
  if (session.compressedHistory) {
    session.compressedHistory += "\n\n" + formatted;
  } else {
    session.compressedHistory = formatted;
  }
}

// ============================================================================
// Legacy Support (for migration)
// ============================================================================

/**
 * Get session for a user (legacy - returns most recent session or creates new)
 * @deprecated Use getSessionById or listUserSessions instead
 */
export async function getSession(
  projectId: string,
  userId: string
): Promise<AskSession | null> {
  const sessions = await listUserSessions(projectId, userId);
  if (sessions.length > 0) {
    return getSessionById(projectId, userId, sessions[0].id);
  }
  return null;
}

/**
 * Get or create session (legacy - for backward compatibility)
 * @deprecated Use createSession and getSessionById instead
 */
export async function getOrCreateSession(
  projectId: string,
  userId: string
): Promise<AskSession> {
  const existing = await getSession(projectId, userId);
  if (existing) {
    return existing;
  }
  return createSession(projectId, userId);
}

/**
 * Clear session (legacy - creates new session)
 * @deprecated Use deleteSessionById and createSession instead
 */
export async function clearSession(
  projectId: string,
  userId: string
): Promise<AskSession> {
  return createSession(projectId, userId);
}

const askSessionManager = {
  generateSessionId,
  createSession,
  getSessionById,
  saveSession,
  deleteSessionById,
  listUserSessions,
  addUserMessage,
  addAssistantMessage,
  replaceCompressedHistory,
  // Legacy
  getSession,
  getOrCreateSession,
  clearSession,
};

export default askSessionManager;
