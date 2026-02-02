import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiError, AUTH_ERRORS, CHAT_ERRORS, PROJECT_ERRORS } from "@/lib/api-errors";
import { getServerCapabilities } from "@/lib/capabilities";
import { getStorage, StoragePaths, isTextFile } from "@/lib/storage";
import {
  createSession,
  getSessionById,
  saveSession,
  addUserMessage,
  addAssistantMessage,
  listUserSessions,
  deleteSessionById,
} from "@/lib/ask-session";
import {
  getPendingEdits,
  type PendingEdit,
  type EditBlock,
} from "@/lib/pending-edits";
import {
  getEffectiveContent,
  regenerateShadowDocument,
  writeShadowDocument,
} from "@/lib/shadow-documents";
import {
  computeDiff,
  type DiffBlock,
} from "@/lib/diff-engine";
import type {
  Attachment,
  AskToolCall,
  AskToolResult,
  LineRange,
  SessionAction,
  SessionEditBlock,
  SessionMessageItem,
} from "@/types/ask";

const AI_SERVER_URL = process.env.AI_SERVER_URL || "http://localhost:6612";

// ============================================================================
// File System Helpers
// ============================================================================

/**
 * List all text files in a project (Plan B: only list files, do not pre-read content).
 * Content is fetched by getEffectiveContent (prefer Yjs).
 */
async function listProjectFiles(projectId: string): Promise<string[]> {
  try {
    const storage = await getStorage();
    const prefix = StoragePaths.projectPrefix(projectId);
    const files = await storage.list(prefix);

    // Filter to text files and skip hidden directories
    return files
      .filter(f => {
        const relativePath = f.key.replace(prefix, "");
        // Skip hidden directories and files
        if (relativePath.split("/").some(part => part.startsWith("."))) {
          return false;
        }
        // Only include text files
        return isTextFile(f.key);
      })
      .map(f => f.key.replace(prefix, ""));
  } catch {
    // Storage error
    return [];
  }
}

// ============================================================================
// Shadow Document Generation (LINE-BASED)
// ============================================================================

/**
 * Apply pending edits to content to generate shadow document.
 * Uses LINE-BASED positioning for precise, robust edit handling.
 *
 * @param originalContent - The original file content
 * @param pendingEdits - Array of pending edits
 * @param filePath - Path of the file being edited
 * @returns Content with all pending edits applied
 */
function applyShadowEdits(
  originalContent: string,
  pendingEdits: PendingEdit[],
  filePath: string
): string {
  // Filter edits for this file and status is pending
  const fileEdits = pendingEdits.filter(
    (edit) =>
      edit.status === "pending" &&
      (edit.filePath === filePath ||
        edit.filePath.endsWith(filePath) ||
        filePath.endsWith(edit.filePath) ||
        // Also match by filename only
        filePath.includes(edit.filePath.split('/').pop() || '') ||
        edit.filePath.includes(filePath.split('/').pop() || ''))
  );

  if (fileEdits.length === 0) {
    return originalContent;
  }

  // Split content into lines
  const lines = originalContent.split('\n');

  // Collect all blocks and sort by startLine descending
  // Apply from bottom to top to prevent line number shifts
  const allBlocks: Array<{
    startLine: number;
    endLine: number;
    updated: string;
  }> = [];

  for (const edit of fileEdits) {
    for (const block of edit.blocks) {
      allBlocks.push({
        startLine: block.startLine,
        endLine: block.endLine,
        updated: block.updated,
      });
    }
      }

  // Sort by startLine descending (apply from bottom to top)
  allBlocks.sort((a, b) => b.startLine - a.startLine);

  // Apply each block
  for (const block of allBlocks) {
    // Convert to 0-based index
    const startIdx = block.startLine - 1;
    const endIdx = block.endLine - 1;

    // Validate indices
    if (startIdx < 0 || endIdx >= lines.length || startIdx > endIdx) {
      console.warn(`[Shadow] Invalid line range: ${block.startLine}-${block.endLine} (total lines: ${lines.length})`);
        continue;
      }

    // Split updated content into lines
    const updatedLines = block.updated.split('\n');

    // Replace the specified line range with updated content
    lines.splice(startIdx, endIdx - startIdx + 1, ...updatedLines);
  }

  return lines.join('\n');
}

/**
 * Apply shadow edits to all project files
 */
function applyPendingEditsToFiles(
  files: ProjectFile[],
  pendingEdits: PendingEdit[]
): ProjectFile[] {
  if (!pendingEdits || pendingEdits.length === 0) {
    return files;
  }

  return files.map((file) => ({
    path: file.path,
    content: applyShadowEdits(file.content, pendingEdits, file.path),
  }));
}

/**
 * Apply shadow edits to attachedContents (historical attachments).
 * This ensures AI sees the shadow version of all historical content.
 *
 * Keys in attachedContents are like:
 * - "main.tex"
 * - "main.tex (lines 14-16)"
 */
