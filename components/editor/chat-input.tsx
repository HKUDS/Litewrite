"use client";

import React, { useRef, useCallback, useEffect, useState, forwardRef, useImperativeHandle } from "react";
import { X, FileText, File, Code } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/lib/i18n";
import type { Attachment, LineRange } from "@/types/ask";

export interface ChatInputRef {
  focus: () => void;
  getValue: () => { text: string; attachments: Attachment[] };
  setValue: (text: string) => void;
  clear: () => void;
  insertAttachment: (attachment: Omit<Attachment, "id">) => void;
}

interface ChatInputProps {
  placeholder?: string;
  disabled?: boolean;
  disableAttachments?: boolean;
  onSubmit?: (text: string, attachments: Attachment[]) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  onChange?: (isEmpty: boolean) => void;
  className?: string;
}

/**
 * Cursor-style chat input.
 * Supports mixed text input and file references.
 */
export const ChatInput = forwardRef<ChatInputRef, ChatInputProps>(({
  placeholder = "Type a message...",
  disabled = false,
  disableAttachments = false,
  onSubmit,
  onKeyDown,
  onChange,
  className,
}, ref) => {
  const { t } = useTranslations("chat");
  const editorRef = useRef<HTMLDivElement>(null);
  const [isEmpty, setIsEmpty] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const attachmentsRef = useRef<Map<string, Attachment>>(new Map());

  // Generate a unique id
  const generateId = () => `att_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // Check whether the input is empty
  const checkEmpty = useCallback(() => {
    if (!editorRef.current) return;
    const text = editorRef.current.textContent || "";
    const empty = text.trim().length === 0 && attachmentsRef.current.size === 0;
    setIsEmpty(empty);
    onChange?.(empty);
  }, [onChange]);

  // Get file icon
  const getFileIcon = (fileName: string, type: string) => {
    if (type === "selection") {
      return `<svg class="inline-block w-3 h-3 mr-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>`;
    }
    const ext = fileName.split(".").pop()?.toLowerCase();
    if (ext === "tex" || ext === "md") {
      return `<svg class="inline-block w-3 h-3 mr-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`;
    }
    return `<svg class="inline-block w-3 h-3 mr-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>`;
  };

  // Create the HTML for a file-reference chip
  const createChipHTML = (attachment: Attachment) => {
    const icon = getFileIcon(attachment.fileName, attachment.type);

    // Display filename (may already include line-range info)
    let displayText = attachment.fileName;

    // If lineRange exists but filename doesn't include it yet, append the range
    if (attachment.lineRange && !attachment.fileName.includes("(")) {
      displayText = `${attachment.fileName} (${attachment.lineRange.start}-${attachment.lineRange.end})`;
    }

    return `<span contenteditable="false" data-attachment-id="${attachment.id}" class="inline-flex items-center gap-0.5 mx-0.5 px-1.5 py-0.5 rounded-md bg-muted text-foreground text-xs cursor-default select-none whitespace-nowrap align-middle border border-border">${icon}<span class="max-w-[180px] truncate">${displayText}</span><button type="button" data-remove-attachment="${attachment.id}" class="ml-0.5 text-muted-foreground hover:text-destructive transition-colors">×</button></span>`;
  };

  // Insert an attachment at the cursor position
  const insertAttachment = useCallback((attachmentData: Omit<Attachment, "id">) => {
    if (!editorRef.current) return;

    const attachment: Attachment = {
      ...attachmentData,
      id: generateId(),
    };

    attachmentsRef.current.set(attachment.id, attachment);

    const chipHTML = createChipHTML(attachment);

    // Focus the editor
    editorRef.current.focus();

    // Get current selection
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      range.deleteContents();

      // Create a temporary container to parse HTML
      const temp = document.createElement("div");
      temp.innerHTML = chipHTML;
      const chip = temp.firstChild as Node;

      range.insertNode(chip);

      // Move the cursor after the chip
      range.setStartAfter(chip);
      range.setEndAfter(chip);
      selection.removeAllRanges();
      selection.addRange(range);

      // Insert a space so the user can keep typing
      document.execCommand("insertText", false, " ");
    }

    checkEmpty();
  }, [checkEmpty]);

  // Get value: text content and attachment list
  const getValue = useCallback((): { text: string; attachments: Attachment[] } => {
    if (!editorRef.current) return { text: "", attachments: [] };

    const attachments: Attachment[] = [];
    let text = "";

    // Walk all child nodes
    const processNode = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent || "";
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        const attachmentId = el.getAttribute("data-attachment-id");
        if (attachmentId) {
          const attachment = attachmentsRef.current.get(attachmentId);
          if (attachment) {
            attachments.push(attachment);
            // Mark attachment position with a placeholder in the text
            text += `[[FILE:${attachment.fileName}${attachment.lineRange ? `:${attachment.lineRange.start}-${attachment.lineRange.end}` : ""}]]`;
          }
        } else {
          // Recurse into child nodes
          el.childNodes.forEach(processNode);
        }
      }
    };

    editorRef.current.childNodes.forEach(processNode);

    return { text: text.trim(), attachments };
  }, []);

  // Clear input
  const clear = useCallback(() => {
    if (!editorRef.current) return;
    editorRef.current.innerHTML = "";
    attachmentsRef.current.clear();
    setIsEmpty(true);
    onChange?.(true);
  }, [onChange]);

  // Set input content
  const setValue = useCallback((text: string) => {
    if (!editorRef.current) return;
    editorRef.current.textContent = text;
    const empty = text.trim().length === 0;
    setIsEmpty(empty);
    onChange?.(empty);
  }, [onChange]);

  // Focus
  const focus = useCallback(() => {
    editorRef.current?.focus();
  }, []);

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    focus,
    getValue,
    setValue,
    clear,
    insertAttachment,
  }), [focus, getValue, setValue, clear, insertAttachment]);

  // Handle input
  const handleInput = useCallback(() => {
    checkEmpty();
  }, [checkEmpty]);

  // Handle key events
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // When disabled, block submit actions
    if (disabled) {
      if (e.key === "Enter") {
        e.preventDefault();
      }
      return;
    }

    // Check whether we're in IME composition (e.g. Chinese/Japanese input).
    // If isComposing is true, Enter confirms the IME candidate rather than sending the message.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      const { text, attachments } = getValue();
      if (text || attachments.length > 0) {
        onSubmit?.(text, attachments);
      }
    }
    onKeyDown?.(e);
  }, [disabled, getValue, onSubmit, onKeyDown]);

  // Handle click (remove button)
  const handleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const removeId = target.getAttribute("data-remove-attachment");
    if (removeId) {
      e.preventDefault();
      e.stopPropagation();

      // Remove chip
      const chip = editorRef.current?.querySelector(`[data-attachment-id="${removeId}"]`);
      if (chip) {
        chip.remove();
      }
      attachmentsRef.current.delete(removeId);
      checkEmpty();
    }
  }, [checkEmpty]);

  // Drag & drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    // If attachments are disabled, do nothing
    if (disableAttachments) return;

    const binaryExts = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".zip", ".tar", ".gz"];

    // Handle file drop
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files).filter(file => {
        const ext = file.name.includes(".") ? "." + file.name.split(".").pop()?.toLowerCase() : "";
        return !binaryExts.includes(ext);
      });

      files.forEach(file => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          const content = ev.target?.result as string;
          insertAttachment({
            type: "file",
            filePath: file.name,
            fileName: file.name,
            preview: content?.slice(0, 300) || "",
          });
        };
        reader.readAsText(file);
      });
      return;
    }

    // Handle text drop
    const textData = e.dataTransfer.getData("text/plain");
    if (textData) {
      const lines = textData.trim().split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && (trimmed.includes("/") || trimmed.includes("\\") || trimmed.match(/\.\w+$/))) {
          const fileName = trimmed.split(/[/\\]/).pop() || trimmed;
          insertAttachment({
            type: "file",
            filePath: trimmed,
            fileName: fileName,
            preview: `File: ${trimmed}`,
          });
        }
      }
    }
  }, [insertAttachment, disableAttachments]);

  // Handle paste
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    console.log("[Litewrite Paste] Paste event triggered");
    console.log("[Litewrite Paste] Available types:", e.clipboardData?.types);

    // Try to extract Litewrite selection metadata from multiple formats
    let metadata: {
      type: string;
      filePath?: string;
      fileName?: string;
      startLine?: number;
      endLine?: number;
      text?: string;
    } | null = null;

    // Method 1: custom MIME type (supported in some environments)
    const litewriteData = e.clipboardData?.getData("application/x-litewrite-selection");
    console.log("[Litewrite Paste] Custom MIME data:", litewriteData ? litewriteData.slice(0, 100) + "..." : "null");
    if (litewriteData) {
      try {
        metadata = JSON.parse(litewriteData);
        console.log("[Litewrite Paste] Parsed from custom MIME:", metadata);
      } catch (err) {
        console.warn("[Litewrite Paste] Failed to parse from custom MIME:", err);
      }
    }

    // Method 2: extract metadata from text/html (better browser compatibility)
    if (!metadata) {
      const htmlData = e.clipboardData?.getData("text/html");
      console.log("[Litewrite Paste] HTML data:", htmlData ? htmlData.slice(0, 200) + "..." : "null");
      if (htmlData) {
        // Find the data-litewrite-selection attribute
        const match = htmlData.match(/data-litewrite-selection='([^']+)'/);
        console.log("[Litewrite Paste] HTML match:", match ? "found" : "not found");
        if (match) {
          try {
            // Decode HTML entities
            const decoded = match[1]
              .replace(/&amp;/g, "&")
              .replace(/&#39;/g, "'")
              .replace(/&quot;/g, '"');
            metadata = JSON.parse(decoded);
            console.log("[Litewrite Paste] Parsed from HTML:", metadata);
          } catch (err) {
            console.warn("[Litewrite Paste] Failed to parse from HTML:", err);
          }
        }
      }
    }

    console.log("[Litewrite Paste] Final metadata:", metadata);

    // If Litewrite metadata is found, handle it
    if (metadata && metadata.type === "litewrite-selection") {
          // If attachments are disabled, ignore selection paste
          if (disableAttachments) {
            // Paste plain text only
            const text = metadata.text || "";
            if (text) {
              e.preventDefault();
              document.execCommand("insertText", false, text);
            }
            return;
          }

          e.preventDefault();

          const text = metadata.text || "";
          const lineCount = (metadata.endLine || 1) - (metadata.startLine || 1) + 1;
          const textLength = text.length;

          // Decide whether to show as a reference:
          // multiple lines, or a single line longer than 50 characters
          const shouldUseReference = lineCount > 1 || textLength > 50;

          if (shouldUseReference) {
            // Use reference-style attachment
            let displayName = metadata.fileName || "selection";
            const startLine = metadata.startLine || 1;
            const endLine = metadata.endLine || startLine;

            // Always show range format: filename (start-end)
            displayName = `${metadata.fileName} (${startLine}-${endLine})`;

            // Build preview: start...end or full text
            let preview = text;
            if (textLength > 100) {
              const start = text.slice(0, 40).trim();
              const end = text.slice(-40).trim();
              preview = `${start} ... ${end}`;
            }

            insertAttachment({
              type: "selection",
              filePath: metadata.filePath || metadata.fileName || "unknown",
              fileName: displayName,
              // Always set lineRange, even for single line
              lineRange: {
                start: metadata.startLine ?? 1,
                end: metadata.endLine ?? metadata.startLine ?? 1,
              },
              preview: preview,
            });
          } else {
            // Short content: paste directly
            document.execCommand("insertText", false, text);
          }
          return;
    }

    // Handle file paste (skip if attachments are disabled)
    if (disableAttachments) return;

    const items = e.clipboardData?.items;
    if (!items) return;

    const binaryExts = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".zip", ".tar", ".gz"];

    for (const item of items) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) {
          const ext = file.name.includes(".") ? "." + file.name.split(".").pop()?.toLowerCase() : "";
          if (!binaryExts.includes(ext)) {
            e.preventDefault();
            const reader = new FileReader();
            reader.onload = (ev) => {
              const content = ev.target?.result as string;
              insertAttachment({
                type: "file",
                filePath: file.name,
                fileName: file.name,
                preview: content?.slice(0, 300) || "",
              });
            };
            reader.readAsText(file);
          }
        }
      }
    }
  }, [insertAttachment, disableAttachments]);

  return (
    <div
      className={cn(
        "relative rounded-lg border border-input bg-background transition-all",
        isDragging && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        disabled && "opacity-50 cursor-not-allowed",
        className
      )}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div
        ref={editorRef}
        contentEditable={!disabled}
        className={cn(
          "relative min-h-[60px] max-h-[150px] overflow-y-auto px-3 py-2 text-sm outline-none",
          "focus:ring-0 [&_*]:outline-none",
          isEmpty && "before:content-[attr(data-placeholder)] before:text-muted-foreground before:pointer-events-none before:absolute before:left-3 before:top-2"
        )}
        data-placeholder={placeholder}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onClick={handleClick}
        onPaste={handlePaste}
        suppressContentEditableWarning
      />

      {/* Drag-and-drop hint */}
      {isDragging && (
        <div className="absolute inset-0 bg-primary/10 backdrop-blur-sm rounded-lg flex items-center justify-center z-10 pointer-events-none">
          <span className="text-sm font-medium text-primary">{t("attachments.dropHere")}</span>
        </div>
      )}
    </div>
  );
});

ChatInput.displayName = "ChatInput";

export default ChatInput;
