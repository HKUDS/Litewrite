import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import AdmZip from "adm-zip";
import { getStorage, StoragePaths } from "@/lib/storage";
import { AUTH_ERRORS, USER_ERRORS, EXPORT_ERRORS, apiError } from "@/lib/api-errors";

/**
 * POST /api/user/export - Export all user data.
 */
export async function POST() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    // Fetch user info
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        createdAt: true,
      },
    });

    if (!user) {
      return apiError(USER_ERRORS.NOT_FOUND, 404);
    }

    // Fetch all projects owned by the user
    const projects = await prisma.project.findMany({
      where: { ownerId: session.user.id },
      select: {
        id: true,
        name: true,
        description: true,
        mainFile: true,
        visibility: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Fetch user settings
    const settings = await prisma.userSettings.findUnique({
      where: { userId: session.user.id },
    });

    // Fetch tags
    const tags = await prisma.tag.findMany({
      where: { userId: session.user.id },
      select: {
        id: true,
        name: true,
        color: true,
      },
    });

    // Create ZIP archive
    const zip = new AdmZip();

    // Add user data JSON
    const userData = {
      user,
      settings,
      tags,
      projects: projects.map((p) => ({
        ...p,
        files: `See projects/${p.id}/ folder`,
      })),
      exportedAt: new Date().toISOString(),
    };

    zip.addFile(
      "user-data.json",
      Buffer.from(JSON.stringify(userData, null, 2))
    );

    // Add project files
    const storage = await getStorage();

    for (const project of projects) {
      try {
        const projectPrefix = StoragePaths.projectPrefix(project.id);
        const files = await storage.list(projectPrefix);

        for (const fileInfo of files) {
          // Skip .compiled directory
          if (fileInfo.key.includes("/.compiled/")) continue;

          const content = await storage.download(fileInfo.key);
          // Extract relative path from storage key
          const relativePath = fileInfo.key.replace(projectPrefix, "");
          zip.addFile(`projects/${project.id}/${relativePath}`, content);
        }
      } catch {
        // Project directory not found; skip
        console.log(`Project directory not found: ${project.id}`);
      }
    }

    // Generate ZIP buffer
    const zipBuffer = zip.toBuffer();

    // Return ZIP file
    return new NextResponse(new Uint8Array(zipBuffer), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="litewrite-export-${new Date().toISOString().split("T")[0]}.zip"`,
      },
    });
  } catch (error) {
    console.error("Error exporting user data:", error);
    return apiError(EXPORT_ERRORS.DATA_FAILED, 500);
  }
}