function applyShadowToAttachedContents(
  attachedContents: Record<string, string>,
  pendingEdits: PendingEdit[]
): Record<string, string> {
  if (!attachedContents || !pendingEdits || pendingEdits.length === 0) {
    return attachedContents;
  }

  const result: Record<string, string> = {};

  for (const [key, content] of Object.entries(attachedContents)) {
    // Extract filename from key (e.g., "main.tex" or "main.tex (lines 14-16)")
    const match = key.match(/^([^\s(]+)/);
    const filePath = match ? match[1] : key;

    // Apply shadow edits to this content
    result[key] = applyShadowEdits(content, pendingEdits, filePath);
  }

  return result;
}

// ============================================================================
// Tool Executors
// ============================================================================

interface ProjectFile {
  path: string;
  content: string;
}

/**
 * Execute read_file tool
 */
async function executeReadFile(
  files: ProjectFile[],
  params: { file_path?: string; start_line?: number; end_line?: number }
): Promise<AskToolResult> {
  const { file_path, start_line, end_line } = params;

  if (!file_path) {
    return {
      callId: "",
      type: "read_file",
      success: false,
      error: "file_path is required",
    };
  }

  // Find file (exact or partial match)
  let file = files.find((f) => f.path === file_path);
  if (!file) {
    file = files.find((f) => f.path.endsWith(file_path) || f.path.includes(file_path));
  }

  if (!file) {
    return {
      callId: "",
      type: "read_file",
      success: false,
      error: `File not found: ${file_path}`,
    };
  }

  let content = file.content;
  let lineRange: LineRange | undefined;

  // Extract line range if specified
  if (start_line || end_line) {
    const lines = content.split("\n");
    const start = Math.max(0, (start_line || 1) - 1);
    const end = Math.min(lines.length, end_line || lines.length);
    content = lines.slice(start, end).join("\n");
    lineRange = { start: start + 1, end };
  }

  return {
    callId: "",
    type: "read_file",
    success: true,
    data: {
      content,
      filePath: file.path,
      lineRange,
    },
  };
}

/**
 * Execute search_keyword tool
 */
async function executeSearchKeyword(
  files: ProjectFile[],
  params: { keyword?: string; max_results?: number; file_pattern?: string }
): Promise<AskToolResult> {
  const { keyword, max_results = 10, file_pattern } = params;

  if (!keyword) {
    return {
      callId: "",
      type: "search_keyword",
      success: false,
      error: "keyword is required",
    };
  }

  const matches: Array<{ file: string; line: number; content: string; context?: string }> = [];
  const keywordLower = keyword.toLowerCase();

  for (const file of files) {
    // Filter by file pattern if specified
    if (file_pattern && !file.path.endsWith(file_pattern)) {
      continue;
    }

    const lines = file.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(keywordLower)) {
        // Get context (2 lines before and after)
        const contextStart = Math.max(0, i - 2);
        const contextEnd = Math.min(lines.length - 1, i + 2);
        const context = lines.slice(contextStart, contextEnd + 1).join("\n");

        matches.push({
          file: file.path,
          line: i + 1,
          content: lines[i].trim(),
          context,
        });

        if (matches.length >= max_results) {
          break;
        }
      }
    }

    if (matches.length >= max_results) {
      break;
    }
  }

  return {
    callId: "",
    type: "search_keyword",
    success: true,
    data: { matches },
  };
}

/**
 * Execute search_section tool
 */
async function executeSearchSection(
  files: ProjectFile[],
  params: { section_name?: string; include_subsections?: boolean }
): Promise<AskToolResult> {
  const { section_name, include_subsections = true } = params;

  if (!section_name) {
    return {
      callId: "",
      type: "search_section",
      success: false,
      error: "section_name is required",
    };
  }

  // Build regex for section extraction
  const sectionPattern = include_subsections
    ? `\\\\section\\{${section_name}\\}([\\s\\S]*?)(?=\\\\section\\{|\\\\end\\{document\\}|$)`
    : `\\\\section\\{${section_name}\\}([\\s\\S]*?)(?=\\\\(?:sub)?section\\{|\\\\end\\{document\\}|$)`;

  const sectionRegex = new RegExp(sectionPattern, "i");

  for (const file of files) {
    if (!file.path.endsWith(".tex")) continue;

    const match = file.content.match(sectionRegex);
    if (match) {
      return {
        callId: "",
        type: "search_section",
        success: true,
        data: {
          content: match[0].trim(),
          filePath: file.path,
        },
      };
    }
  }

  return {
    callId: "",
    type: "search_section",
    success: false,
    error: `Section not found: ${section_name}`,
  };
}

/**
 * Execute list_files tool
 */
async function executeListFiles(
  files: ProjectFile[],
  params: { directory?: string; pattern?: string }
): Promise<AskToolResult> {
  const { directory = "", pattern } = params;

  let filteredFiles = files.map((f) => f.path);

  // Filter by directory
  if (directory) {
    filteredFiles = filteredFiles.filter((f) => f.startsWith(directory));
  }

  // Filter by pattern
  if (pattern) {
    filteredFiles = filteredFiles.filter((f) => f.endsWith(pattern));
  }

  return {
    callId: "",
    type: "list_files",
    success: true,
    data: { files: filteredFiles },
  };
}

// ============================================================================
// Agent Mode Tool Executors (Write Operations)
// ============================================================================

/**
 * Execute edit_file tool (chat_1_5 format: line-based edits)
 */
async function executeEditFile(
  projectId: string,
  files: ProjectFile[],
  params: {
    file_path?: string;
    start_line?: number;
    end_line?: number;
    updated?: string;
    description?: string;
  }
): Promise<AskToolResult & { editRequest?: EditRequest }> {
  const { file_path, start_line, end_line, updated, description } = params;

  // Validate required params
  if (!file_path) {
    return {
      callId: "",
      type: "edit_file",
      success: false,
      error: "file_path is required",
    };
  }

  if (start_line === undefined || end_line === undefined || updated === undefined) {
    return {
      callId: "",
      type: "edit_file",
      success: false,
      error: "start_line, end_line, and updated are required",
    };
  }

  // Find file
  let file = files.find((f) => f.path === file_path);
  if (!file) {
    file = files.find((f) => f.path.endsWith(file_path) || f.path.includes(file_path));
  }

  if (!file) {
    return {
      callId: "",
      type: "edit_file",
      success: false,
      error: `File not found: ${file_path}`,
    };
  }

  const lines = file.content.split('\n');

  // Validate line numbers (1-based)
  if (start_line < 1 || end_line < start_line || end_line > lines.length) {
    return {
      callId: "",
      type: "edit_file",
      success: false,
      error: `Invalid line range: ${start_line}-${end_line} (file has ${lines.length} lines)`,
    };
  }

  // Extract original content (convert to 0-based index)
  const originalLines = lines.slice(start_line - 1, end_line);
  const original = originalLines.join('\n');

  // Return edit request
  return {
    callId: "",
    type: "edit_file",
    success: true,
    data: {
      filePath: file.path,
      description: description || "File edit",
      blocks: [{ original, updated }],
      originalContent: file.content,
    },
    editRequest: {
      editId: `edit_${Date.now()}`,
      filePath: file.path,
      projectId,
      blocks: [{
        original,
        updated,
        startLine: start_line,
        endLine: end_line,
      }] as Array<{ original: string; updated: string; startLine?: number; endLine?: number }>,
      description: description || "File edit",
    },
  };
}

interface EditRequest {
  editId: string;
  filePath: string;
  projectId: string;
  blocks: Array<{ original: string; updated: string }>;
  description: string;
}

