/**
 * Email utility functions
 *
 * According to RFC 5321, the local part of an email address (before '@') is case-sensitive,
 * but in practice almost all email providers treat it as case-insensitive.
 * To avoid UX issues (e.g. signing up with \"Test@Example.com\" but logging in with \"test@example.com\"),
 * we normalize email addresses to lowercase for storage and lookup.
 */

/**
 * Normalize an email address.
 * - Convert to lowercase
 * - Trim leading/trailing whitespace
 *
 * @param email Raw email address
 * @returns Normalized email address
 */
export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}
