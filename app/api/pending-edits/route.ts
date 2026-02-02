import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiError, AUTH_ERRORS, PROJECT_ERRORS, PENDING_EDITS_ERRORS } from "@/lib/api-errors";
import {
  getPendingEdits,
  savePendingEdits,
  addPendingEdit,
  removePendingEdit,
  clearPendingEdits,
  updateCurrentEditIndex,
  type PendingEdit,
} from "@/lib/pending-edits";
import {
  regenerateShadowDocument,
  regenerateAllShadowDocuments,
  clearUserShadowDocuments,
} from "@/lib/shadow-documents";

// ============================================================================
// GET /api/pending-edits?projectId=xxx
// Returns all pending edits for the current user in the project
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");

    if (!projectId) {
      return apiError(PENDING_EDITS_ERRORS.PROJECT_ID_REQUIRED, 400);
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

    const data = await getPendingEdits(projectId, session.user.id);

    return NextResponse.json({
      success: true,
      data: data || {
        userId: session.user.id,
        projectId,
        pendingEdits: [],
        currentEditIndex: 0,
        updatedAt: Date.now(),
      },
    });
  } catch (error) {
    console.error("[Pending Edits API GET Error]", error);
    return apiError(PENDING_EDITS_ERRORS.GET_FAILED, 500);
  }
}

// ============================================================================
// POST /api/pending-edits
// Add a new pending edit
// Body: { projectId, filePath, blocks, description? }
// ============================================================================

interface AddEditBody {
  projectId: string;
  filePath: string;
  blocks: Array<{ startLine: number; endLine: number; updated: string; original?: string }>;
  description?: string;
}

// WebSocket server URL
const WS_SERVER_URL = process.env.WS_SERVER_URL || "http://localhost:1234";

/**
 * Call the WebSocket server to compute RelativePosition for blocks.
 */