/**
 * Execute a tool call
 */
async function executeTool(
  projectId: string,
  files: ProjectFile[],
  call: AskToolCall
): Promise<AskToolResult & { editRequest?: EditRequest }> {
  let result: AskToolResult & { editRequest?: EditRequest };

  switch (call.type) {
    case "read_file":
      result = await executeReadFile(files, call.params);
      break;
    case "search_keyword":
      result = await executeSearchKeyword(files, call.params);
      break;
    case "search_section":
      result = await executeSearchSection(files, call.params);
      break;
    case "list_files":
      result = await executeListFiles(files, call.params);
      break;
    // Agent mode tools
    case "edit_file":
      result = await executeEditFile(projectId, files, call.params);
      break;
    default:
      result = {
        callId: call.id,
        type: call.type,
        success: false,
        error: `Unknown tool type: ${call.type}`,
      };
  }

  result.callId = call.id;
  return result;
}

// ============================================================================
// Request Types
// ============================================================================

interface AskRequestBody {
  projectId: string;
  message: string;
  attachments: Attachment[];
  enableRAG?: boolean;
  sessionId?: string;  // If not provided, creates new session
  mode?: "ask" | "agent";  // Default: "ask"
}

// ============================================================================
// Main API Handler
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const caps = getServerCapabilities();
    if (!caps.aiEnabled) {
      return apiError({ code: "feature.disabled", message: caps.aiReason }, 403);
    }

    // 1. Authenticate user
    const session = await auth();
    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    const body: AskRequestBody = await request.json();
    const { projectId, message, attachments, enableRAG = false, sessionId, mode = "ask" } = body;

    // 2. Verify project access
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        OR: [
          { ownerId: session.user.id },
          { collaborators: { some: { userId: session.user.id } } },
        ],
      },
    });

    if (!project) {
      return apiError(PROJECT_ERRORS.NO_ACCESS, 404);
    }

    // 3. Get or create Ask session
    const userId = session.user.id;

    let askSession;
    if (sessionId) {
      // Use existing session
      console.log(`[Ask API] Loading session: projectId=${projectId}, userId=${userId}, sessionId=${sessionId}`);
      askSession = await getSessionById(projectId, userId, sessionId);
      if (!askSession) {
        console.error(`[Ask API] Session NOT FOUND! sessionId=${sessionId}`);
        return apiError(CHAT_ERRORS.SESSION_NOT_FOUND, 404);
      }
      console.log(`[Ask API] Session loaded: ${askSession.id}, messages=${askSession.messages.length}`);
    } else {
      // Create new session
      askSession = await createSession(projectId, userId);
      console.log(`[Ask API] Created new session: ${askSession.id}`);
    }

    // 4. List project files (Plan B: only list files, do not pre-read content)
    const fileList = await listProjectFiles(projectId);

    // 4.5. Get user's pending edits for shadow document generation
    const userPendingEdits = await getPendingEdits(projectId, userId);

    // 4.6. Build shadow files - content is fetched by getEffectiveContent (prefer Yjs)
    const shadowFiles: ProjectFile[] = await Promise.all(
      fileList.map(async (filePath) => {
    // getEffectiveContent prefers Yjs and falls back to storage
        const effectiveContent = await getEffectiveContent(projectId, userId, filePath);
        return {
          path: filePath,
          content: effectiveContent || "",
        };
      })
    );

    // 5. Read attachment contents (from shadow documents, not original files)
    const attachmentsWithContent = await Promise.all(
      attachments.map(async (att) => {
        // Use shadow files (with pending edits applied) instead of original files
        const file = shadowFiles.find((f) => f.path === att.filePath);
        if (!file) {
          return { ...att, content: null };
        }

        let content = file.content || "";

        // Extract line range if specified
        if (att.lineRange) {
          const lines = content.split("\n");
          const startIdx = Math.max(0, att.lineRange.start - 1);
          const endIdx = Math.min(lines.length, att.lineRange.end);
          content = lines.slice(startIdx, endIdx).join("\n");
        }

        return {
          type: att.type,
          filePath: att.filePath,
          content,
          lineRange: att.lineRange,
        };
      })
    );

    // 6. Add user message to session
    const fileRefs = attachments
      .filter((att) => att.filePath)
      .map((att) => ({
        filePath: att.filePath,
        lineRange: att.lineRange,
      }));

    await addUserMessage(
      projectId,
      userId,
      askSession.id,
      message,
      fileRefs.length > 0 ? fileRefs : undefined
    );

    // Reload session to get updated attachedContents
    const updatedSession = await getSessionById(projectId, userId, askSession.id);

    // 7. Apply shadow edits to historical attachedContents
    // This ensures AI sees the content as user sees it (with all pending edits applied)
    const originalAttachedContents = updatedSession?.attachedContents || {};
    const shadowAttachedContents = applyShadowToAttachedContents(
      originalAttachedContents,
      userPendingEdits?.pendingEdits || []
    );

    // 7.5. Get file locks from other users (for collaborative editing)
    // This tells the AI which lines are being edited by other users and should not be modified
    const wsServerUrl = process.env.WS_SERVER_URL || "http://localhost:1234";
    const fileLocks: Record<string, Array<{ userId: string; userName: string; startLine: number; endLine: number }>> = {};

    // Get locks for all attached files
    const attachedFilePaths = new Set<string>();
    for (const att of attachmentsWithContent) {
      if (att.filePath) {
        attachedFilePaths.add(att.filePath);
      }
    }
    for (const key of Object.keys(shadowAttachedContents)) {
      // Extract filename from key (e.g., "main.tex" or "main.tex (lines 14-16)")
      const match = key.match(/^([^\s(]+)/);
      if (match) {
        attachedFilePaths.add(match[1]);
      }
    }

    // Fetch locks for each file (in parallel)
    await Promise.all(
      Array.from(attachedFilePaths).map(async (filePath) => {
        try {
          const locksResponse = await fetch(
            `${wsServerUrl}/locks/${projectId}/${encodeURIComponent(filePath)}`
          );
          if (locksResponse.ok) {
            const locksData = await locksResponse.json();
            // Filter out current user's locks - only include OTHER users' locks
            const otherUsersLocks = (locksData.locks || []).filter(
              (lock: { userId: string }) => lock.userId !== userId
            );
            if (otherUsersLocks.length > 0) {
              fileLocks[filePath] = otherUsersLocks;
              console.log(`[Ask API] Got ${otherUsersLocks.length} locks for ${filePath}`);
            }
          }
        } catch (err) {
          // Ignore errors - locks are optional
          console.warn(`[Ask API] Failed to get locks for ${filePath}:`, err);
        }
      })
    );

    // Build history - EXCLUDE the current user message (we just added it above)
    // The current message is sent via `message` field, not in history
    const allMessages = updatedSession?.messages || askSession.messages;
    const historyMessages = allMessages.slice(0, -1);  // Exclude last message (current user message)

    console.log(`[Ask API] Building history: allMessages=${allMessages.length}, historyMessages=${historyMessages.length}`);
    if (historyMessages.length > 0) {
      console.log(`[Ask API] First history message role=${historyMessages[0].role}, has items=${!!historyMessages[0].items}, has content=${!!historyMessages[0].content}`);
    }

    // Get compressedHistory from session (new context management)
    // This is the pre-formatted history string for AI context
    const sessionForHistory = updatedSession || askSession;
    const compressedHistory = sessionForHistory.compressedHistory || "";

    console.log(`[Ask API] compressedHistory: ${compressedHistory.length} chars`);

    const aiServerRequest = {
      projectId,
      message,
      attachments: attachmentsWithContent,
      sessionId: askSession.id,
      history: historyMessages,
      compressedHistory,  // New: pre-formatted history string for context management
      referencedFiles: updatedSession?.referencedFiles || askSession.referencedFiles,
      attachedContents: shadowAttachedContents,  // Include shadow version of historical attachments
      fileList,
      mode,  // "ask" or "agent"
      // Pass file locks from other users (for collaborative editing)
      fileLocks: Object.keys(fileLocks).length > 0 ? fileLocks : undefined,
    // Pass actorId for file locks / pending edits attribution (NOT payments/credits)
      actorId: userId,
    };

    // 8. Make initial request to AI server
    const response = await fetch(`${AI_SERVER_URL}/api/chat/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(aiServerRequest),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: `AI Server error: ${errorText}` },
        { status: response.status }
      );
    }

    // 9. Process SSE stream, handle tool calls
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    let fullResponse = "";
    let sessionTitle: string | undefined = undefined;

    // Collect message items in order (text and actions)
    const sessionItems: SessionMessageItem[] = [];

    // Track current SSE event type (MUST persist across chunks!)
    // SSE events may be split: "event: file_edit\n" in one chunk, "data: {...}\n\n" in next
    let currentEventType = "";

    // Track processed file_edit editIds to prevent duplicate events
    // Both tool_call path and PlanExec path may trigger file_edit events for the same edit
    // We only send the first one to avoid frontend receiving duplicate events
    const processedFileEditIds = new Set<string>();

    const transformStream = new TransformStream({
      async transform(chunk, controller) {
        const text = decoder.decode(chunk, { stream: true });
        const lines = text.split("\n");

        for (const line of lines) {
          // Track SSE event type
          if (line.startsWith("event: ")) {
            currentEventType = line.slice(7).trim();
            // For file_edit events, we will send our own enriched event later
            // Don't forward the original event line to avoid duplicate events
            if (currentEventType === "file_edit") {
              continue;  // Skip forwarding, will send enriched event when processing data line
            }
            // For other events, forward the event line to client
            controller.enqueue(encoder.encode(line + "\n"));
            continue;
          }

          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));

              // Handle tool_call events
              if (currentEventType === "tool_call") {
                currentEventType = "";  // Reset after handling
              }

              // Handle tool_call
              if (data.calls && Array.isArray(data.calls)) {
                // Execute tools
                const toolResults: AskToolResult[] = [];
                const pendingEdits: Array<{
                  editId: string;
                  filePath: string;
                  blocks: Array<{ original: string; updated: string }>;
                  description: string;
                }> = [];

                for (const call of data.calls) {
                  // Use shadow files (with pending edits applied) for tool execution
                  // This ensures edit_file checks against the user's view of the file
                  const result = await executeTool(projectId, shadowFiles, call);
                  toolResults.push(result);

                  // If this is a read_file tool, send file_locked event
                  if (result.type === "read_file" && result.success && result.data?.filePath) {
                    const lockedFilePath = result.data.filePath as string;
                    controller.enqueue(encoder.encode(
                      `event: file_locked\ndata: ${JSON.stringify({ filePath: lockedFilePath })}\n\n`
                    ));
                    console.log(`[Ask] Sent file_locked event for: ${lockedFilePath}`);
                  }

                  // If this is an edit_file tool with editRequest, send file_edit event
                  if (result.editRequest) {
                    // ============================================================
                    // Correct flow: compute accurate startLine/endLine via diff
                    // ============================================================

                    // Step 1: fetch original Yjs content
                    const wsServerUrl = process.env.WS_SERVER_URL || "http://localhost:1234";
                    let yjsOriginalContent: string | null = null;
                    try {
                      const yjsResponse = await fetch(
                        `${wsServerUrl}/doc/${projectId}/${encodeURIComponent(result.editRequest.filePath)}`
                      );
                      if (yjsResponse.ok) {
                        const yjsData = await yjsResponse.json();
                        yjsOriginalContent = yjsData.content;
                        console.log(`[Ask] Got Yjs content for ${result.editRequest.filePath}, length: ${yjsOriginalContent?.length}`);
                      }
                    } catch (err) {
                      console.error("[Ask] Failed to fetch Yjs content:", err);
                    }

                    // If Yjs is unavailable, fall back to storage
                    if (!yjsOriginalContent) {
                      try {
                        const storage = await getStorage();
                        const key = StoragePaths.projectFile(projectId, result.editRequest.filePath);
                        const buffer = await storage.download(key);
                        yjsOriginalContent = buffer.toString("utf-8");
                        console.log(`[Ask] Using storage file for ${result.editRequest.filePath}`);
                      } catch {
                        console.error(`[Ask] File not found: ${result.editRequest.filePath}`);
                      }
                    }

                    if (yjsOriginalContent) {
                      // Step 2: get existing Shadow Doc (includes effects of prior pending edits)
                      const shadowContentBeforeEdit = await getEffectiveContent(projectId, userId, result.editRequest.filePath) || yjsOriginalContent;
                      let shadowContent = shadowContentBeforeEdit;
                      console.log(`[Ask] Starting from shadow doc, length: ${shadowContent.length}`);

                      // ============================================================
                      // Two tracks:
                      // 1. sessionBlocks - only the blocks generated in this run, used for SSE/UI
                      // 2. allBlocks - all diff blocks, used for pending edits storage
                      // ============================================================

                      // Step 2.5a: build sessionBlocks from the AI raw blocks
                      // Line numbers are based on the Shadow Doc; original is taken from the Shadow Doc line range.
                      const shadowLines = shadowContentBeforeEdit.split('\n');
                      const aiBlocks = result.editRequest.blocks as Array<{ startLine: number; endLine: number; updated: string; original?: string }>;

                      const sessionBlocks: DiffBlock[] = aiBlocks.map(block => {
                        // Get original content from the Shadow Doc (line numbers are Shadow-Doc-based)
                        const originalLines = shadowLines.slice(block.startLine - 1, block.endLine);
                        return {
                          startLine: block.startLine,
                          endLine: block.endLine,
                          original: originalLines.join('\n'),
                          updated: block.updated,
                        };
                      });
                      console.log(`[Ask] Session blocks (this edit only): ${sessionBlocks.length} blocks`);

                      // Step 2.5b: apply the new blocks onto the Shadow Doc
                      for (const block of aiBlocks) {
                        if (block.original && shadowContent.includes(block.original)) {
                          shadowContent = shadowContent.replace(block.original, block.updated);
                        } else if (block.startLine && block.endLine) {
                          // Fallback: apply by line numbers
                          const lines = shadowContent.split('\n');
                          const updatedLines = block.updated.split('\n');
                          lines.splice(block.startLine - 1, block.endLine - block.startLine + 1, ...updatedLines);
                          shadowContent = lines.join('\n');
                        }
                      }

                      // Step 3: computeDiff to get all diffs (including prior pending edits + new edits)
                      const diffResult = computeDiff(yjsOriginalContent, shadowContent);
                      console.log(`[Ask] All diff blocks (for pending edits): ${diffResult.blocks.length} blocks`);

                      // Step 4: call WS server to compute RelativePosition for all diff blocks
                      let allBlocksWithRelPos: DiffBlock[] = diffResult.blocks;
                      try {
                        const relPosResponse = await fetch(
                          `${wsServerUrl}/relpos/${projectId}/${encodeURIComponent(result.editRequest.filePath)}`,
                          {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ blocks: diffResult.blocks }),
                          }
                        );
                        if (relPosResponse.ok) {
                          const relPosData = await relPosResponse.json();
                          allBlocksWithRelPos = relPosData.blocks || diffResult.blocks;
                          console.log(`[Ask] Got RelPos for ${allBlocksWithRelPos.length} blocks`);
                        }
                      } catch (err) {
                        console.error("[Ask] Failed to get RelPos:", err);
                      }

                      // Step 4.5: compute RelativePosition for sessionBlocks
                      let sessionBlocksWithRelPos: DiffBlock[] = sessionBlocks;
                      try {
                        const relPosResponse = await fetch(
                          `${wsServerUrl}/relpos/${projectId}/${encodeURIComponent(result.editRequest.filePath)}`,
                          {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ blocks: sessionBlocks }),
                          }
                        );
                        if (relPosResponse.ok) {
                          const relPosData = await relPosResponse.json();
                          sessionBlocksWithRelPos = relPosData.blocks || sessionBlocks;
                        }
                      } catch (err) {
                        console.error("[Ask] Failed to get RelPos for session blocks:", err);
                      }

                      // Step 5: save Shadow Doc
                      await writeShadowDocument(projectId, userId, result.editRequest.filePath, shadowContent);

                      // Step 6: send SSE event
                      // blocks: blocks generated in this run (for UI)
                      // allBlocks: all diff blocks (for pending edits storage)
                      // Check if this editId was already processed by PlanExec path
                      // Skip to avoid sending duplicate file_edit events to frontend
                      if (processedFileEditIds.has(result.editRequest.editId)) {
                        console.log(`[Ask] Skipping duplicate file_edit: ${result.editRequest.editId}`);
                      } else {
                        const editEvent = {
                          type: "file_edit",
                          data: {
                            editId: result.editRequest.editId,
                            filePath: result.editRequest.filePath,
                            blocks: sessionBlocksWithRelPos,  // For UI display
                            allBlocks: allBlocksWithRelPos,   // For pending edits storage
                            description: result.editRequest.description,
                          },
                        };
                        controller.enqueue(encoder.encode(
                          `event: file_edit\ndata: ${JSON.stringify(editEvent.data)}\n\n`
                        ));

                        // Mark this editId as processed to prevent duplicate events from PlanExec path
                        processedFileEditIds.add(result.editRequest.editId);
                        console.log(`[Ask] Sent file_edit event, marked as processed: ${result.editRequest.editId}`);

                        // Step 7: save all diff blocks to pending edits
                        const updatedEditRequest = {
                          ...result.editRequest,
                          blocks: allBlocksWithRelPos,  // Persist all blocks
                        };
                        pendingEdits.push(updatedEditRequest);

                        // Collect action to items - record only this run's blocks
                        const firstBlock = sessionBlocksWithRelPos[0];
                        sessionItems.push({
                          type: "action",
                          action: {
                            type: "edit_file",
                            filePath: result.editRequest.filePath,
                            originalSnippet: firstBlock?.original?.substring(0, 100),
                            updatedSnippet: firstBlock?.updated?.substring(0, 100),
                            blocks: sessionBlocksWithRelPos.map((b): SessionEditBlock => ({
                              startLine: b.startLine,
                              endLine: b.endLine,
                              updated: b.updated,
                              originalSnippet: b.original?.substring(0, 100),
                            })),
                            description: result.editRequest.description,
                          },
                        });
                      }
                    } else {
                      console.error(`[Ask] Cannot process edit: no original content available`);
                    }
                  }
                }

                // ============================================================
                // chat_1_5 Architecture: POST results to /api/tools/result
                // This resolves PendingCallsManager Futures, allowing the
                // original SSE stream to continue (no need for /api/chat/continue)
                // ============================================================

                // Convert toolResults to the format expected by /api/tools/result
                const toolResultsForAI = toolResults.map(r => ({
                  callId: r.callId,  // Use callId from AskToolResult
                  type: r.type,
                  success: r.success,
                  data: r.data,
                  error: r.error,
                }));

                try {
                  const toolResultResponse = await fetch(
                    `${AI_SERVER_URL}/api/tools/result`,
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ results: toolResultsForAI }),
                    }
                  );

                  if (toolResultResponse.ok) {
                    const resultData = await toolResultResponse.json();
                    console.log(`[Ask] Posted tool results to AI server: resolved=${resultData.resolved}, failed=${resultData.failed?.length || 0}`);
                  } else {
                    console.error(`[Ask] Failed to post tool results: ${toolResultResponse.status}`);
                  }
                } catch (err) {
                  console.error("[Ask] Error posting tool results:", err);
                }

                // Don't forward the tool_call event, but continue reading the SSE stream
                // The original stream will continue after PendingCallsManager resolves
                continue;
              }

              // Track message content and collect to items
              if (data.chunk) {
                fullResponse += data.chunk;

                // Collect to items - append to last text item or create new one
                const lastItem = sessionItems[sessionItems.length - 1];
                if (lastItem?.type === "text") {
                  lastItem.content += data.chunk;
                } else {
                  sessionItems.push({ type: "text", content: data.chunk });
                }
              }
              // Capture LLM-generated title for new sessions
              if (data.title) {
                sessionTitle = data.title;
              }

              // Capture file_edit events from Plan-and-Execute mode
              // (AI server sends these directly, not via tool_call)
              // Note: AI server sends {"type": "file_edit", "data": {...}}, so we need to check data.type
              const fileEditData = data.type === "file_edit" ? data.data : data;
              if (fileEditData?.editId && fileEditData?.filePath && fileEditData?.blocks) {
                // Check if this editId was already processed by tool_call path
                // Skip to avoid sending duplicate file_edit events to frontend
                if (processedFileEditIds.has(fileEditData.editId)) {
                  console.log(`[Ask/PlanExec] Skipping duplicate file_edit: ${fileEditData.editId}`);
                  continue;
                }

                console.log(`[Ask/PlanExec] Processing file_edit event: ${fileEditData.filePath}, ${fileEditData.blocks.length} blocks`);
                // ============================================================
                // Correct flow: compute accurate startLine/endLine via diff
                // ============================================================

                // Step 1: fetch original Yjs content
                const wsServerUrl = process.env.WS_SERVER_URL || "http://localhost:1234";
                let yjsOriginalContent: string | null = null;
                try {
                  const yjsResponse = await fetch(
                    `${wsServerUrl}/doc/${projectId}/${encodeURIComponent(fileEditData.filePath)}`
                  );
                  if (yjsResponse.ok) {
                    const yjsData = await yjsResponse.json();
                    yjsOriginalContent = yjsData.content;
                    console.log(`[Ask/PlanExec] Got Yjs content for ${fileEditData.filePath}, length: ${yjsOriginalContent?.length}`);
                  }
                } catch (err) {
                  console.error("[Ask/PlanExec] Failed to fetch Yjs content:", err);
                }

                // If Yjs is unavailable, fall back to storage
                if (!yjsOriginalContent) {
                  try {
                    const storage = await getStorage();
                    const key = StoragePaths.projectFile(projectId, fileEditData.filePath);
                    const buffer = await storage.download(key);
                    yjsOriginalContent = buffer.toString("utf-8");
                    console.log(`[Ask/PlanExec] Using storage file for ${fileEditData.filePath}`);
                  } catch {
                    console.error(`[Ask/PlanExec] File not found: ${fileEditData.filePath}`);
                  }
                }

                if (yjsOriginalContent) {
                  // Step 2: get existing Shadow Doc (includes effects of prior pending edits)
                  // If no Shadow Doc exists, start from the original Yjs content
                  const shadowContentBeforeEdit = await getEffectiveContent(projectId, userId, fileEditData.filePath) || yjsOriginalContent;
                  let shadowContent = shadowContentBeforeEdit;
                  console.log(`[Ask/PlanExec] Starting from shadow doc, length: ${shadowContent.length}`);

                  // ============================================================
                  // Two tracks:
                  // 1. sessionBlocks - only the blocks generated in this run, used for SSE/UI
                  // 2. allBlocks - all diff blocks, used for pending edits storage
                  // ============================================================

                  // Step 2.5a: build sessionBlocks from the AI raw blocks
                  // Line numbers are based on the Shadow Doc; original is taken from the Shadow Doc line range.
                  const shadowLines = shadowContentBeforeEdit.split('\n');
                  const aiBlocks = fileEditData.blocks as Array<{ startLine: number; endLine: number; updated: string }>;

                  const sessionBlocks: DiffBlock[] = aiBlocks.map((block: { startLine: number; endLine: number; updated: string }) => {
                    // Get original content from the Shadow Doc (line numbers are Shadow-Doc-based)
                    const originalLines = shadowLines.slice(block.startLine - 1, block.endLine);
                    return {
                      startLine: block.startLine,
                      endLine: block.endLine,
                      original: originalLines.join('\n'),
                      updated: block.updated,
                    };
                  });
                  console.log(`[Ask/PlanExec] Session blocks (this edit only): ${sessionBlocks.length} blocks`);

                  // Step 2.5b: apply new blocks from the AI onto the Shadow Doc
                  // IMPORTANT: the AI sees the Shadow Doc (via getEffectiveContent), so the line numbers are Shadow-Doc-based.
                  // We can apply directly by line number on the Shadow Doc.
                  const sortedBlocks = [...aiBlocks].sort((a, b) => b.startLine - a.startLine);

                  for (const block of sortedBlocks) {
                    const lines = shadowContent.split('\n');
                    const startIdx = Math.max(0, block.startLine - 1);
                    const endIdx = Math.min(lines.length, block.endLine);
                    const updatedLines = block.updated.split('\n');
                    lines.splice(startIdx, endIdx - startIdx, ...updatedLines);
                    shadowContent = lines.join('\n');
                    console.log(`[Ask/PlanExec] Applied block: lines ${block.startLine}-${block.endLine} -> ${updatedLines.length} lines`);
                  }

                  // Step 3: computeDiff to get accurate startLine/endLine
                  // This includes all diffs: prior pending edits + new edits
                  const diffResult = computeDiff(yjsOriginalContent, shadowContent);
                  console.log(`[Ask/PlanExec] All diff blocks (for pending edits): ${diffResult.blocks.length} blocks`);

                  // Step 4: call WS server to compute RelativePosition for all diff blocks
                  let allBlocksWithRelPos: DiffBlock[] = diffResult.blocks;
                  try {
                    const relPosResponse = await fetch(
                      `${wsServerUrl}/relpos/${projectId}/${encodeURIComponent(fileEditData.filePath)}`,
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ blocks: diffResult.blocks }),
                      }
                    );
                    if (relPosResponse.ok) {
                      const relPosData = await relPosResponse.json();
                      allBlocksWithRelPos = relPosData.blocks || diffResult.blocks;
                      console.log(`[Ask/PlanExec] Got RelPos for ${allBlocksWithRelPos.length} blocks`);
                    }
                  } catch (err) {
                    console.error("[Ask/PlanExec] Failed to get RelPos:", err);
                  }

                  // Step 4.5: compute RelativePosition for sessionBlocks
                  let sessionBlocksWithRelPos: DiffBlock[] = sessionBlocks;
                  try {
                    const relPosResponse = await fetch(
                      `${wsServerUrl}/relpos/${projectId}/${encodeURIComponent(fileEditData.filePath)}`,
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ blocks: sessionBlocks }),
                      }
                    );
                    if (relPosResponse.ok) {
                      const relPosData = await relPosResponse.json();
                      sessionBlocksWithRelPos = relPosData.blocks || sessionBlocks;
                    }
                  } catch (err) {
                    console.error("[Ask/PlanExec] Failed to get RelPos for session blocks:", err);
                  }

                  // Step 5: save Shadow Doc
                  await writeShadowDocument(projectId, userId, fileEditData.filePath, shadowContent);

                  // Step 6: send SSE event - only send blocks generated in this run
                  const enrichedData = {
                    ...fileEditData,
                    blocks: sessionBlocksWithRelPos,  // Only this run's blocks
                    allBlocks: allBlocksWithRelPos,   // Also send all blocks so the frontend can persist pending edits
                  };
                  controller.enqueue(encoder.encode(`event: file_edit\ndata: ${JSON.stringify(enrichedData)}\n\n`));

                  // Mark this editId as processed
                  processedFileEditIds.add(fileEditData.editId);
                  console.log(`[Ask/PlanExec] Sent file_edit event, marked as processed: ${fileEditData.editId}`);

                  // Collect action to items - record only this run's blocks
                  const firstBlock = sessionBlocksWithRelPos[0];
                  sessionItems.push({
                    type: "action",
                    action: {
                      type: "edit_file",
                      filePath: fileEditData.filePath,
                      originalSnippet: firstBlock?.original?.substring(0, 100),
                      updatedSnippet: firstBlock?.updated?.substring(0, 100),
                      blocks: sessionBlocksWithRelPos.map((b): SessionEditBlock => ({
                        startLine: b.startLine,
                        endLine: b.endLine,
                        updated: b.updated,
                        originalSnippet: b.original?.substring(0, 100),
                      })),
                      description: fileEditData.description || "",
                    },
                  });
                  console.log(`[Ask/PlanExec] Added action to sessionItems, total: ${sessionItems.length}`);
                } else {
                  // No original content; forward the raw data as-is
                  controller.enqueue(encoder.encode(`event: file_edit\ndata: ${JSON.stringify(fileEditData)}\n\n`));
                  // Mark this editId as processed
                  processedFileEditIds.add(fileEditData.editId);
                  console.log(`[Ask/PlanExec] Sent file_edit event (no Yjs content), marked as processed: ${fileEditData.editId}`);
                }
                continue;  // Skip the default forward below
              }
            } catch {
              // Not JSON or parsing failed, just forward
            }
          }

          // Forward line to client
          // Special case: if currentEventType is "file_edit" but we didn't process it above
          // (e.g., data line missing required fields), we still need to forward the event line
          // to maintain valid SSE format and let the client know this was a file_edit event
          if (currentEventType === "file_edit" && line.startsWith("data: ")) {
            controller.enqueue(encoder.encode(`event: file_edit\n${line}\n`));
            currentEventType = "";  // Reset after forwarding
          } else if (currentEventType === "done" && line.startsWith("data: ")) {
            // Intercept done event and add conversationId + title
            try {
              const doneData = JSON.parse(line.slice(6));
              const enrichedDoneData = {
                ...doneData,
                conversationId: askSession.id,
                title: sessionTitle,
              };
              controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify(enrichedDoneData)}\n\n`));
              console.log(`[Ask API] Enriched done event with conversationId: ${askSession.id}`);
            } catch {
              // If parsing fails, forward as-is
              controller.enqueue(encoder.encode(line + "\n"));
            }
            currentEventType = "";  // Reset after handling
          } else {
            controller.enqueue(encoder.encode(line + "\n"));
          }
        }
      },

      async flush() {
        // Save assistant response to session with items
        if (sessionItems.length > 0) {
          await addAssistantMessage(
            projectId,
            userId,
            askSession.id,
            sessionItems,
            sessionTitle
          );
        }
      },
    });

    return new Response(response.body?.pipeThrough(transformStream), {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("[Ask API Error]", error);
    return apiError(CHAT_ERRORS.SEND_FAILED, 500);
  }
}

