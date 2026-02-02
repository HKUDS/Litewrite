/**
 * Ask Mode Type Definitions
 * =========================
 *
 * Shared types for Ask mode across frontend and backend.
 */

// Line range
export interface LineRange {
  start: number;
  end: number;
}

// Attachment type
export interface Attachment {
  id: string;
  type: "file" | "selection";
  filePath: string;
  fileName: string;
  lineRange?: LineRange;
  preview?: string;  // Content preview
}

// Ask request
export interface AskRequest {
  projectId: string;
  message: string;
  attachments: Attachment[];
  conversationId?: string;
  enableRAG?: boolean;
}

// SSE event types
export type AskEventType =
  | "status"
  | "message"
  | "reference"
  | "tool_call"    // Agent requests tool execution
  | "context"      // Agent using context
  | "file_edit"    // Agent mode: file edit request
  | "file_locked"  // Agent mode: file being read by AI
  | "error"
  | "done";

// Status event
export interface AskStatusEvent {
  type: "status";
  data: {
    status: string;
    message: string;
  };
}

// Message event (streaming)
export interface AskMessageEvent {
  type: "message";
  data: {
    chunk: string;
    messageId: string;
  };
}

// LaTeX code block event
export interface AskLatexBlockEvent {
  type: "latex_block";
  data: {
    blockId: string;
    content: string;
    blockType: "general" | "equation" | "table" | "figure" | "section";
    description?: string;
    lineRange?: LineRange;
  };
}

// Reference info event
export interface AskReferenceEvent {
  type: "reference";
  data: {
    refType: "file" | "selection" | "context";
    title: string;
    content?: string;
    filePath?: string;
    lineRange?: LineRange;
  };
}

// Error event
export interface AskErrorEvent {
  type: "error";
  data: {
    code: string;
    message: string;
    recoverable: boolean;
  };
}

// Done event
export interface AskDoneEvent {
  type: "done";
  data: {
    conversationId: string;
    summary: string;
    hasLatexOutput: boolean;
    stats?: {
      intent: string;
      latexBlocks: number;
      contextParts: number;
      language?: string;
    };
  };
}

// History compressed event - AI server compressed the history
export interface AskHistoryCompressedEvent {
  type: "history_compressed";
  data: {
    compressedHistory: string;  // New compressed history to replace session's
    tokensBefore: number;       // Token count before compression
    tokensAfter: number;        // Token count after compression
  };
}

// Token usage event - current context usage
export interface AskTokenUsageEvent {
  type: "token_usage";
  data: {
    historyTokens: number;      // Current history token count
    historyLimit: number;       // History limit (configurable, default 64K)
    historyUsagePercent: number; // Usage percentage
    executionTokens: number;    // Current execution context tokens
    executionLimit: number;     // Execution limit (configurable, default 64K)
  };
}

// ============================================================================
// Agent Mode: File Operation Events
// ============================================================================

/**
 * Yjs RelativePosition (serialized as JSON)
 *
 * This is NOT string matching - it uses CRDT unique IDs.
 * Each character in Y.Text has a unique ID that never changes.
 * RelativePosition stores this ID, automatically tracking the correct
 * position even when other users insert/delete content around it.
 */
export type RelativePositionJSON = object;

/**
 * Edit block - line-based edit specification with RelativePosition tracking
 *
 * Uses line numbers for merge logic (fixed at creation time)
 * Uses RelativePosition for display/apply (automatically tracks position changes)
 */
export interface EditBlock {
  startLine: number;  // 1-based, inclusive (fixed at creation, used for merge)
  endLine: number;    // 1-based, inclusive (fixed at creation, used for merge)
  updated: string;    // Replacement content (can be multiple lines)
  original?: string;  // Original content being replaced (for diff display)

  // Yjs RelativePosition for robust position tracking
  // Calculated by frontend (which has Yjs) at edit creation time
  // Used to get CURRENT line numbers when displaying/applying edits
  startRelPos?: RelativePositionJSON;
  endRelPos?: RelativePositionJSON;
}

/**
 * File edit event - Agent requests to modify a file
 */
export interface AskFileEditEvent {
  type: "file_edit";
  data: {
    editId: string;
    filePath: string;
    blocks: EditBlock[];
    description?: string;
  };
}

// Pending file edit (for UI tracking)
export interface PendingFileEdit {
  editId: string;
  filePath: string;
  blocks: EditBlock[];
  description?: string;
  status: "pending" | "applying" | "applied" | "rejected";
}

// Stream event - for ordered display of text and edits
export type StreamEvent =
  | { type: "text"; content: string; id: string }
  | { type: "file_edit"; edit: PendingFileEdit; id: string };

