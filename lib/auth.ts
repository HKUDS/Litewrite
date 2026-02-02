import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { normalizeEmail } from "./email";
// Note: Do not import rate-limit here, because it depends on Redis and `lib/auth.ts` is used by middleware.
// Middleware runs in the Edge Runtime, and Redis is not compatible with the Edge Runtime.
// Rate-limit attempt recording is implemented via API routes instead.

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  trustHost: true, // Trust the host header forwarded by reverse proxy
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [
    // Email + password login
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("CREDENTIALS_REQUIRED");
        }

        // Normalize email: lowercase and trim whitespace
        const email = normalizeEmail(credentials.email as string);

        const user = await prisma.user.findUnique({
          where: { email },
        });

        if (!user || !user.password) {
          // Rate-limit attempt recording is handled by the frontend via /api/auth/record-attempt
          throw new Error("INVALID_CREDENTIALS");
        }

        const isValid = await bcrypt.compare(
          credentials.password as string,
          user.password
        );

        if (!isValid) {
          // Rate-limit attempt recording is handled by the frontend via /api/auth/record-attempt
          throw new Error("INVALID_CREDENTIALS");
        }

        // Check user status
        if (user.status === "disabled") {
          throw new Error("ACCOUNT_DISABLED");
        }

        // Rate-limit attempt recording is handled by the frontend via /api/auth/record-attempt

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session: updateData }) {
      if (user) {
        token.id = user.id;
        token.picture = user.image;
        token.name = user.name;
      }
      // Fetch latest data from DB on refresh
      if (trigger === "update" && token.id) {
        // If updated data is provided, use it directly (faster)
        if (updateData?.name !== undefined) {
          token.name = updateData.name;
        }
        if (updateData?.image !== undefined) {
          token.picture = updateData.image;
        }
        // Also fetch other potentially changing fields from DB
        const dbUser = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { status: true, image: true, name: true },
        });
        if (dbUser) {
          // If no updated data is provided, use DB values
          if (updateData?.image === undefined) {
            token.picture = dbUser.image;
          }
          if (updateData?.name === undefined) {
            token.name = dbUser.name;
          }
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id as string;
        session.user.image = token.picture as string | null | undefined;
        session.user.name = token.name as string | null | undefined;
      }
      return session;
    },
  },
});

// Helper: get current user (for API routes)
export async function getCurrentUser() {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
  });

  return user;
}

// Helper: check whether user has access to a project
export async function checkProjectAccess(projectId: string, userId: string | null) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      collaborators: true,
    },
  });

  if (!project) {
    return { hasAccess: false, role: null, project: null };
  }

  // Public projects are accessible to everyone
  if (project.visibility === "public") {
    const role = project.ownerId === userId
      ? "owner"
      : project.collaborators.find(c => c.userId === userId)?.role ?? "viewer";
    return { hasAccess: true, role, project };
  }

  // Unauthenticated users cannot access private projects
  if (!userId) {
    return { hasAccess: false, role: null, project: null };
  }

  // Owner
  if (project.ownerId === userId) {
    return { hasAccess: true, role: "owner", project };
  }

  // Collaborator
  const collaborator = project.collaborators.find(c => c.userId === userId);
  if (collaborator) {
    return { hasAccess: true, role: collaborator.role, project };
  }

  return { hasAccess: false, role: null, project: null };
}
