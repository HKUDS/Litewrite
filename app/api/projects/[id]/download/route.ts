import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import AdmZip from "adm-zip";
import { getStorage, StoragePaths } from "@/lib/storage";
import { apiError, AUTH_ERRORS, EXPORT_ERRORS, PROJECT_ERRORS } from "@/lib/api-errors";

/**
 * GET /api/projects/[id]/download - Download a project as a zip file
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    const { id: projectId } = await params;

    // Check whether the project exists and the user has access
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        OR: [
          { ownerId: session.user.id },
          { collaborators: { some: { userId: session.user.id } } },
        ],
      },
      select: { id: true, name: true },
    });

    if (!project) {
      return apiError(PROJECT_ERRORS.NO_ACCESS, 404);
    }

    const storage = await getStorage();
    const projectPrefix = StoragePaths.projectPrefix(projectId);

    // List project files
    const files = await storage.list(projectPrefix);

    if (files.length === 0) {
      return apiError(PROJECT_ERRORS.FILES_NOT_EXIST, 404);
    }

    // Create zip archive
    const zip = new AdmZip();

    // Add all files to the zip
    for (const fileInfo of files) {
      // Skip the .compiled directory
      if (fileInfo.key.includes("/.compiled/")) continue;

      const content = await storage.download(fileInfo.key);
      const relativePath = fileInfo.key.replace(projectPrefix, "");
      zip.addFile(`${project.name}/${relativePath}`, content);
    }

    // Build zip buffer
    const zipBuffer = zip.toBuffer();

    // Return zip file
    return new NextResponse(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(project.name)}.zip"`,
        "Content-Length": zipBuffer.length.toString(),
      },
    });
  } catch (error) {
    console.error("Error downloading project:", error);
    return apiError(EXPORT_ERRORS.DOWNLOAD_FAILED, 500);
  }
}
