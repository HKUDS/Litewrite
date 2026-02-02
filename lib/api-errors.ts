/**
 * API error code constants.
 *
 * Usage:
 * 1. API routes return { error: { code: "auth.emailRequired" } }
 * 2. Frontend calls getApiErrorMessage(error.code, t) to get the translated message
 *
 * Error code format: {category}.{errorName}
 * Corresponding i18n key: apiErrors.{category}.{errorName}
 */

// ============ Auth-related errors ============
export const AUTH_ERRORS = {
  EMAIL_REQUIRED: "auth.emailRequired",
  EMAIL_AND_PASSWORD_REQUIRED: "auth.emailAndPasswordRequired",
  INVALID_EMAIL: "auth.invalidEmail",
  PASSWORD_TOO_SHORT: "auth.passwordTooShort",
  EMAIL_ALREADY_REGISTERED: "auth.emailAlreadyRegistered",
  REGISTER_FAILED: "auth.registerFailed",
  USER_NOT_FOUND: "auth.userNotFound",
  CHECK_FAILED: "auth.checkFailed",
  ACCOUNT_DISABLED: "auth.accountDisabled",
  UNAUTHORIZED: "auth.unauthorized",
  SESSION_EXPIRED: "auth.sessionExpired",
} as const;

// ============ Project-related errors ============
export const PROJECT_ERRORS = {
  NOT_FOUND: "project.notFound",
  NO_ACCESS: "project.noAccess",
  NAME_REQUIRED: "project.nameRequired",
  INVALID_COMPILER: "project.invalidCompiler",
  CREATE_FAILED: "project.createFailed",
  UPDATE_FAILED: "project.updateFailed",
  DELETE_FAILED: "project.deleteFailed",
  COPY_FAILED: "project.copyFailed",
  COPY_FILES_FAILED: "project.copyFilesFailed",
  NO_COPY_PERMISSION: "project.noCopyPermission",
  OWNER_ONLY: "project.ownerOnly",
  OWNER_ONLY_DELETE: "project.ownerOnlyDelete",
  OWNER_ONLY_ARCHIVE: "project.ownerOnlyArchive",
  OWNER_ONLY_RESTORE: "project.ownerOnlyRestore",
  OWNER_ONLY_PERMANENT_DELETE: "project.ownerOnlyPermanentDelete",
  OWNER_ONLY_TAGS: "project.ownerOnlyTags",
  RESTORE_FIRST: "project.restoreFirst",
  NOT_IN_TRASH: "project.notInTrash",
  ALREADY_IN_TRASH: "project.alreadyInTrash",
  ONLY_TRASH_CAN_DELETE: "project.onlyTrashCanDelete",
  LIST_FAILED: "project.listFailed",
  INFO_FAILED: "project.infoFailed",
  FILES_FAILED: "project.filesFailed",
  FILES_NOT_EXIST: "project.filesNotExist",
} as const;

// ============ File-related errors ============
export const FILE_ERRORS = {
  NOT_FOUND: "file.notFound",
  PATH_REQUIRED: "file.pathRequired",
  SOURCE_PATH_REQUIRED: "file.sourcePathRequired",
  INVALID_PATH: "file.invalidPath",
  GET_FAILED: "file.getFailed",
  SAVE_FAILED: "file.saveFailed",
  CREATE_FAILED: "file.createFailed",
  DELETE_FAILED: "file.deleteFailed",
  MOVE_FAILED: "file.moveFailed",
  UPDATE_FAILED: "file.updateFailed",
  UPLOAD_FAILED: "file.uploadFailed",
  SAME_NAME_EXISTS: "file.sameNameExists",
  UNSUPPORTED_TYPE: "file.unsupportedType",
  SIZE_TOO_LARGE: "file.sizeTooLarge",
  SELECT_FILE: "file.selectFile",
  SELECT_FILES_TO_UPLOAD: "file.selectFilesToUpload",
} as const;

// ============ Collaborator-related errors ============
export const COLLABORATOR_ERRORS = {
  LIST_FAILED: "collaborator.listFailed",
  ADD_FAILED: "collaborator.addFailed",
  REMOVE_FAILED: "collaborator.removeFailed",
  EMAIL_REQUIRED: "collaborator.emailRequired",
  USER_ID_REQUIRED: "collaborator.userIdRequired",
  INVALID_ROLE: "collaborator.invalidRole",
  USER_NOT_REGISTERED: "collaborator.userNotRegistered",
  CANNOT_ADD_SELF: "collaborator.cannotAddSelf",
  OWNER_ONLY_ADD: "collaborator.ownerOnlyAdd",
  OWNER_ONLY_REMOVE: "collaborator.ownerOnlyRemove",
} as const;

