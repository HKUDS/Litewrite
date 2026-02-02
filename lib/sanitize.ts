/**
 * Input sanitization utilities.
 * ===========
 *
 * Uses DOMPurify to sanitize user-provided HTML/SVG to prevent XSS attacks.
 *
 * Example:
 *   import { sanitizeHtml, sanitizeSvg, sanitizeText } from "@/lib/sanitize";
 *   const cleanHtml = sanitizeHtml(userInput);
 *   const cleanSvg = sanitizeSvg(svgString);
 */

import DOMPurify from "dompurify";

// Only use DOMPurify on the client (requires a DOM environment)
const isClient = typeof window !== "undefined";

/**
 * Sanitize HTML content.
 *
 * Removes dangerous tags and attributes (e.g. script, onerror, onclick).
 */
export function sanitizeHtml(dirty: string): string {
  if (!isClient) {
    // Server-side: simple escaping
    return escapeHtml(dirty);
  }

  return DOMPurify.sanitize(dirty, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["script", "style", "iframe", "form", "input", "button"],
    FORBID_ATTR: ["onerror", "onclick", "onload", "onmouseover", "onfocus", "onblur"],
  });
}

/**
 * Sanitize SVG content.
 *
 * Preserves SVG-related tags while removing dangerous attributes.
 */
export function sanitizeSvg(dirty: string): string {
  if (!isClient) {
    // Server-side: simple escaping
    return escapeHtml(dirty);
  }

  return DOMPurify.sanitize(dirty, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ["use", "symbol", "defs", "clipPath", "mask", "pattern", "linearGradient", "radialGradient", "stop"],
    FORBID_ATTR: ["onerror", "onclick", "onload", "onmouseover", "onfocus", "onblur", "xlink:href"],
    // Allow data: URI for SVG images (with protocol restrictions)
    ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  });
}

/**
 * Sanitize plain text (escape all HTML).
 *
 * Used for displaying user-provided text and fully removing any HTML.
 */
export function sanitizeText(dirty: string): string {
  if (!isClient) {
    return escapeHtml(dirty);
  }

  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: [], // Disallow all tags
    ALLOWED_ATTR: [], // Disallow all attributes
  });
}

/**
 * HTML escaping (for server-side or simple scenarios).
 */
export function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (char) => map[char]);
}

/**
 * Sanitize username/display name.
 *
 * Removes special characters and keeps only safe characters.
 */
export function sanitizeName(name: string): string {
  // Remove control and non-printable characters
  let clean = name.replace(/[\x00-\x1F\x7F]/g, "");
  // Remove HTML tags
  clean = clean.replace(/<[^>]*>/g, "");
  // Limit length
  clean = clean.slice(0, 100);
  return clean.trim();
}

/**
 * Sanitize file name.
 *
 * Removes path traversal sequences and special characters.
 */
export function sanitizeFileName(fileName: string): string {
  // Remove path traversal sequences
  let clean = fileName.replace(/\.\./g, "");
  // Remove path separators
  clean = clean.replace(/[/\\]/g, "");
  // Remove special characters (keep common filename characters)
  clean = clean.replace(/[<>:"|?*\x00-\x1F]/g, "");
  // Limit length
  clean = clean.slice(0, 255);
  return clean.trim();
}

/**
 * Validate and sanitize a URL.
 *
 * Only allows http/https protocols.
 */
export function sanitizeUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

/**
 * Check whether a string contains a potential XSS payload.
 */
export function containsXssPayload(input: string): boolean {
  const xssPatterns = [
    /<script\b/i,
    /javascript:/i,
    /on\w+\s*=/i,  // onclick=, onerror=, etc.
    /data:\s*text\/html/i,
    /expression\s*\(/i,
    /vbscript:/i,
  ];

  return xssPatterns.some(pattern => pattern.test(input));
}
