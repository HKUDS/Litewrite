"use client";

import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/lib/i18n";

// Information about the double-clicked word
export interface ClickedWordInfo {
  word: string;           // The selected word
  contextBefore?: string; // Text before the word (for context matching)
  contextAfter?: string;  // Text after the word (for context matching)
}

interface PdfRendererProps {
  pdfUrl: string;
  scale: number;
  onLoadSuccess: (numPages: number) => void;
  onPageClick?: (pageNumber: number, x: number, y: number, clickedWord?: ClickedWordInfo) => void;
  onVisiblePageChange?: (pageNumber: number) => void;
}

export interface PdfRendererHandle {
  scrollToPage: (pageNumber: number) => void;
  highlightArea: (pageNumber: number, x: number, y: number, width: number, height: number) => void;
  getPageSize: (pageNumber?: number) => { width: number; height: number } | null;
}

// Store the actual size for each page
interface PageSize {
  width: number;
  height: number;
}

// Render PDF using native canvas: continuous scrolling + serial rendering (pdfjs-dist 4.x)
export const PdfRenderer = forwardRef<PdfRendererHandle, PdfRendererProps>(({
  pdfUrl,
  scale,
  onLoadSuccess,
  onPageClick,
  onVisiblePageChange,
}, ref) => {
  const { t } = useTranslations("editor");
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const textLayerRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const annotationLayerRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const pageSizesRef = useRef<Map<number, PageSize>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [numPages, setNumPages] = useState(0);
  const [renderedPages, setRenderedPages] = useState<Set<number>>(new Set());
  const [currentVisiblePage, setCurrentVisiblePage] = useState(1);
  const renderQueueRef = useRef<number[]>([]);
  const isRenderingRef = useRef(false);
  const scaleRef = useRef(scale);

  // Keep scale ref up to date
  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  // Expose scroll/highlight methods
  useImperativeHandle(ref, () => ({
    // Scroll to a page and apply a full-page highlight
    scrollToPage: (pageNumber: number) => {
      console.log(`[PdfRenderer] scrollToPage called: ${pageNumber}`);
      const pageDiv = pageRefs.current.get(pageNumber);
      if (pageDiv) {
        pageDiv.scrollIntoView({ behavior: "smooth", block: "start" });

        // Add full-page highlight effect
        pageDiv.classList.add('synctex-pdf-highlight');
        setTimeout(() => {
          pageDiv.classList.remove('synctex-pdf-highlight');
        }, 2000);
      } else {
        console.warn(`[PdfRenderer] Page ${pageNumber} not found in refs`);
      }
    },

    // Highlight a specific region in the PDF (reserved for future use)
    highlightArea: (pageNumber: number, pdfX: number, pdfY: number, pdfWidth: number, pdfHeight: number) => {
      console.log(`[PdfRenderer] highlightArea: page=${pageNumber}, x=${pdfX}, y=${pdfY}, w=${pdfWidth}, h=${pdfHeight}`);

      const pageDiv = pageRefs.current.get(pageNumber);
      const canvas = canvasRefs.current.get(pageNumber);
      const pageSize = pageSizesRef.current.get(pageNumber);

      if (!pageDiv || !canvas || !pageSize) {
        console.warn(`[PdfRenderer] Cannot highlight: page ${pageNumber} not ready`);
        return;
      }

      // Scroll to page first
      pageDiv.scrollIntoView({ behavior: "smooth", block: "center" });

      // Convert PDF coordinates to screen coordinates
      const canvasRect = canvas.getBoundingClientRect();
      const scaleX = canvasRect.width / pageSize.width;
      const scaleY = canvasRect.height / pageSize.height;

      // PDF Y axis: origin is bottom-left, positive upward
      // Screen Y axis: origin is top-left, positive downward
      const screenX = pdfX * scaleX;
      const screenY = (pageSize.height - pdfY - pdfHeight) * scaleY;
      const screenWidth = Math.max(pdfWidth * scaleX, 100); // Minimum width: 100px
      const screenHeight = Math.max(pdfHeight * scaleY, 20); // Minimum height: 20px

      // Create highlight element
      const highlight = document.createElement('div');
      highlight.className = 'synctex-area-highlight';
      highlight.style.cssText = `
        position: absolute;
        left: ${screenX}px;
        top: ${screenY}px;
        width: ${screenWidth}px;
        height: ${screenHeight}px;
        pointer-events: none;
        z-index: 10;
      `;

      pageDiv.appendChild(highlight);

      // Remove highlight after ~2s
      setTimeout(() => {
        highlight.remove();
      }, 2500);
    },

    // Get page size (used for fit-to-width/height calculations)
    getPageSize: (pageNumber?: number) => {
      const page = pageNumber || 1;
      const size = pageSizesRef.current.get(page);
      return size || null;
    },
  }), []);

  // Initialize PDF.js
  useEffect(() => {
    let mounted = true;

    const initPdfJs = async () => {
      try {
        // Ensure this runs only on the client
        if (typeof window === 'undefined') {
          return;
        }

        let pdfjsLib;

        try {
          // Option 1: try standard import
          pdfjsLib = await import("pdfjs-dist");
        } catch (standardError) {
          console.warn("[PdfRenderer] Standard import failed; falling back to CDN load");

          // Option 2: load from CDN
          await loadPdfJsFromCDN();
          pdfjsLib = (window as any).pdfjsLib;

          if (!pdfjsLib) {
            throw new Error("PDF_LOAD_CDN_FAILED");
          }
        }

        // Set worker
        if (pdfjsLib.GlobalWorkerOptions) {
          pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@5.4.449/build/pdf.worker.min.mjs`;
        }

        if (mounted) {
          // Configure CMap + standard fonts (critical for CJK and special glyph rendering)
          const loadingTask = pdfjsLib.getDocument({
            url: pdfUrl,
            cMapUrl: 'https://unpkg.com/pdfjs-dist@5.4.449/cmaps/',
            cMapPacked: true,
            standardFontDataUrl: 'https://unpkg.com/pdfjs-dist@5.4.449/standard_fonts/',
          });
          const pdf = await loadingTask.promise;

          if (mounted) {
            setPdfDoc(pdf);
            setNumPages(pdf.numPages);
            onLoadSuccess(pdf.numPages);
            setLoading(false);
          }
        }
      } catch (err) {
        console.error("[PdfRenderer] Error:", err);
        if (mounted) {
          setError("PDF_LOAD_FAILED");
          setLoading(false);
        }
      }
    };

    initPdfJs();

    // Cleanup: release references and clear canvases
    return () => {
      mounted = false;
      // Clear canvas contexts
      canvasRefs.current.forEach((canvas) => {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
        canvas.width = 0;
        canvas.height = 0;
      });
      canvasRefs.current.clear();
      textLayerRefs.current.clear();
      annotationLayerRefs.current.clear();
      pageRefs.current.clear();
      pageSizesRef.current.clear();
    };
  }, [pdfUrl, onLoadSuccess]);

  // Destroy PDF document on unmount
  useEffect(() => {
    return () => {
      if (pdfDoc) {
        console.log('[PdfRenderer] Destroying PDF document to free memory');
        pdfDoc.destroy();
      }
    };
  }, [pdfDoc]);

  // Fallback: load PDF.js from CDN
  const loadPdfJsFromCDN = (): Promise<void> => {
    return new Promise((resolve, reject) => {
      if ((window as any).pdfjsLib) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://unpkg.com/pdfjs-dist@5.4.449/build/pdf.min.mjs';
      script.type = 'module';
      script.onload = () => {
        // Wait a moment to ensure the library is fully available
        setTimeout(() => {
          if ((window as any).pdfjsLib) {
            resolve();
          } else {
            reject(new Error('PDF_LIB_NOT_LOADED'));
          }
        }, 100);
      };
      script.onerror = () => reject(new Error('PDF_LOAD_CDN_FAILED'));
      document.head.appendChild(script);
    });
  };

  // Render a single page (serial to avoid concurrency issues) + text layer + annotation layer
  const renderPageInternal = useCallback(async (pageNumber: number, currentScale: number) => {
    if (!pdfDoc) return false;

    const canvas = canvasRefs.current.get(pageNumber);
    const textLayerDiv = textLayerRefs.current.get(pageNumber);
    const annotationLayerDiv = annotationLayerRefs.current.get(pageNumber);
    if (!canvas) return false;

    try {
      const page = await pdfDoc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: currentScale });

      // Store original page size (unscaled)
      const originalViewport = page.getViewport({ scale: 1.0 });
      pageSizesRef.current.set(pageNumber, {
        width: originalViewport.width,
        height: originalViewport.height,
      });

      const context = canvas.getContext("2d");
      if (!context) return false;

      // Account for device pixel ratio for sharper rendering on HiDPI screens
      const pixelRatio = window.devicePixelRatio || 1;

      // Set canvas backing store size (multiplied by pixel ratio)
      canvas.width = viewport.width * pixelRatio;
      canvas.height = viewport.height * pixelRatio;

      // Set CSS display size (keep logical size)
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      // Scale context to match pixel ratio
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

      // Clear previous content
      context.clearRect(0, 0, canvas.width, canvas.height);

      const renderTask = page.render({
        canvasContext: context,
        viewport: viewport,
      });
      await renderTask.promise;

      // Render text layer (for text selection and double-click word extraction)
      if (textLayerDiv) {
        // Clear previous text layer content
        textLayerDiv.innerHTML = '';

        // PDF.js 5.x TextLayer relies on these CSS variables to compute dimensions correctly.
        // This is key to avoiding the width=0 issue.
        textLayerDiv.style.setProperty('--scale-factor', String(currentScale));
        textLayerDiv.style.setProperty('--total-scale-factor', String(currentScale));
        textLayerDiv.style.setProperty('--scale-round-x', '1px');
        textLayerDiv.style.setProperty('--scale-round-y', '1px');

        // Match text layer size to canvas
        textLayerDiv.style.width = `${viewport.width}px`;
        textLayerDiv.style.height = `${viewport.height}px`;

        try {
          // Get text content
          const textContent = await page.getTextContent();

          // Try using the official PDF.js TextLayer API (most accurate)
          let useOfficialApi = false;
          // try {
          //   // Dynamically import TextLayer to ensure it works in production builds
          //   const pdfjsModule = await import("pdfjs-dist");

          //   // In PDF.js 5.x, TextLayer is exported directly
          //   const TextLayerClass = pdfjsModule.TextLayer;

          //   if (TextLayerClass) {
          //     const textLayer = new TextLayerClass({
          //       textContentSource: textContent,
          //       container: textLayerDiv,
          //       viewport: viewport,
          //     });
          //     await textLayer.render();
          //     useOfficialApi = true;

          //     textLayerDiv.dataset.rendered = 'true';
          //     textLayerDiv.dataset.pageNumber = String(pageNumber);

          //     // Debug: print detailed info about text layer and spans
          //     const textLayerRect = textLayerDiv.getBoundingClientRect();
          //     const canvasRect = canvas.getBoundingClientRect();
          //     const firstSpan = textLayerDiv.querySelector('span');
          //     const spanCount = textLayerDiv.querySelectorAll('span').length;

          //     console.log(`[PdfRenderer] === DEBUG Page ${pageNumber} ===`);
          //     console.log(`[PdfRenderer] Scale: ${currentScale}`);
          //     console.log(`[PdfRenderer] Viewport: ${viewport.width.toFixed(1)} x ${viewport.height.toFixed(1)}`);
          //     console.log(`[PdfRenderer] Canvas rect: left=${canvasRect.left.toFixed(1)}, top=${canvasRect.top.toFixed(1)}, width=${canvasRect.width.toFixed(1)}, height=${canvasRect.height.toFixed(1)}`);
          //     console.log(`[PdfRenderer] TextLayer style: width=${textLayerDiv.style.width}, height=${textLayerDiv.style.height}`);
          //     console.log(`[PdfRenderer] TextLayer rect: left=${textLayerRect.left.toFixed(1)}, top=${textLayerRect.top.toFixed(1)}, width=${textLayerRect.width.toFixed(1)}, height=${textLayerRect.height.toFixed(1)}`);
          //     console.log(`[PdfRenderer] Span count: ${spanCount}`);

          //     if (firstSpan) {
          //       const spanStyle = firstSpan.getAttribute('style');
          //       const spanRect = firstSpan.getBoundingClientRect();
          //       console.log(`[PdfRenderer] First span style: ${spanStyle}`);
          //       console.log(`[PdfRenderer] First span rect: left=${spanRect.left.toFixed(1)}, top=${spanRect.top.toFixed(1)}, width=${spanRect.width.toFixed(1)}, height=${spanRect.height.toFixed(1)}`);
          //       console.log(`[PdfRenderer] First span text: "${firstSpan.textContent?.substring(0, 30)}..."`);
          //     }

          //     console.log(`[PdfRenderer] Text layer rendered using official API for page ${pageNumber}, scale=${currentScale}`);
          //   } else {
          //     console.log("[PdfRenderer] TextLayer class not found in pdfjs-dist module");
          //   }
          // } catch (apiError) {
          //   console.log("[PdfRenderer] Official TextLayer API error:", apiError);
          // }

          // Fallback: manual rendering
          if (!useOfficialApi) {
            console.log(`[PdfRenderer] Using manual text layer rendering for page ${pageNumber}`);

            const tx = viewport.transform;
            let lastY: number | null = null;
            const lineThreshold = 5;

            // Create a temporary canvas for accurate text width measurement
            const measureCanvas = document.createElement('canvas');
            const measureCtx = measureCanvas.getContext('2d');

            textContent.items.forEach((item: any) => {
              if (!item.str) return;

              const itemTx = item.transform;
              const fontHeightPdf = Math.sqrt(itemTx[2] * itemTx[2] + itemTx[3] * itemTx[3]);
              const fontSize = fontHeightPdf * Math.abs(tx[3]);
              const rotation = (itemTx[1] !== 0 || itemTx[2] !== 0)
                ? Math.atan2(itemTx[1], itemTx[0])
                : 0;

              const pdfX = itemTx[4];
              const pdfY = itemTx[5];
              const x = tx[0] * pdfX + tx[2] * pdfY + tx[4];
              const y = tx[1] * pdfX + tx[3] * pdfY + tx[5];

              const targetWidth = item.width ? item.width * Math.abs(tx[0]) : 0;

              if (lastY !== null && Math.abs(y - lastY) > lineThreshold) {
                const br = document.createElement('br');
                textLayerDiv.appendChild(br);
              }
              lastY = y;

              const span = document.createElement('span');
              span.textContent = item.str;
              span.style.left = `${x}px`;
              span.style.top = `${y - fontSize * 0.85}px`;
              span.style.fontSize = `${fontSize}px`;
              span.style.fontFamily = item.fontName ? `${item.fontName}, sans-serif` : 'sans-serif';
              span.style.lineHeight = '1.0';

              if (measureCtx && targetWidth > 0) {
                const fontFamily = item.fontName ? `${item.fontName}, sans-serif` : 'sans-serif';
                measureCtx.font = `${fontSize}px ${fontFamily}`;
                const measuredWidth = measureCtx.measureText(item.str).width;

                if (measuredWidth > 0) {
                  const scaleX = targetWidth / measuredWidth;
                  let transform = '';
                  if (Math.abs(scaleX - 1) > 0.001) {
                    transform = `scaleX(${scaleX})`;
                  }
                  if (rotation !== 0) {
                    transform += ` rotate(${rotation}rad)`;
                  }
                  if (transform) {
                    span.style.transform = transform.trim();
                  }
                }
              } else if (rotation !== 0) {
                span.style.transform = `rotate(${rotation}rad)`;
              }

              textLayerDiv.appendChild(span);
            });

            textLayerDiv.dataset.rendered = 'true';
            textLayerDiv.dataset.pageNumber = String(pageNumber);

            console.log(`[PdfRenderer] Text layer rendered manually for page ${pageNumber}, scale=${currentScale}, items=${textContent.items.length}`);

            if (!textLayerDiv.querySelector('.endOfContent')) {
              const endOfContent = document.createElement('div');
              endOfContent.className = 'endOfContent';
              textLayerDiv.appendChild(endOfContent);
            }
          }

        } catch (textLayerError) {
          console.warn("[PdfRenderer] TextLayer error:", textLayerError);
        }
      }

      // Render annotation layer (for link clicks and other interactions)
      if (annotationLayerDiv) {
        annotationLayerDiv.innerHTML = '';
        // Match annotation layer size to canvas
        annotationLayerDiv.style.width = `${viewport.width}px`;
        annotationLayerDiv.style.height = `${viewport.height}px`;

        try {
          const annotations = await page.getAnnotations();

          if (annotations && annotations.length > 0) {
            // Manually render link annotations by creating clickable <a> elements
            let linkCount = 0;
            for (const annotation of annotations) {
              // External URL links
              if (annotation.subtype === 'Link' && annotation.url) {
                const rect = annotation.rect;
                // Convert PDF rect to viewport/screen coordinates
                const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(rect);

                const link = document.createElement('a');
                link.href = annotation.url;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.className = 'pdf-annotation-link';
                link.style.cssText = `
                  position: absolute;
                  left: ${Math.min(x1, x2)}px;
                  top: ${Math.min(y1, y2)}px;
                  width: ${Math.abs(x2 - x1)}px;
                  height: ${Math.abs(y2 - y1)}px;
                  cursor: pointer;
                `;
                link.title = annotation.url;

                annotationLayerDiv.appendChild(link);
                linkCount++;
              }
              // Internal page navigation links (e.g. TOC, references)
              else if (annotation.subtype === 'Link' && annotation.dest) {
                const rect = annotation.rect;
                const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(rect);

                const link = document.createElement('a');
                link.href = '#';
                link.className = 'pdf-annotation-link pdf-internal-link';
                link.style.cssText = `
                  position: absolute;
                  left: ${Math.min(x1, x2)}px;
                  top: ${Math.min(y1, y2)}px;
                  width: ${Math.abs(x2 - x1)}px;
                  height: ${Math.abs(y2 - y1)}px;
                  cursor: pointer;
                `;

                // Store destination for internal navigation
                const dest = annotation.dest;
                link.dataset.dest = typeof dest === 'string' ? dest : JSON.stringify(dest);
                link.title = t("clickToJump");

                // Internal link click handler
                link.onclick = async (e) => {
                  e.preventDefault();
                  try {
                    // Resolve destination
                    let targetDest = dest;
                    if (typeof dest === 'string' && pdfDoc) {
                      targetDest = await pdfDoc.getDestination(dest);
                    }

                    if (targetDest && Array.isArray(targetDest) && targetDest[0]) {
                      // Get target page reference
                      const destRef = targetDest[0];
                      const pageIndex = await pdfDoc.getPageIndex(destRef);
                      const targetPageNumber = pageIndex + 1;

                      // Scroll to target page
                      const targetPageDiv = pageRefs.current.get(targetPageNumber);
                      if (targetPageDiv) {
                        targetPageDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        // Add highlight effect
                        targetPageDiv.classList.add('synctex-pdf-highlight');
                        setTimeout(() => {
                          targetPageDiv.classList.remove('synctex-pdf-highlight');
                        }, 2000);
                      }
                    }
                  } catch (navError) {
                    console.warn('[PdfRenderer] Internal link navigation error:', navError);
                  }
                };

                annotationLayerDiv.appendChild(link);
                linkCount++;
              }
            }
            if (linkCount > 0) {
              console.log(`[PdfRenderer] Annotation layer rendered for page ${pageNumber} with ${linkCount} links`);
            }
          }
        } catch (annotationError) {
          console.warn("[PdfRenderer] AnnotationLayer error:", annotationError);
        }
      }

      // Release page rendering resources (after finishing page operations)
      if (page.cleanup) {
        page.cleanup();
      }

      return true;
    } catch (err) {
      console.error(`[PdfRenderer] Render page ${pageNumber} error:`, err);
      return false;
    }
  }, [pdfDoc]);

  // Process render queue
  const processRenderQueue = useCallback(async () => {
    if (isRenderingRef.current || renderQueueRef.current.length === 0) return;

    isRenderingRef.current = true;

    while (renderQueueRef.current.length > 0) {
      const pageNumber = renderQueueRef.current.shift()!;
      const currentScale = scaleRef.current;

      const success = await renderPageInternal(pageNumber, currentScale);
      if (success) {
        setRenderedPages(prev => new Set(prev).add(pageNumber));
      }
    }

    isRenderingRef.current = false;
  }, [renderPageInternal]);

  // Add a page to the render queue
  const queueRender = useCallback((pageNumber: number) => {
    if (!renderQueueRef.current.includes(pageNumber)) {
      renderQueueRef.current.push(pageNumber);
      processRenderQueue();
    }
  }, [processRenderQueue]);

  // Re-render all pages when scale changes
  useEffect(() => {
    if (!pdfDoc || numPages === 0) return;

    // Reset render state and queue
    setRenderedPages(new Set());
    renderQueueRef.current = [];

    // Re-add all pages into the render queue
    for (let i = 1; i <= numPages; i++) {
      renderQueueRef.current.push(i);
    }

    processRenderQueue();
  }, [scale, pdfDoc, numPages, processRenderQueue]);

  // Initial render
  useEffect(() => {
    if (!pdfDoc || numPages === 0 || renderedPages.size > 0) return;

    for (let i = 1; i <= numPages; i++) {
      queueRender(i);
    }
  }, [pdfDoc, numPages, queueRender, renderedPages.size]);

  // Listen to scroll and update the currently visible page
  useEffect(() => {
    // Find the actual scroll container (walk up to an element with overflow-auto)
    let scrollContainer = containerRef.current?.parentElement;
    while (scrollContainer && !scrollContainer.classList.contains('overflow-auto')) {
      scrollContainer = scrollContainer.parentElement;
    }

    if (!scrollContainer || numPages === 0 || !onVisiblePageChange) {
      return;
    }

    let lastReportedPage = 0;

    const handleScroll = () => {
      const containerRect = scrollContainer!.getBoundingClientRect();

      // Compute the primary visible page
      let maxVisibleArea = 0;
      let mainVisiblePage = 1;

      pageRefs.current.forEach((pageDiv, pageNumber) => {
        const pageRect = pageDiv.getBoundingClientRect();
        const visibleTop = Math.max(pageRect.top, containerRect.top);
        const visibleBottom = Math.min(pageRect.bottom, containerRect.bottom);
        const visibleArea = Math.max(0, visibleBottom - visibleTop);

        if (visibleArea > maxVisibleArea) {
          maxVisibleArea = visibleArea;
          mainVisiblePage = pageNumber;
        }
      });

      // Notify only when page actually changes
      if (mainVisiblePage !== lastReportedPage) {
        lastReportedPage = mainVisiblePage;
        setCurrentVisiblePage(mainVisiblePage);
        onVisiblePageChange(mainVisiblePage);
      }
    };

    scrollContainer.addEventListener("scroll", handleScroll);
    // Delay initial check to allow scrolling/layout to settle
    const timeoutId = setTimeout(handleScroll, 100);

    return () => {
      scrollContainer!.removeEventListener("scroll", handleScroll);
      clearTimeout(timeoutId);
    };
  }, [numPages, onVisiblePageChange]);

  // Handle double click: coordinate conversion based on actual page size + extract selected text
  const handleDoubleClick = useCallback((event: React.MouseEvent, pageNumber: number) => {
    if (!onPageClick) return;

    const canvas = canvasRefs.current.get(pageNumber);
    const pageDiv = pageRefs.current.get(pageNumber);
    const textLayerDiv = textLayerRefs.current.get(pageNumber);
    if (!canvas || !pageDiv) return;

    const rect = pageDiv.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const clickY = event.clientY - rect.top;

    // Read actual PDF page size (original pt units)
    const pageSize = pageSizesRef.current.get(pageNumber);
    const pdfWidth = pageSize?.width || 595;  // Default A4
    const pdfHeight = pageSize?.height || 842;

    // Display size (matches canvas size)
    const displayWidth = canvas.width;
    const displayHeight = canvas.height;

    // Convert to PDF coordinates (pt)
    const pdfX = (clickX / displayWidth) * pdfWidth;
    const pdfY = pdfHeight - (clickY / displayHeight) * pdfHeight;

    // Extract double-click selected text (browser selects a word automatically).
    // Use requestAnimationFrame to ensure selection has been applied.
    requestAnimationFrame(() => {
      let clickedWord: ClickedWordInfo | undefined;

      const selection = window.getSelection();
      const selectedText = selection?.toString().trim();

      if (selectedText && selectedText.length > 0) {
        let contextBefore = '';  // Context before the word
        let contextAfter = '';   // Context after the word

        if (textLayerDiv) {
          const anchorNode = selection?.anchorNode;

          // Option 1: use Selection.anchorNode to extract context (most reliable).
          // After double-click, anchorNode is typically the text node containing the clicked word.
          if (anchorNode && anchorNode.nodeType === Node.TEXT_NODE) {
            const parentSpan = anchorNode.parentElement;
            if (parentSpan && textLayerDiv.contains(parentSpan)) {
              // Collect all spans and sort them by visual order
              const allSpans = Array.from(textLayerDiv.querySelectorAll('span')) as HTMLSpanElement[];

              // Sort by position: first by Y (line), then by X (column)
              const sortedSpans = allSpans
                .map(span => {
                  const spanRect = span.getBoundingClientRect();
                  return {
                    element: span,
                    text: span.textContent || '',
                    centerY: (spanRect.top + spanRect.bottom) / 2,
                    left: spanRect.left,
                  };
                })
                .sort((a, b) => {
                  // If in the same line (Y delta < 10px), sort by X
                  if (Math.abs(a.centerY - b.centerY) < 10) {
                    return a.left - b.left;
                  }
                  return a.centerY - b.centerY;
                });

              // Find current span index in sorted list
              const currentSpanIndex = sortedSpans.findIndex(s => s.element === parentSpan);

              if (currentSpanIndex !== -1) {
                const currentSpan = sortedSpans[currentSpanIndex];
                const currentSpanText = currentSpan.text;
                const anchorOffset = selection?.anchorOffset || 0;

                // Find the selected word's position within current span.
                // After double-click, anchorOffset is usually the word start offset.
                let wordStartInSpan = currentSpanText.indexOf(selectedText);

                // If span contains multiple identical matches, use anchorOffset to pick the closest one
                if (wordStartInSpan !== -1) {
                  // Collect all matches
                  let matchCount = 0;
                  let searchPos = 0;
                  const matches: number[] = [];
                  while ((searchPos = currentSpanText.indexOf(selectedText, searchPos)) !== -1) {
                    matches.push(searchPos);
                    matchCount++;
                    searchPos++;
                  }

                  if (matchCount > 1) {
                    // Choose the match closest to anchorOffset
                    wordStartInSpan = matches.reduce((best, pos) =>
                      Math.abs(pos - anchorOffset) < Math.abs(best - anchorOffset) ? pos : best
                    , matches[0]);
                  }
                }

                // Collect context. Only extract when word position is found.
                // If wordStartInSpan === -1, the word may span multiple spans; skip direct extraction.
                if (wordStartInSpan !== -1) {
                  const contextLength = 25;
                  let beforeParts: string[] = [];
                  let afterParts: string[] = [];

                  // Start from text before the word within current span
                  if (wordStartInSpan > 0) {
                    beforeParts.push(currentSpanText.substring(0, wordStartInSpan));
                  }

                  // Walk backwards to collect contextBefore
                  let beforeLength = beforeParts.join('').length;
                  for (let i = currentSpanIndex - 1; i >= 0 && beforeLength < contextLength; i--) {
                    const prevSpan = sortedSpans[i];
                    // Check whether it's the same/adjacent line (based on Y coordinate)
                    if (Math.abs(prevSpan.centerY - currentSpan.centerY) > 50) {
                      // Different paragraph; stop collecting
                      break;
                    }
                    beforeParts.unshift(prevSpan.text);
                    beforeLength += prevSpan.text.length;
                  }
                  contextBefore = beforeParts.join('').slice(-contextLength);

                  // Start from text after the word within current span
                  const wordEndInSpan = wordStartInSpan + selectedText.length;
                  if (wordEndInSpan < currentSpanText.length) {
                    afterParts.push(currentSpanText.substring(wordEndInSpan));
                  }

                  // Walk forwards to collect contextAfter
                  let afterLength = afterParts.join('').length;
                  for (let i = currentSpanIndex + 1; i < sortedSpans.length && afterLength < contextLength; i++) {
                    const nextSpan = sortedSpans[i];
                    // Check whether it's the same/adjacent line
                    if (Math.abs(nextSpan.centerY - currentSpan.centerY) > 50) {
                      // Different paragraph; stop collecting
                      break;
                    }
                    afterParts.push(nextSpan.text);
                    afterLength += nextSpan.text.length;
                  }
                  contextAfter = afterParts.join('').substring(0, contextLength);

                  console.log(`[PdfRenderer] Direct context extraction from anchorNode`);
                  console.log(`[PdfRenderer] Span: "${currentSpanText.substring(0, 30)}...", wordStart=${wordStartInSpan}`);
                  console.log(`[PdfRenderer] Context: "${contextBefore}" [${selectedText}] "${contextAfter}"`);
                } else {
                  // Word spans multiple spans; let the fallback mechanism handle it
                  console.log(`[PdfRenderer] Word "${selectedText}" spans multiple spans, skipping direct context extraction`);
                }
              }
            }
          }

          // Option 2: if option 1 fails (e.g. anchorNode is not a text node), use fallback
          if (!contextBefore && !contextAfter) {
            console.log(`[PdfRenderer] Fallback: anchorNode method failed, using position-based method`);

            // Collect all spans and sort by position
            const spans = Array.from(textLayerDiv.querySelectorAll('span'));
            const spanInfos = spans.map(span => {
              const spanRect = span.getBoundingClientRect();
              return {
                text: span.textContent || '',
                left: spanRect.left - rect.left,
                top: spanRect.top - rect.top,
                bottom: spanRect.bottom - rect.top,
                centerY: (spanRect.top + spanRect.bottom) / 2 - rect.top,
              };
            });

            // Find the visual line containing the click position
            const clickedLineSpans = spanInfos.filter(s =>
              clickY >= s.top - 5 && clickY <= s.bottom + 5
            );

            if (clickedLineSpans.length > 0) {
              // Sort spans in the same line by X
              const sortedLineSpans = clickedLineSpans.sort((a, b) => a.left - b.left);
              const lineText = sortedLineSpans.map(s => s.text).join('');

              // Find the selected word within the line text
              const wordIndex = lineText.indexOf(selectedText);
              if (wordIndex !== -1) {
                contextBefore = lineText.substring(Math.max(0, wordIndex - 20), wordIndex);
                contextAfter = lineText.substring(wordIndex + selectedText.length, wordIndex + selectedText.length + 20);
                console.log(`[PdfRenderer] Fallback context: "${contextBefore}" [${selectedText}] "${contextAfter}"`);
              }
            }
          }
        }

        clickedWord = {
          word: selectedText,
          contextBefore,
          contextAfter,
        };
        console.log("[PdfRenderer] Selected word: \"" + selectedText + "\"");
      } else {
        console.log("[PdfRenderer] No text selected");
      }

      console.log("[PdfRenderer] Double-click: page=" + pageNumber + ", pdfX=" + pdfX.toFixed(1) + ", pdfY=" + pdfY.toFixed(1));

      onPageClick(pageNumber, pdfX, pdfHeight - pdfY, clickedWord);
    });
  }, [onPageClick]);

  if (error) {
    return <div className="text-destructive">{t("pdfLoadFailed")}</div>;
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        {t("pdfLoading")}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="pdfjs-viewer-inner flex flex-col items-center gap-4">
      {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNumber) => (
        <div
          key={pageNumber}
          ref={(el) => {
            if (el) pageRefs.current.set(pageNumber, el);
          }}
          className="pdf-page-container relative"
          data-page={pageNumber}
        >
          <canvas
            ref={(el) => {
              if (el) canvasRefs.current.set(pageNumber, el);
            }}
            className={cn(
              "react-pdf__Page shadow-lg cursor-text bg-white",
              !renderedPages.has(pageNumber) && "min-h-[800px] min-w-[600px]"
            )}
          />
          {/* Text layer - enables text selection and double-click word extraction */}
          <div
            ref={(el) => {
              if (el) textLayerRefs.current.set(pageNumber, el);
            }}
            className="text-layer"
            onDoubleClick={(e) => handleDoubleClick(e, pageNumber)}
          />
          {/* Annotation layer - enables link clicks and other interactions */}
          <div
            ref={(el) => {
              if (el) annotationLayerRefs.current.set(pageNumber, el);
            }}
            className="annotation-layer"
          />
          {/* Loading placeholder */}
          {!renderedPages.has(pageNumber) && (
            <div className="absolute inset-0 flex items-center justify-center bg-white">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
          {/* Page label */}
          <div className="absolute bottom-2 right-2 bg-black/50 text-white text-xs px-2 py-1 rounded">
            {pageNumber} / {numPages}
          </div>
        </div>
      ))}
    </div>
  );
});

PdfRenderer.displayName = "PdfRenderer";