// ============ Share-related errors ============
export const SHARE_ERRORS = {
  INVALID_OR_EXPIRED: "share.invalidOrExpired",
  NOT_SUPPORTED: "share.notSupported",
  OWNER_ONLY_VIEW: "share.ownerOnlyView",
  OWNER_ONLY_GENERATE: "share.ownerOnlyGenerate",
  OWNER_ONLY_CANCEL: "share.ownerOnlyCancel",
  GENERATE_FAILED: "share.generateFailed",
  CANCEL_FAILED: "share.cancelFailed",
  GET_FAILED: "share.getFailed",
  JOIN_FAILED: "share.joinFailed",
} as const;

// ============ Version-related errors ============
export const VERSION_ERRORS = {
  NOT_FOUND: "version.notFound",
  NAME_REQUIRED: "version.nameRequired",
  LIST_FAILED: "version.listFailed",
  DETAIL_FAILED: "version.detailFailed",
  CREATE_FAILED: "version.createFailed",
  DELETE_FAILED: "version.deleteFailed",
  RESTORE_FAILED: "version.restoreFailed",
  COMPARE_FAILED: "version.compareFailed",
  OWNER_ONLY_DELETE: "version.ownerOnlyDelete",
  NO_CHANGES: "version.noChanges",
  NO_FILES: "version.noFiles",
  SNAPSHOT_EMPTY: "version.snapshotEmpty",
  CANNOT_READ_SNAPSHOT: "version.cannotReadSnapshot",
  CANNOT_READ_FILE: "version.cannotReadFile",
  SPECIFY_TWO_VERSIONS: "version.specifyTwoVersions",
} as const;

// ============ Tag-related errors ============
export const TAG_ERRORS = {
  NOT_FOUND: "tag.notFound",
  ID_REQUIRED: "tag.idRequired",
  NAME_REQUIRED: "tag.nameRequired",
  NAME_EXISTS: "tag.nameExists",
  ALREADY_ADDED: "tag.alreadyAdded",
  LIST_FAILED: "tag.listFailed",
  PROJECT_TAGS_FAILED: "tag.projectTagsFailed",
  CREATE_FAILED: "tag.createFailed",
  UPDATE_FAILED: "tag.updateFailed",
  DELETE_FAILED: "tag.deleteFailed",
  ADD_FAILED: "tag.addFailed",
  REMOVE_FAILED: "tag.removeFailed",
  NO_EDIT_PERMISSION: "tag.noEditPermission",
  NO_DELETE_PERMISSION: "tag.noDeletePermission",
} as const;

// ============ Template-related errors ============
export const TEMPLATE_ERRORS = {
  NOT_FOUND: "template.notFound",
  FILE_NOT_FOUND: "template.fileNotFound",
  DIR_NOT_FOUND: "template.dirNotFound",
  PREVIEW_NOT_FOUND: "template.previewNotFound",
  PREVIEW_FAILED: "template.previewFailed",
  LIST_FAILED: "template.listFailed",
  DETAIL_FAILED: "template.detailFailed",
  CREATE_FAILED: "template.createFailed",
  UPDATE_FAILED: "template.updateFailed",
  DELETE_FAILED: "template.deleteFailed",
  FROM_PROJECT_FAILED: "template.fromProjectFailed",
  INIT_FAILED: "template.initFailed",
  INVALID_CATEGORY: "template.invalidCategory",
  INVALID_COMPILER: "template.invalidCompiler",
  MISSING_NAME_OR_CATEGORY: "template.missingNameOrCategory",
  NO_USE_PERMISSION: "template.noUsePermission",
  NO_ACCESS_PERMISSION: "template.noAccessPermission",
  NO_EDIT_PERMISSION: "template.noEditPermission",
  NO_DELETE_PERMISSION: "template.noDeletePermission",
  ALREADY_FAVORITED: "template.alreadyFavorited",
  NOT_FAVORITED: "template.notFavorited",
  FAVORITE_FAILED: "template.favoriteFailed",
  UNFAVORITE_FAILED: "template.unfavoriteFailed",
  CHECK_FAVORITE_FAILED: "template.checkFavoriteFailed",
} as const;

