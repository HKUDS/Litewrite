"use client";

import { useState, useRef, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { sanitizeSvg } from "@/lib/sanitize";

/**
 * Check whether Mermaid code is complete (basic structure validation).
 * During streaming rendering, incomplete code can cause syntax errors.
 */
function isMermaidCodeComplete(code: string): boolean {
  const trimmed = code.trim();
  if (!trimmed) return false;

  // Detect common Mermaid diagram type starters
  const diagramTypes = [
    'graph', 'flowchart', 'sequenceDiagram', 'classDiagram',
    'stateDiagram', 'erDiagram', 'journey', 'gantt', 'pie',
    'gitGraph', 'mindmap', 'timeline', 'quadrantChart',
    'sankey', 'xychart', 'block'
  ];

  const hasValidStart = diagramTypes.some(type =>
    trimmed.toLowerCase().startsWith(type.toLowerCase())
  );

  if (!hasValidStart) return false;

  // Check basic structure (must contain at least some content)
  const lines = trimmed.split('\n').filter(l => l.trim());
  if (lines.length < 2) return false;

  // Check whether it may be truncated (ends with common incomplete patterns)
  const lastLine = lines[lines.length - 1].trim();
  const incompletePatterns = [
    /\[$/, // Unclosed square bracket
    /\($/, // Unclosed parenthesis
    /\{$/, // Unclosed curly brace
    /-->$/, // Arrow without a target
    /---$/, // Incomplete connector line
    /:$/, // Colon without content
    /\|$/, // Incomplete pipe symbol
  ];

  if (incompletePatterns.some(p => p.test(lastLine))) {
    return false;
  }

  return true;
}

// Mermaid initialization flag (initialize once globally)
let mermaidInitialized = false;

interface MermaidBlockProps {
  code: string;
}

export function MermaidBlock({ code }: MermaidBlockProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>("");
  const [renderFailed, setRenderFailed] = useState(false);

  useEffect(() => {
    let mounted = true;

    const renderMermaid = async () => {
      // First check whether code is complete
      if (!isMermaidCodeComplete(code)) {
        setSvg("");
        setRenderFailed(false);
        return;
      }

      try {
        // Dynamically load mermaid
        const mermaid = (await import("mermaid")).default;

        if (!mounted) return;

        // Initialize once
        if (!mermaidInitialized) {
          mermaid.initialize({
            startOnLoad: false,
            theme: "neutral",
            securityLevel: "loose",
            suppressErrorRendering: true,  // Prevent error rendering into the DOM
          });
          mermaidInitialized = true;
        }

        const id = `mermaid-${Math.random().toString(36).slice(2, 9)}`;
        const { svg } = await mermaid.render(id, code);

        if (!mounted) return;

        setSvg(svg);
        setRenderFailed(false);
      } catch {
        if (!mounted) return;
        // Do not show errors; keep the loading state only.
        // It will auto-render again once the code becomes complete.
        setSvg("");
        setRenderFailed(true);
        // Note: avoid global DOM cleanup to prevent accidentally removing other elements.
        // Mermaid's suppressErrorRendering: true should already prevent error rendering.
      }
    };

    if (code.trim()) {
      renderMermaid();
    }

    return () => {
      mounted = false;
    };
  }, [code]);

  // Do not render anything for empty code
  if (!code.trim()) {
    return null;
  }

  // Render succeeded: show diagram
  if (svg) {
    return (
      <div
        ref={containerRef}
        className="my-4 flex justify-center overflow-x-auto rounded-lg border border-border bg-background p-4"
        dangerouslySetInnerHTML={{ __html: sanitizeSvg(svg) }}
      />
    );
  }

  // Not rendered (incomplete code or render failure): show loading
  return (
    <div className="flex items-center justify-center p-4 text-muted-foreground bg-muted/30 rounded-lg my-4 border border-border">
      <Loader2 className="h-4 w-4 animate-spin mr-2" />
      <span className="text-xs">{renderFailed ? "Rendering diagram..." : "Generating diagram..."}</span>
    </div>
  );
}
