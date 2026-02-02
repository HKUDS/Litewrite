import { NextRequest, NextResponse } from "next/server";
import { auth, checkProjectAccess } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { apiError, AUTH_ERRORS, CHAT_ERRORS, PROJECT_ERRORS } from "@/lib/api-errors";

/**
 * GET /api/projects/[id]/chat - Get project chat history
 * Query: ?cursor=xxx&limit=50
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;
    const session = await auth();

    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    const { hasAccess, project } = await checkProjectAccess(
      projectId,
      session.user.id
    );

    if (!hasAccess || !project) {
      return apiError(PROJECT_ERRORS.NO_ACCESS, 404);
    }

    const { searchParams } = new URL(request.url);
    const cursor = searchParams.get("cursor");
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);

    // Fetch chat messages (sorted by createdAt desc)
    const messages = await prisma.chatMessage.findMany({
      where: { projectId },
      include: {
        user: {
          select: { id: true, name: true, email: true, image: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1, // Fetch one extra to determine whether there are more
      ...(cursor && {
        cursor: { id: cursor },
        skip: 1,
      }),
    });

    const hasMore = messages.length > limit;
    const items = hasMore ? messages.slice(0, limit) : messages;

    return NextResponse.json({
      messages: items.map((m) => ({
        id: m.id,
        content: m.content,
        user: m.user,
        createdAt: m.createdAt.toISOString(),
      })),
      nextCursor: hasMore ? items[items.length - 1]?.id : null,
    });
  } catch (error) {
    console.error("Error getting chat messages:", error);
    return apiError(CHAT_ERRORS.GET_FAILED, 500);
  }
}

/**
 * POST /api/projects/[id]/chat - Send a chat message
 * Body: { content: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: projectId } = await params;
    const session = await auth();

    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    const { hasAccess, project } = await checkProjectAccess(
      projectId,
      session.user.id
    );

    if (!hasAccess || !project) {
      return apiError(PROJECT_ERRORS.NO_ACCESS, 404);
    }

    const body = await request.json();
    const { content } = body;

    if (!content || typeof content !== "string" || content.trim().length === 0) {
      return apiError(CHAT_ERRORS.CONTENT_REQUIRED, 400);
    }

    if (content.length > 2000) {
      return apiError(CHAT_ERRORS.CONTENT_TOO_LONG, 400);
    }

    // Create chat message
    const message = await prisma.chatMessage.create({
      data: {
        content: content.trim(),
        projectId,
        userId: session.user.id,
      },
      include: {
        user: {
          select: { id: true, name: true, email: true, image: true },
        },
      },
    });

    return NextResponse.json({
      message: {
        id: message.id,
        content: message.content,
        user: message.user,
        createdAt: message.createdAt.toISOString(),
      },
    });
  } catch (error) {
    console.error("Error sending chat message:", error);
    return apiError(CHAT_ERRORS.SEND_FAILED, 500);
  }
}