/**
 * GET /api/chat?projectId=xxx - Get all sessions list
 * GET /api/chat?projectId=xxx&sessionId=xxx - Get specific session
 */
export async function GET(request: NextRequest) {
  try {
    const caps = getServerCapabilities();
    if (!caps.aiEnabled) {
      return apiError({ code: "feature.disabled", message: caps.aiReason }, 403);
    }

    // 1. Authenticate user
    const session = await auth();
    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    const sessionId = searchParams.get("sessionId");

    if (!projectId) {
      return apiError(CHAT_ERRORS.PROJECT_ID_REQUIRED, 400);
    }

    // 2. Verify project access
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        OR: [
          { ownerId: session.user.id },
          { collaborators: { some: { userId: session.user.id } } },
        ],
      },
    });

    if (!project) {
      return apiError(PROJECT_ERRORS.NO_ACCESS, 404);
    }

    const userId = session.user.id;

    // 3a. Get specific session
    if (sessionId) {
      const askSession = await getSessionById(projectId, userId, sessionId);

      if (!askSession) {
        return apiError(CHAT_ERRORS.SESSION_NOT_FOUND, 404);
      }

      return NextResponse.json({
        session: askSession,
      });
    }

    // 3b. Get all sessions list
    const sessions = await listUserSessions(projectId, userId);

    return NextResponse.json({
      sessions,
    });
  } catch (error) {
    console.error("[Ask API GET Error]", error);
    return apiError(CHAT_ERRORS.GET_FAILED, 500);
  }
}