// Union event type
export type AskEvent =
  | AskStatusEvent
  | AskMessageEvent
  | AskReferenceEvent
  | AskToolCallEvent
  | AskContextEvent
  | AskFileEditEvent
  | AskErrorEvent
  | AskDoneEvent
  | AskHistoryCompressedEvent
  | AskTokenUsageEvent;

// LaTeX code block (for UI rendering)
export interface LatexBlock {
  id: string;
  content: string;
  type: string;
  description?: string;
}

/**
 * Chat message item - for UI rendering
 * Similar to SessionMessageItem but for ChatMessage
 */
export type ChatMessageItem =
  | { type: "text"; content: string }
  | { type: "action"; action: SessionAction };

// Chat message
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  // Ordered list of message items
  items?: ChatMessageItem[];
  timestamp: Date;
  attachments?: Attachment[];
  references?: AskReferenceEvent["data"][];

  // === Legacy fields (for backward compatibility) ===
  // @deprecated Use items instead
  content?: string;
  // @deprecated Use items instead
  actions?: SessionAction[];
  // @deprecated No longer used
  latexBlocks?: LatexBlock[];
}

// Conversation
export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// Session & Tool-calling Agent Types
// ============================================================================

/**
 * Edit block for session action (line-based)
 */
export interface SessionEditBlock {
  startLine: number;
  endLine: number;
  updated: string;
  // For display purposes: snippet of what was replaced
  originalSnippet?: string;
}

/**
 * Action performed by assistant (for history tracking)
 */
export interface SessionAction {
  type: "edit_file";
  filePath: string;
  // Show what was changed
  lineRange?: { start: number; end: number };  // Which lines were edited
  originalSnippet?: string;  // First ~100 chars of original content
  updatedSnippet?: string;   // First ~100 chars of updated content
  // Full edit blocks (stored for session replay/review)
  blocks?: SessionEditBlock[];
  // Description of what was done
  description?: string;
}

/**
 * Session message item - ordered content in a message
 * Items are stored in order, preserving the sequence of text and actions
 */
export type SessionMessageItem =
  | { type: "text"; content: string }
  | { type: "action"; action: SessionAction };

/**
 * Session message for history tracking
 * Uses items array to preserve order of text and actions
 */
export interface SessionMessage {
  role: "user" | "assistant";
  // Ordered list of message items (text and actions in sequence)
  items: SessionMessageItem[];
  // User messages may have file references
  fileRefs?: Array<{
    filePath: string;
    lineRange?: LineRange;
  }>;
  timestamp: number;

  // === Legacy fields (for backward compatibility) ===
  // @deprecated Use items instead
  content?: string;
  // @deprecated Use items instead
  actions?: SessionAction[];
  // @deprecated No longer used
  hasLatex?: boolean;
  // @deprecated No longer used
  latexBlocks?: LatexBlock[];
}

/**
 * Session Plan - tracks current AI plan during execution
 */
export interface SessionPlan {
  goal: string;
  steps: Array<{
    id: string;
    description: string;
    status: "pending" | "in_progress" | "completed" | "failed";
  }>;
  createdAt: number;
}

/**
 * Ask Session - maintained by Next.js
 * One user can have multiple sessions per project
 */
export interface AskSession {
  id: string;
  projectId: string;
  userId: string;
  title: string;  // Generated from first user message
  messages: SessionMessage[];
  // Current plan being executed (optional, only during active plan execution)
  currentPlan?: SessionPlan;
  createdAt: number;
  updatedAt: number;

  // === Context Compression ===
  // Pre-formatted history string for sending to AI
  // - Each new message is formatted and appended
  // - When compressed by AI, this is replaced with the compressed version
  // - After compression, new messages continue to be appended
  compressedHistory?: string;

  // Current token count of compressedHistory (updated by AI server)
  historyTokens?: number;

  // === Legacy fields (for backward compatibility) ===
  // @deprecated No longer used
  referencedFiles?: string[];
  // @deprecated No longer used
  attachedContents?: Record<string, string>;
}

/**
 * Session summary for listing (lighter than full session)
 */
