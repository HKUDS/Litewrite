import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AUTH_ERRORS, SETTINGS_ERRORS, apiError, apiSuccess } from "@/lib/api-errors";

// Default settings
const defaultSettings = {
  autoComplete: true,
  autoCloseBrackets: true,
  codeCheck: false,
  keybindings: "none",
  spellcheck: false,
  spellcheckLang: "en",
  compiler: "pdflatex",
  autoSaveVersion: true, // Auto-save a version after successful compilation
  pdfViewer: "litewrite",
  theme: "system",
  fontSize: 14,
};

/**
 * GET /api/user/settings - Get user settings
 */
export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    // Fetch user settings; return defaults if none exist
    const settings = await prisma.userSettings.findUnique({
      where: { userId: session.user.id },
    });

    if (!settings) {
      return apiSuccess({
        settings: defaultSettings,
      });
    }

    return apiSuccess({
      settings: {
        autoComplete: settings.autoComplete,
        autoCloseBrackets: settings.autoCloseBrackets,
        codeCheck: settings.codeCheck,
        keybindings: settings.keybindings,
        spellcheck: settings.spellcheck,
        spellcheckLang: settings.spellcheckLang,
        compiler: settings.compiler,
        autoSaveVersion: settings.autoSaveVersion,
        pdfViewer: settings.pdfViewer,
        theme: settings.theme,
        fontSize: settings.fontSize,
      },
    });
  } catch (error) {
    console.error("Error getting user settings:", error);
    return apiError(SETTINGS_ERRORS.GET_FAILED, 500);
  }
}

/**
 * PUT /api/user/settings - Update user settings
 * Body: Partial<UserSettings>
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return apiError(AUTH_ERRORS.UNAUTHORIZED, 401);
    }

    const body = await request.json();

    // Validate setting values
    const validSettings: Record<string, unknown> = {};

    if (typeof body.autoComplete === "boolean") {
      validSettings.autoComplete = body.autoComplete;
    }

    if (typeof body.autoCloseBrackets === "boolean") {
      validSettings.autoCloseBrackets = body.autoCloseBrackets;
    }

    if (typeof body.codeCheck === "boolean") {
      validSettings.codeCheck = body.codeCheck;
    }

    if (body.keybindings && ["none", "vim", "emacs"].includes(body.keybindings)) {
      validSettings.keybindings = body.keybindings;
    }

    if (typeof body.spellcheck === "boolean") {
      validSettings.spellcheck = body.spellcheck;
    }

    if (body.spellcheckLang && typeof body.spellcheckLang === "string") {
      validSettings.spellcheckLang = body.spellcheckLang;
    }

    if (body.compiler && ["pdflatex", "xelatex", "lualatex", "latex"].includes(body.compiler)) {
      validSettings.compiler = body.compiler;
    }

    if (typeof body.autoSaveVersion === "boolean") {
      validSettings.autoSaveVersion = body.autoSaveVersion;
    }

    if (body.pdfViewer && ["browser", "litewrite"].includes(body.pdfViewer)) {
      validSettings.pdfViewer = body.pdfViewer;
    }

    if (body.theme && ["light", "dark", "system"].includes(body.theme)) {
      validSettings.theme = body.theme;
    }

    if (typeof body.fontSize === "number" && body.fontSize >= 10 && body.fontSize <= 24) {
      validSettings.fontSize = body.fontSize;
    }

    if (Object.keys(validSettings).length === 0) {
      return apiError(SETTINGS_ERRORS.NO_VALID_ITEMS, 400);
    }

    // Update or create user settings
    const settings = await prisma.userSettings.upsert({
      where: { userId: session.user.id },
      update: validSettings,
      create: {
        userId: session.user.id,
        ...defaultSettings,
        ...validSettings,
      },
    });

    return apiSuccess({
      settings: {
        autoComplete: settings.autoComplete,
        autoCloseBrackets: settings.autoCloseBrackets,
        codeCheck: settings.codeCheck,
        keybindings: settings.keybindings,
        spellcheck: settings.spellcheck,
        spellcheckLang: settings.spellcheckLang,
        compiler: settings.compiler,
        autoSaveVersion: settings.autoSaveVersion,
        pdfViewer: settings.pdfViewer,
        theme: settings.theme,
        fontSize: settings.fontSize,
      },
    });
  } catch (error) {
    console.error("Error updating user settings:", error);
    return apiError(SETTINGS_ERRORS.UPDATE_FAILED, 500);
  }
}