// ============ Compile-related errors ============
export const COMPILE_ERRORS = {
  NO_FILES: "compile.noFiles",
  COMPILE_FAILED: "compile.compileFailed",
  FILE_NOT_FOUND: "compile.fileNotFound",
  SYNCTEX_NOT_FOUND: "compile.synctexNotFound",
  SYNCTEX_FAILED: "compile.synctexFailed",
  SYNCTEX_NO_PDF_POSITION: "compile.synctexNoPdfPosition",
  SYNCTEX_NO_SOURCE_POSITION: "compile.synctexNoSourcePosition",
  FORWARD_SYNC_PARAMS: "compile.forwardSyncParams",
  REVERSE_SYNC_PARAMS: "compile.reverseSyncParams",
  SERVER_NOT_RUNNING: "compile.serverNotRunning",
} as const;

// ============ Import-related errors ============
export const IMPORT_ERRORS = {
  FAILED: "import.failed",
  ARXIV_FAILED: "import.arxivFailed",
  UPLOAD_FAILED: "import.uploadFailed",
  INVALID_GITHUB_URL: "import.invalidGithubUrl",
  INVALID_ARXIV_ID: "import.invalidArxivId",
  REPO_NOT_FOUND: "import.repoNotFound",
  REPO_EMPTY: "import.repoEmpty",
  NO_SOURCE_CODE: "import.noSourceCode",
  EMPTY_SOURCE_FILES: "import.emptySourceFiles",
  NO_FILES_FOUND: "import.noFilesFound",
  NO_FILES_IN_PATH: "import.noFilesInPath",
  MAIN_FILE_NOT_EXIST: "import.mainFileNotExist",
  ZIP_EMPTY: "import.zipEmpty",
  UNSUPPORTED_FORMAT: "import.unsupportedFormat",
  ENTER_ARXIV_ID: "import.enterArxivId",
  ENTER_REPO_URL: "import.enterRepoUrl",
} as const;

// ============ User-related errors ============
export const USER_ERRORS = {
  NOT_FOUND: "user.notFound",
  INVALID_ID: "user.invalidId",
  PROFILE_FAILED: "user.profileFailed",
  UPDATE_PROFILE_FAILED: "user.updateProfileFailed",
  LIST_FAILED: "user.listFailed",
  UPDATE_FAILED: "user.updateFailed",
  DELETE_FAILED: "user.deleteFailed",
  DELETE_ACCOUNT_FAILED: "user.deleteAccountFailed",
  CANNOT_DELETE_SELF: "user.cannotDeleteSelf",
  CANNOT_MODIFY_SELF_ROLE: "user.cannotModifySelfRole",
} as const;

// ============ Password-related errors ============
export const PASSWORD_ERRORS = {
  CHANGE_FAILED: "password.changeFailed",
  CURRENT_PASSWORD_WRONG: "password.currentPasswordWrong",
  NEW_PASSWORD_TOO_SHORT: "password.newPasswordTooShort",
  FILL_BOTH_PASSWORDS: "password.fillBothPasswords",
  RESET_TOKEN_INVALID: "password.resetTokenInvalid",
  RESET_TOKEN_EXPIRED: "password.resetTokenExpired",
  RESET_SEND_FAILED: "password.resetSendFailed",
  RESET_TOO_MANY_REQUESTS: "password.resetTooManyRequests",
  PASSWORD_REQUIRED: "password.passwordRequired",
} as const;

// ============ Avatar-related errors ============
export const AVATAR_ERRORS = {
  NOT_FOUND: "avatar.notFound",
  GET_FAILED: "avatar.getFailed",
  UPLOAD_FAILED: "avatar.uploadFailed",
  SELECT_FILE: "avatar.selectFile",
  UNSUPPORTED_FORMAT: "avatar.unsupportedFormat",
} as const;

// ============ Settings-related errors ============
export const SETTINGS_ERRORS = {
  GET_FAILED: "settings.getFailed",
  UPDATE_FAILED: "settings.updateFailed",
  NO_VALID_ITEMS: "settings.noValidItems",
} as const;

