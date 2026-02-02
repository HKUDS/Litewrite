import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Debounce function.
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return (...args: Parameters<T>) => {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
      func(...args);
    }, wait);
  };
}

/**
 * Collaborator color palette.
 */
const COLLABORATOR_COLORS = [
  "#f43f5e", // rose
  "#ec4899", // pink
  "#a855f7", // purple
  "#6366f1", // indigo
  "#3b82f6", // blue
  "#06b6d4", // cyan
  "#14b8a6", // teal
  "#22c55e", // green
  "#eab308", // yellow
  "#f97316", // orange
];

/**
 * Generate a random color (for collaborator cursors).
 */
export function generateUserColor(): string {
  return COLLABORATOR_COLORS[Math.floor(Math.random() * COLLABORATOR_COLORS.length)];
}

/**
 * Generate a stable color from user ID (ensures the same user always gets the same color).
 */
export function getUserColorById(userId: string): string {
  // Simple hash: convert user ID to a number
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    const char = userId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  // Use absolute value and modulo
  const index = Math.abs(hash) % COLLABORATOR_COLORS.length;
  return COLLABORATOR_COLORS[index];
}

/**
 * Generate a random user name.
 */
export function generateUserName(): string {
  const adjectives = ["Happy", "Clever", "Diligent", "Creative", "Enthusiastic"];
  const nouns = ["Researcher", "Writer", "Scholar", "Explorer", "Creator"];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adj}${noun}`;
}

/**
 * Format file size.
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

/**
 * Get file extension.
 */
export function getFileExtension(filename: string): string {
  const parts = filename.split(".");
  return parts.length > 1 ? parts.pop()! : "";
}

/**
 * Check whether a file is a LaTeX file.
 */
export function isLatexFile(filename: string): boolean {
  const ext = getFileExtension(filename).toLowerCase();
  return ["tex", "sty", "cls", "bib", "bst"].includes(ext);
}

/**
 * Safely add months to a date to avoid end-of-month drift.
 *
 * JavaScript's setMonth() can overflow when handling end-of-month dates:
 * - Jan 31 + 1 month → Mar 2/3 (instead of Feb 28)
 *
 * This function ensures:
 * - If the original date is at the end of a month (e.g. 31st), the result is the last day of the target month
 * - Example: Jan 31 + 1 month → Feb 28 (or Feb 29 in a leap year)
 *
 * @param date - Original date
 * @param months - Months to add (default: 1)
 * @returns A new Date object
 */
export function addMonthsSafe(date: Date, months: number = 1): Date {
  const result = new Date(date);
  const originalDay = date.getDate();

  // Set to the 1st first to avoid overflow during setMonth
  result.setDate(1);
  result.setMonth(result.getMonth() + months);

  // Get the last day of the target month
  const lastDayOfMonth = new Date(
    result.getFullYear(),
    result.getMonth() + 1,
    0
  ).getDate();

  // Use the smaller of the original day and the target month's last day
  result.setDate(Math.min(originalDay, lastDayOfMonth));

  return result;
}
