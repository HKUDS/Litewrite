/**
 * File type.
 */
export interface ProjectFile {
  id: string;
  name: string;
  type: "file" | "folder";
  content?: string;
  children?: ProjectFile[];
  parentId?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Project metadata (stored in project.json).
 */
export interface ProjectMeta {
  id: string;
  name: string;
  description?: string;
  mainFile: string;
  compiler?: string; // "pdflatex" | "xelatex" | "lualatex" | "latex"
  createdAt: string;
  updatedAt: string;
  template?: string;
}

/**
 * Project type (includes files).
 */
export interface Project extends ProjectMeta {
  files: ProjectFile[];
}

/**
 * Project owner information.
 */
export interface ProjectOwner {
  name: string | null;
  email: string;
}

/**
 * Project list item (for the home page).
 */
export interface ProjectListItem {
  id: string;
  name: string;
  description?: string;
  updatedAt: string;
  createdAt: string;
  isOwner: boolean;              // Whether current user is the project owner
  owner?: ProjectOwner;          // Owner info
  collaboratorCount?: number;    // Collaborator count
}

/**
 * Compile status.
 */
export type CompileStatus = "idle" | "compiling" | "success" | "error";

/**
 * Compile result.
 */
export interface CompileLogItem {
  message: string;
  severity: "error" | "warning" | "info";
  file?: string;
  line?: number;
}

export interface CompileLogStats {
  errors: number;
  warnings: number;
  info: number;
}

export interface CompileResult {
  success: boolean;
  pdfUrl?: string;
  errors?: CompileError[];
  logs?: string;
  parsedLogs?: CompileLogItem[];
  logStats?: CompileLogStats;
}

/**
 * Compile error codes (for i18n).
 */
export type CompileErrorCode =
  | "MISSING_PARAMS"
  | "SERVER_NOT_RUNNING"
  | "SERVER_START_HINT"
  | "SERVER_CONNECTION_FAILED"
  | "SERVER_RESPONSE_ERROR"
  | "UNKNOWN_ERROR"
  | "MAIN_FILE_NOT_FOUND"
  | "COMPILE_REQUEST_FAILED"
  | "SECURITY_VIOLATION"
  | "SECURITY_DETAIL"
  | "COMPILE_TIMEOUT"
  | "QUEUE_FULL"
  | "QUEUE_TIMEOUT"
  | "QUEUE_ERROR"
  | "SERVER_ERROR"
  | "SERVER_BUSY"
  | "FILE_TOO_LARGE"
  | "COMPILE_SERVER_ERROR";

/**
 * Compile error.
 */
export interface CompileError {
  line?: number;
  column?: number;
  message: string;
  file?: string;
  severity: "error" | "warning";
  code?: CompileErrorCode; // Error code for frontend translation
}

/**
 * Collaborator information.
 */
export interface Collaborator {
  id: string;
  name: string;
  color: string;
  cursor?: {
    line: number;
    column: number;
  };
}

/**
 * Editor state.
 */
export interface EditorState {
  currentFile: string | null;
  content: string;
  isDirty: boolean;
}

/**
 * Sidebar state.
 */
export interface SidebarState {
  isOpen: boolean;
  width: number;
}

/**
 * User status.
 */
export type UserStatus = "active" | "disabled";
