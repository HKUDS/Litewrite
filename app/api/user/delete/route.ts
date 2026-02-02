import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStorage, StoragePaths } from "@/lib/storage";
import { merkleService } from "@/lib/storage/merkle";
import { AUTH_ERRORS, USER_ERRORS, apiError, apiSuccess } from "@/lib/api-errors";

/**
 * DELETE /api/user/delete - Delete the user account and all associated data.
 */
export async function DELETE() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    const userId = session.user.id;
    const storage = await getStorage();

    // Fetch all projects owned by the user
    const projects = await prisma.project.findMany({
      where: { ownerId: userId },
      select: { id: true },
    });

    // Handle Blob reference counts for Merkle Tree versions
    for (const project of projects) {
      try {
        // Fetch all Merkle Tree versions of the project
        const merkleVersions = await prisma.projectVersion.findMany({
          where: {
            projectId: project.id,
            rootTreeHash: { not: null },
          },
          select: { rootTreeHash: true },
        });

        // Decrement blob ref counts for each version
        for (const version of merkleVersions) {
          if (version.rootTreeHash) {
            try {
              const files = await merkleService.getTreeFiles(version.rootTreeHash);
              for (const file of files) {
                await merkleService.decrementBlobRef(file.hash);
              }
            } catch {
              // Ignore errors; garbage collection will eventually clean up
            }
          }
        }
      } catch {
        // Ignore errors
      }
    }

    // Delete project files and related storage
    for (const project of projects) {
      try {
        // Delete project files
        await storage.deletePrefix(StoragePaths.projectPrefix(project.id));
        // Delete compiled artifacts
        await storage.deletePrefix(StoragePaths.compiledPrefix(project.id));
        // Delete version snapshots (legacy format)
        await storage.deletePrefix(StoragePaths.versionsPrefix(project.id));
      } catch (error) {
        console.warn(`Failed to delete project storage: ${project.id}`, error);
      }
    }

    // Delete avatar files
    const extensions = ["jpg", "png", "gif", "webp"];
    for (const ext of extensions) {
      try {
        const key = StoragePaths.avatar(userId, ext);
        if (await storage.exists(key)) {
          await storage.delete(key);
      }
    } catch {
      // Ignore avatar deletion errors
      }
    }

    // Manually delete projects and related records (SQLite may not enforce FK constraints by default)
    const projectIds = projects.map(p => p.id);

    // Delete version snapshots first
    await prisma.fileSnapshot.deleteMany({
      where: { version: { projectId: { in: projectIds } } },
    });
    // Delete project versions
    await prisma.projectVersion.deleteMany({
      where: { projectId: { in: projectIds } },
    });
    // Delete project-tag relations
    await prisma.projectTag.deleteMany({
      where: { projectId: { in: projectIds } },
    });
    // Delete project collaborators
    await prisma.projectCollaborator.deleteMany({
      where: { projectId: { in: projectIds } },
    });
    // Delete chat messages
    await prisma.chatMessage.deleteMany({
      where: { projectId: { in: projectIds } },
    });
    // Delete projects
    await prisma.project.deleteMany({
      where: { ownerId: userId },
    });

    // Remove collaboration records where user is a collaborator (does not delete the projects)
    await prisma.projectCollaborator.deleteMany({ where: { userId } });

    // Delete other user-related records
    await prisma.templateFavorite.deleteMany({ where: { userId } });
    await prisma.tag.deleteMany({ where: { userId } });
    await prisma.userSettings.deleteMany({ where: { userId } });
    await prisma.account.deleteMany({ where: { userId } });
    await prisma.session.deleteMany({ where: { userId } });

    // Finally, delete the user
    await prisma.user.delete({
      where: { id: userId },
    });

    return apiSuccess({ success: true });
  } catch (error) {
    console.error("Error deleting user:", error);
    return apiError(USER_ERRORS.DELETE_ACCOUNT_FAILED, 500);
  }
}