// ============ Linked Accounts errors ============
export const LINKED_ACCOUNTS_ERRORS = {
  GET_FAILED: "linkedAccounts.getFailed",
  UNLINK_FAILED: "linkedAccounts.unlinkFailed",
  SPECIFY_ACCOUNT: "linkedAccounts.specifyAccount",
  ONLY_LOGIN_METHOD: "linkedAccounts.onlyLoginMethod",
} as const;

// ============ Export-related errors ============
export const EXPORT_ERRORS = {
  FAILED: "export.failed",
  DATA_FAILED: "export.dataFailed",
  DOWNLOAD_FAILED: "export.downloadFailed",
  PREVIEW_FAILED: "export.previewFailed",
  UNSUPPORTED_FORMAT: "export.unsupportedFormat",
} as const;

// ============ Chat-related errors ============
export const CHAT_ERRORS = {
  CONTENT_REQUIRED: "chat.contentRequired",
  CONTENT_TOO_LONG: "chat.contentTooLong",
  PROJECT_ID_REQUIRED: "chat.projectIdRequired",
  PROJECT_AND_SESSION_ID_REQUIRED: "chat.projectAndSessionIdRequired",
  APPLY_EDIT_PARAMS_REQUIRED: "chat.applyEditParamsRequired",
  SESSION_NOT_FOUND: "chat.sessionNotFound",
  INVALID_LINE_RANGE: "chat.invalidLineRange",
  HISTORY_UPDATE_PARAMS_REQUIRED: "chat.historyUpdateParamsRequired",
  GET_FAILED: "chat.getFailed",
  SEND_FAILED: "chat.sendFailed",
  DELETE_FAILED: "chat.deleteFailed",
  APPLY_EDIT_FAILED: "chat.applyEditFailed",
  HISTORY_UPDATE_FAILED: "chat.historyUpdateFailed",
  HISTORY_GET_FAILED: "chat.historyGetFailed",
} as const;

// ============ Pending-edits related errors ============
export const PENDING_EDITS_ERRORS = {
  PROJECT_ID_REQUIRED: "pendingEdits.projectIdRequired",
  FILE_PATH_REQUIRED: "pendingEdits.filePathRequired",
  BLOCKS_REQUIRED: "pendingEdits.blocksRequired",
  ACTION_REQUIRED: "pendingEdits.actionRequired",
  PENDING_EDITS_REQUIRED: "pendingEdits.pendingEditsRequired",
  CURRENT_EDIT_INDEX_REQUIRED: "pendingEdits.currentEditIndexRequired",
  EDIT_ID_REQUIRED: "pendingEdits.editIdRequired",
  UNKNOWN_ACTION: "pendingEdits.unknownAction",
  GET_FAILED: "pendingEdits.getFailed",
  ADD_FAILED: "pendingEdits.addFailed",
  UPDATE_FAILED: "pendingEdits.updateFailed",
  DELETE_FAILED: "pendingEdits.deleteFailed",
} as const;

// ============ Deep Research related errors ============
export const DEEP_RESEARCH_ERRORS = {
  PROJECT_ID_REQUIRED: "deepResearch.projectIdRequired",
  QUERY_REQUIRED: "deepResearch.queryRequired",
  REPORT_NOT_FOUND: "deepResearch.reportNotFound",
  LIST_FAILED: "deepResearch.listFailed",
  GET_FAILED: "deepResearch.getFailed",
  SAVE_FAILED: "deepResearch.saveFailed",
  DELETE_FAILED: "deepResearch.deleteFailed",
  AI_SERVER_ERROR: "deepResearch.aiServerError",
  STREAM_FAILED: "deepResearch.streamFailed",
} as const;

// ============ TAP completion related errors ============
export const TAP_ERRORS = {
  PROJECT_ID_REQUIRED: "tap.projectIdRequired",
  FILE_ID_REQUIRED: "tap.fileIdRequired",
  CONTENT_REQUIRED: "tap.contentRequired",
  SERVER_ERROR: "tap.serverError",
  TIMEOUT: "tap.timeout",
  SERVER_NOT_AVAILABLE: "tap.serverNotAvailable",
  REQUEST_FAILED: "tap.requestFailed",
} as const;

// ============ PDF-related errors ============
export const PDF_ERRORS = {
  NOT_FOUND: "pdf.notFound",
  RETRIEVE_FAILED: "pdf.retrieveFailed",
  PREVIEW_FAILED: "pdf.previewFailed",
} as const;