async function getBlocksWithRelPos(
  projectId: string,
  filePath: string,
  blocks: AddEditBody["blocks"]
): Promise<AddEditBody["blocks"]> {
  try {
    const response = await fetch(
      `${WS_SERVER_URL}/relpos/${projectId}/${encodeURIComponent(filePath)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocks }),
      }
    );

    if (response.ok) {
      const result = await response.json();
      console.log("[PendingEdits] Got RelPos from WS server:", result.blocks?.length, "blocks");
      return result.blocks || blocks;
    } else {
      console.error("[PendingEdits] Failed to get RelPos from WS server:", response.status);
      return blocks;
    }
  } catch (err) {
    console.error("[PendingEdits] Error calling WS server for RelPos:", err);
    return blocks;
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    const body: AddEditBody = await request.json();
    const { projectId, filePath, blocks, description } = body;

    if (!projectId) {
      return apiError(PENDING_EDITS_ERRORS.PROJECT_ID_REQUIRED, 400);
    }
    if (!filePath) {
      return apiError(PENDING_EDITS_ERRORS.FILE_PATH_REQUIRED, 400);
    }
    if (!blocks) {
      return apiError(PENDING_EDITS_ERRORS.BLOCKS_REQUIRED, 400);
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

    // Call the WebSocket server to compute RelativePosition.
    // This keeps both the computation and persistence on the server side to avoid losing RelPos data.
    const blocksWithRelPos = await getBlocksWithRelPos(projectId, filePath, blocks);

    const newEdit = await addPendingEdit(projectId, session.user.id, {
      projectId,
      filePath,
      blocks: blocksWithRelPos,
      description,
    });

    // Regenerate shadow document for this file
    await regenerateShadowDocument(projectId, session.user.id, filePath);

    // Get the full pending edits data after merge (single source of truth)
    const fullData = await getPendingEdits(projectId, session.user.id);

    return NextResponse.json({
      success: true,
      edit: newEdit,
      // Return full pendingEdits array so frontend can sync directly
      pendingEdits: fullData?.pendingEdits || [newEdit],
      currentEditIndex: fullData?.currentEditIndex || 0,
    });
  } catch (error) {
    console.error("[Pending Edits API POST Error]", error);
    return apiError(PENDING_EDITS_ERRORS.ADD_FAILED, 500);
  }
}

// ============================================================================
// PUT /api/pending-edits
// Update pending edits (batch save, update index, etc.)
// Body: { projectId, action, ... }
// Actions:
//   - "save": { pendingEdits, currentEditIndex }
//   - "updateIndex": { currentEditIndex }
//   - "remove": { editId }
//   - "clear": {}
// ============================================================================

interface UpdateBody {
  projectId: string;
  action: "save" | "updateIndex" | "remove" | "clear";
  pendingEdits?: PendingEdit[];
  currentEditIndex?: number;
  editId?: string;
}

export async function PUT(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    const body: UpdateBody = await request.json();
    const { projectId, action, pendingEdits, currentEditIndex, editId } = body;

    if (!projectId || !action) {
      if (!projectId) {
        return apiError(PENDING_EDITS_ERRORS.PROJECT_ID_REQUIRED, 400);
      }
      return apiError(PENDING_EDITS_ERRORS.ACTION_REQUIRED, 400);
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

    switch (action) {
      case "save":
        if (!pendingEdits) {
          return apiError(PENDING_EDITS_ERRORS.PENDING_EDITS_REQUIRED, 400);
        }
        await savePendingEdits(
          projectId,
          session.user.id,
          pendingEdits,
          currentEditIndex ?? 0
        );
        // Regenerate all shadow documents after save
        await regenerateAllShadowDocuments(projectId, session.user.id);
        return NextResponse.json({ success: true, action: "saved" });

      case "updateIndex":
        if (currentEditIndex === undefined) {
          return apiError(PENDING_EDITS_ERRORS.CURRENT_EDIT_INDEX_REQUIRED, 400);
        }
        await updateCurrentEditIndex(projectId, session.user.id, currentEditIndex);
        return NextResponse.json({ success: true, action: "indexUpdated" });

      case "remove":
        if (!editId) {
          return apiError(PENDING_EDITS_ERRORS.EDIT_ID_REQUIRED, 400);
        }
        const removed = await removePendingEdit(projectId, session.user.id, editId);
        // Regenerate all shadow documents after remove
        await regenerateAllShadowDocuments(projectId, session.user.id);
        return NextResponse.json({ success: removed, action: "removed" });

      case "clear":
        await clearPendingEdits(projectId, session.user.id);
        // Clear all shadow documents
        await clearUserShadowDocuments(projectId, session.user.id);
        return NextResponse.json({ success: true, action: "cleared" });

      default:
        return apiError(PENDING_EDITS_ERRORS.UNKNOWN_ACTION, 400, { action });
    }
  } catch (error) {
    console.error("[Pending Edits API PUT Error]", error);
    return apiError(PENDING_EDITS_ERRORS.UPDATE_FAILED, 500);
  }
}

// ============================================================================
// DELETE /api/pending-edits?projectId=xxx&editId=xxx
// Remove a specific pending edit
// If editId is not provided, clears all pending edits
// ============================================================================

export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    const editId = searchParams.get("editId");

    if (!projectId) {
      return apiError(PENDING_EDITS_ERRORS.PROJECT_ID_REQUIRED, 400);
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

    if (editId) {
      // Remove specific edit
      const removed = await removePendingEdit(projectId, session.user.id, editId);
      // Regenerate all shadow documents
      await regenerateAllShadowDocuments(projectId, session.user.id);
      return NextResponse.json({ success: removed });
    } else {
      // Clear all edits
      await clearPendingEdits(projectId, session.user.id);
      // Clear all shadow documents
      await clearUserShadowDocuments(projectId, session.user.id);
      return NextResponse.json({ success: true });
    }
  } catch (error) {
    console.error("[Pending Edits API DELETE Error]", error);
    return apiError(PENDING_EDITS_ERRORS.DELETE_FAILED, 500);
  }
}
