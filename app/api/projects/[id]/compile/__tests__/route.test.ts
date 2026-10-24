import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStorage, StoragePaths } from "@/lib/storage";
import { POST } from "../route";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findFirst: vi.fn() },
    userSettings: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/storage", () => ({
  getStorage: vi.fn(),
  StoragePaths: { projectPrefix: vi.fn() },
  getMimeType: vi.fn(),
}));

const mockStorage = {
  list: vi.fn(),
  download: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1" } } as never);
  vi.mocked(prisma.project.findFirst).mockResolvedValue({
    id: "project-1",
    ownerId: "user-1",
    mainFile: "main.tex",
    compiler: "pdflatex",
  } as never);
  vi.mocked(getStorage).mockResolvedValue(mockStorage as never);
  vi.mocked(StoragePaths.projectPrefix).mockReturnValue("projects/project-1/");
  mockStorage.list.mockResolvedValue([{ key: "projects/project-1/main.tex" }]);
  mockStorage.download.mockResolvedValue(Buffer.from("\\documentclass{article}"));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("project compile error status", () => {
  it.each([408, 429, 504])("preserves queue/timeout HTTP status %i", async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ success: false, errorCode: "QUEUE_ERROR", error: "Temporarily unavailable" }),
          { status, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const response = await POST(
      new NextRequest("http://localhost/api/projects/project-1/compile", { method: "POST" }),
      { params: Promise.resolve({ id: "project-1" }) },
    );

    expect(response.status).toBe(status);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.errors[0].message).toBe("Temporarily unavailable");
  });
});
