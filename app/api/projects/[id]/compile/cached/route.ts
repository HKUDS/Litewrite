import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStorage, StoragePaths } from "@/lib/storage";
import { apiError, AUTH_ERRORS, PROJECT_ERRORS } from "@/lib/api-errors";

/**
 * GET /api/projects/[id]/compile/cached - Get cached compiled PDF
 *
 * If the project has a compiled PDF, return the PDF URL.
 * If not, return null.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
  }

  const { id: projectId } = await params;

  // Check project access permission
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      OR: [{ ownerId: session.user.id }, { collaborators: { some: { userId: session.user.id } } }],
    },
  });

  if (!project) {
    return apiError(PROJECT_ERRORS.NO_ACCESS, 404);
  }

  try {
    const storage = await getStorage();
    const prefix = StoragePaths.compiledPrefix(projectId);

    // List all files under the compiled directory
    const files = await storage.list(prefix);

    // Filter PDF files
    const pdfFiles = files.filter(f => f.key.endsWith(".pdf"));

    if (pdfFiles.length === 0) {
      return NextResponse.json({ cached: false });
    }

    // Get the latest PDF file (by last modified time)
    let latestPdf = pdfFiles[0];
    for (const file of pdfFiles) {
      if (file.lastModified > latestPdf.lastModified) {
        latestPdf = file;
      }
    }

    // Extract filename from key
    const filename = latestPdf.key.split("/").pop() || "";

    return NextResponse.json({
      cached: true,
      pdfUrl: `/api/projects/${projectId}/pdf/${filename}`,
      compiledAt: latestPdf.lastModified.toISOString(),
    });
  } catch (error) {
    console.error("[Compile Cache] Error:", error);
    // On error, return no cache
    return NextResponse.json({ cached: false });
  }
}