/**
 * DELETE /api/chat?projectId=xxx&sessionId=xxx - Delete a session
 */
export async function DELETE(request: NextRequest) {
  try {
    const caps = getServerCapabilities();
    if (!caps.aiEnabled) {
      return apiError({ code: "feature.disabled", message: caps.aiReason }, 403);
    }

    const session = await auth();
    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    const sessionId = searchParams.get("sessionId");

    if (!projectId || !sessionId) {
      return apiError(CHAT_ERRORS.PROJECT_AND_SESSION_ID_REQUIRED, 400);
    }

    // Verify project access
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        OR: [
          { ownerId: session.user.id },
          { collaborators: { some: { userId: session.user.id } } },
        ],
      },
    });

    if (!project) {
      return apiError(PROJECT_ERRORS.NO_ACCESS, 404);
    }

    const success = await deleteSessionById(projectId, session.user.id, sessionId);

    return NextResponse.json({ success });
  } catch (error) {
    console.error("[Ask API DELETE Error]", error);
    return apiError(CHAT_ERRORS.DELETE_FAILED, 500);
  }
}

// ============================================================================
// Edit Approval API
// ============================================================================

interface ApplyEditRequest {
  projectId: string;
  filePath: string;
  blocks: Array<{
    startLine: number;
    endLine: number;
    original: string;
    updated: string;
  }>;
  action: "apply" | "reject";
}