// ============ General errors ============
export const GENERAL_ERRORS = {
  OPERATION_FAILED: "general.operationFailed",
  MISSING_PARAMS: "general.missingParams",
  NO_ACCESS: "general.noAccess",
  INVALID_VISIBILITY: "general.invalidVisibility",
  NO_VALID_UPDATE_ITEMS: "general.noValidUpdateItems",
} as const;

// ============ Unified error code object (backward compatible) ============
export const ApiErrorCodes = {
  // Auth
  AUTH_EMAIL_REQUIRED: AUTH_ERRORS.EMAIL_REQUIRED,
  AUTH_EMAIL_AND_PASSWORD_REQUIRED: AUTH_ERRORS.EMAIL_AND_PASSWORD_REQUIRED,
  AUTH_INVALID_EMAIL: AUTH_ERRORS.INVALID_EMAIL,
  AUTH_PASSWORD_TOO_SHORT: AUTH_ERRORS.PASSWORD_TOO_SHORT,
  AUTH_EMAIL_ALREADY_REGISTERED: AUTH_ERRORS.EMAIL_ALREADY_REGISTERED,
  AUTH_REGISTER_FAILED: AUTH_ERRORS.REGISTER_FAILED,
  AUTH_USER_NOT_FOUND: AUTH_ERRORS.USER_NOT_FOUND,
  AUTH_CHECK_FAILED: AUTH_ERRORS.CHECK_FAILED,
  AUTH_ACCOUNT_DISABLED: AUTH_ERRORS.ACCOUNT_DISABLED,
  AUTH_UNAUTHORIZED: AUTH_ERRORS.UNAUTHORIZED,
  AUTH_SESSION_EXPIRED: AUTH_ERRORS.SESSION_EXPIRED,
  // Project
  PROJECT_NOT_FOUND: PROJECT_ERRORS.NOT_FOUND,
  PROJECT_NO_ACCESS: PROJECT_ERRORS.NO_ACCESS,
  PROJECT_NAME_REQUIRED: PROJECT_ERRORS.NAME_REQUIRED,
  PROJECT_CREATE_FAILED: PROJECT_ERRORS.CREATE_FAILED,
  PROJECT_UPDATE_FAILED: PROJECT_ERRORS.UPDATE_FAILED,
  PROJECT_DELETE_FAILED: PROJECT_ERRORS.DELETE_FAILED,
  PROJECT_OWNER_ONLY: PROJECT_ERRORS.OWNER_ONLY,
  PROJECT_LIST_FAILED: PROJECT_ERRORS.LIST_FAILED,
  // File
  FILE_NOT_FOUND: FILE_ERRORS.NOT_FOUND,
  FILE_UPLOAD_FAILED: FILE_ERRORS.UPLOAD_FAILED,
  // General
  GENERAL_OPERATION_FAILED: GENERAL_ERRORS.OPERATION_FAILED,
  GENERAL_MISSING_PARAMS: GENERAL_ERRORS.MISSING_PARAMS,
  GENERAL_NO_ACCESS: GENERAL_ERRORS.NO_ACCESS,
} as const;

// ============ API response helpers ============
import { NextResponse } from "next/server";

/**
 * Error code param: supports string or object format.
 */
type ErrorCodeParam = string | { code: string; message?: string };

/**
 * Create a standardized API error response.
 * @param codeOrError Error code (string) or an object containing code + message
 * @param status HTTP status code
 * @param details Optional extra error details
 *
 * @example
 * // String form
 * apiError(AUTH_ERRORS.EMAIL_REQUIRED, 400)
 *
 * // Object form (for custom errors)
 * apiError({ code: "custom.error", message: "Detailed error info" }, 400)
 */
export function apiError(
  codeOrError: ErrorCodeParam,
  status: number = 400,
  details?: Record<string, unknown>
) {
  const errorObj = typeof codeOrError === "string"
    ? { code: codeOrError }
    : { code: codeOrError.code, ...(codeOrError.message && { message: codeOrError.message }) };

  return NextResponse.json(
    {
      error: {
        ...errorObj,
        ...details,
      },
    },
    { status }
  );
}

/**
 * Create a standardized API success response.
 */
export function apiSuccess<T>(data: T, status: number = 200) {
  return NextResponse.json(data, { status });
}