export interface SessionSummary {
  id: string;
  title: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Tool types for Ask Agent
 */
export type AskToolType =
  | "read_file"      // Read specific file content
  | "search_keyword" // Keyword search in project
  | "search_section" // Extract LaTeX section
  | "list_files"     // List project files
  | "edit_file"      // Edit existing file
  | "create_file"    // Create new file
  | "delete_file";   // Delete file

/**
 * Tool call params for read_file
 */
export interface ReadFileParams {
  file_path?: string;
  start_line?: number;
  end_line?: number;
}

/**
 * Tool call params for search_section
 */
export interface SearchSectionParams {
  section_name?: string;
  include_subsections?: boolean;
}

/**
 * Tool call params for list_files
 */
export interface ListFilesParams {
  directory?: string;
  pattern?: string;
}

/**
 * Tool call params for edit_file
 */
export interface EditFileParams {
  file_path?: string;
  search_replace_blocks?: string;
  description?: string;
}

/**
 * Tool call params for create_file
 */
export interface CreateFileParams {
  file_path?: string;
  content?: string;
}

/**
 * Tool call params for delete_file
 */
export interface DeleteFileParams {
  file_path?: string;
  reason?: string;
}

/**
 * Tool call from AI Agent
 */
export interface AskToolCall {
  id: string;
  type: AskToolType;
  params: {
    // read_file (camelCase for legacy)
    filePath?: string;
    lineRange?: LineRange;
    // read_file (snake_case for new API)
    file_path?: string;
    start_line?: number;
    end_line?: number;
    // search_keyword
    keyword?: string;
    maxResults?: number;
    // search_section
    sectionName?: string;
    section_name?: string;
    include_subsections?: boolean;
    // list_files
    directory?: string;
    pattern?: string;
    // edit_file
    search_replace_blocks?: string;
    description?: string;
    // create_file
    content?: string;
    // delete_file
    reason?: string;
  };
}

/**
 * Tool result returned to AI Agent
 */
export interface AskToolResult {
  callId: string;
  type: AskToolType;
  success: boolean;
  data?: {
    content?: string;
    filePath?: string;
    lineRange?: LineRange;
    matches?: Array<{
      file: string;
      line: number;
      content: string;
      context?: string;
    }>;
    files?: string[];
    // edit_file specific
    description?: string;
    blocks?: Array<{
      original: string;
      updated: string;
    }>;
    originalContent?: string;
    // delete_file specific
    reason?: string;
  };
  error?: string;
}

/**
 * Tool call event (AI requests tool execution)
 */
export interface AskToolCallEvent {
  type: "tool_call";
  data: {
    calls: AskToolCall[];
  };
}

/**
 * Context event (AI using context from tools/history)
 */
export interface AskContextEvent {
  type: "context";
  data: {
    source: "history" | "tool" | "attachment";
    description: string;
    filePath?: string;
    lineRange?: LineRange;
  };
}

// Extended request with session support
export interface AskRequestWithSession extends AskRequest {
  sessionId?: string;
  // History is managed by Next.js, sent to ai-server
  history?: SessionMessage[];
}

// ============================================================================
// Pending Edit Lock Types (for collaboration)
// ============================================================================

/**
 * Lock information for collaborative editing
 * Synced via Yjs Awareness so other users can see locked regions
 *
 * Uses RelativePosition for robust position tracking:
 * - startLine/endLine are computed from RelativePosition at render time
 * - startRelPos/endRelPos are the persistent references
 */
export interface PendingLockInfo {
  id: string;              // Lock ID (matches edit ID)
  userId: string;          // Who created this lock
  userName: string;        // Display name
  userColor: string;       // User's color for UI
  fileId: string;          // Which file (normalized path)
  startLine: number;       // Computed from RelativePosition (1-based)
  endLine: number;         // Computed from RelativePosition (inclusive)
  startRelPos?: RelativePositionJSON;  // For robust tracking
  endRelPos?: RelativePositionJSON;    // For robust tracking
  createdAt: number;
}

/**
 * Edit lock for CodeMirror extension
 *
 * Uses RelativePosition for robust position tracking
 */
export interface EditLock {
  editId: string;
  startLine: number;       // Computed from RelativePosition
  endLine: number;         // Computed from RelativePosition
  startRelPos?: RelativePositionJSON;  // For robust tracking
  endRelPos?: RelativePositionJSON;    // For robust tracking
  isOwn: boolean;          // true = own pending edit, false = other user's lock
  userName?: string;       // For other user's locks
  userColor?: string;      // For other user's locks
}

// ============================================================================
// Deep Research Types
// ============================================================================

/**
 * Process Step for Deep Research
 */
export interface DeepResearchProcessStep {
  id: string;
  type: string;
  message: string;
  timestamp: string | Date;  // ISO string when persisted
  data?: Record<string, unknown>;  // Event payload
}

/**
 * Deep Research Report
 *
 * A one-time research result, not a chat session.
 * Each query produces one report with references.
 */
export interface DeepResearchReport {
  id: string;
  projectId: string;
  userId: string;
  query: string;
  report: string;
  bibtex: string;
  references: string;
  processSteps?: DeepResearchProcessStep[];  // Research process for display
  createdAt: number;
}

/**
 * Deep Research Report Summary for listing
 */
export interface DeepResearchReportSummary {
  id: string;
  query: string;
  queryPreview: string;  // Truncated query for display
  createdAt: number;
}