/**
 * PATCH /api/chat - Apply or reject file edits
 */
export async function PATCH(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    const body: ApplyEditRequest = await request.json();
    const { projectId, filePath, blocks, action } = body;

    if (!projectId || !filePath || !blocks) {
      return apiError(CHAT_ERRORS.APPLY_EDIT_PARAMS_REQUIRED, 400);
    }

    // Verify project access
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        OR: [
          { ownerId: session.user.id },
          { collaborators: { some: { userId: session.user.id } } },
        ],
      },
    });

    if (!project) {
      return apiError(PROJECT_ERRORS.NO_ACCESS, 404);
    }

    // If rejected, just return success
    if (action === "reject") {
      return NextResponse.json({
        success: true,
        action: "rejected",
      });
    }

    // Apply the edit (LINE-BASED)
    const storage = await getStorage();
    const fileKey = StoragePaths.projectFile(projectId, filePath);

    try {
      // 🔑 KEY FIX: Try to get content from Yjs server first (has latest edits)
      // Then fallback to storage if Yjs document is not in memory
      let content: string;
      const wsServerUrl = process.env.WS_SERVER_URL || "http://localhost:1234";

      try {
        const yjsResponse = await fetch(
          `${wsServerUrl}/doc/${projectId}/${encodeURIComponent(filePath)}`,
          { method: "GET" }
        );

        if (yjsResponse.ok) {
          const yjsData = await yjsResponse.json();
          content = yjsData.content;
          console.log(`[Apply Edit] Using Yjs content (${content.split('\n').length} lines)`);
        } else {
          // Yjs doesn't have this document, fallback to storage
          console.log(`[Apply Edit] Yjs document not found, falling back to storage`);
          const buffer = await storage.download(fileKey);
          content = buffer.toString("utf-8");
        }
      } catch (yjsErr) {
        // Network error or ws-server not running, fallback to storage
        console.log(`[Apply Edit] Yjs server error, falling back to storage:`, yjsErr);
        const buffer = await storage.download(fileKey);
        content = buffer.toString("utf-8");
      }

      const lines = content.split('\n');

      // Sort blocks by startLine descending to apply from bottom to top
      const sortedBlocks = [...blocks].sort((a, b) => b.startLine - a.startLine);

      // Apply each line-based block
      for (const block of sortedBlocks) {
        // Convert to 0-based index
        const startIdx = block.startLine - 1;
        const endIdx = block.endLine - 1;

        // Validate indices
        if (startIdx < 0 || endIdx >= lines.length || startIdx > endIdx) {
          return apiError(CHAT_ERRORS.INVALID_LINE_RANGE, 400, {
            startLine: block.startLine,
            endLine: block.endLine,
            totalLines: lines.length,
          });
        }

        // Split updated content into lines
        const updatedLines = block.updated.split('\n');

        // Replace the specified line range with updated content
        lines.splice(startIdx, endIdx - startIdx + 1, ...updatedLines);
      }

      const newContent = lines.join('\n');

      // Write updated content to storage
      await storage.upload(fileKey, newContent, "text/plain");

      // Also update Yjs server if document is in memory
      try {
        const wsServerUrl = process.env.WS_SERVER_URL || "http://localhost:1234";
        await fetch(`${wsServerUrl}/doc/${projectId}/${encodeURIComponent(filePath)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ blocks }),
        });
      } catch (yjsErr) {
        // Yjs update is optional, don't fail if it errors
        console.warn("[Yjs Update Warning]", yjsErr);
      }

      return NextResponse.json({
        success: true,
        action: "applied",
        filePath,
      });
    } catch (err) {
      console.error("[Apply Edit Error]", err);
      return apiError(CHAT_ERRORS.APPLY_EDIT_FAILED, 500);
    }
  } catch (error) {
    console.error("[Ask API PATCH Error]", error);
    return apiError(CHAT_ERRORS.APPLY_EDIT_FAILED, 500);
  }
}
