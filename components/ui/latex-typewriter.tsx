"use client";

import { useEffect, useState, useCallback } from "react";
import { cn } from "@/lib/utils";

interface LatexTypewriterProps {
  className?: string;
  onComplete?: () => void;
  startDelay?: number; // Delay before starting
}

export function LatexTypewriter({
  className,
  onComplete,
  startDelay = 0
}: LatexTypewriterProps) {
  const [phase, setPhase] = useState<
    "waiting" | "typing-title" | "show-ghost" | "complete" | "pause" | "reset"
  >("waiting");

  const [displayedTitle, setDisplayedTitle] = useState("");
  const [showGhost, setShowGhost] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [showCursor, setShowCursor] = useState(true);

  const titleText = "Litewrite is Here to";
  const ghostText = "Write with You!";

  // Compute typing delay to add rhythm
  const getTypingDelay = (currentLength: number, text: string): number => {
    const nextChar = text[currentLength];
    const prevChar = currentLength > 0 ? text[currentLength - 1] : "";

    // Short pause after a space (simulate thinking)
    if (prevChar === " ") {
      return 150 + Math.random() * 100;
    }

    // Pause a bit after finishing "Litewrite"
    if (currentLength === 9) { // Length of "Litewrite"
      return 300;
    }

    // Slightly slower at the start of a word
    if (prevChar === " " || currentLength === 0) {
      return 80 + Math.random() * 40;
    }

    // Normal characters: base speed + randomness
    return 40 + Math.random() * 30;
  };

  // Cursor blink
  useEffect(() => {
    const cursorInterval = setInterval(() => {
      setShowCursor((prev) => !prev);
    }, 530);
    return () => clearInterval(cursorInterval);
  }, []);

  // Initial delay
  useEffect(() => {
    const timer = setTimeout(() => {
      setPhase("typing-title");
    }, startDelay);
    return () => clearTimeout(timer);
  }, [startDelay]);

  // Animation logic
  useEffect(() => {
    let timeout: NodeJS.Timeout;

    if (phase === "typing-title") {
      if (displayedTitle.length < titleText.length) {
        const delay = getTypingDelay(displayedTitle.length, titleText);
        timeout = setTimeout(() => {
          setDisplayedTitle(titleText.slice(0, displayedTitle.length + 1));
        }, delay);
      } else {
        timeout = setTimeout(() => {
          setPhase("show-ghost");
        }, 500);
      }
    } else if (phase === "show-ghost") {
      setShowGhost(true);
      timeout = setTimeout(() => {
        setPhase("complete");
      }, 800);
    } else if (phase === "complete") {
      setIsCompleted(true);
      onComplete?.();
      timeout = setTimeout(() => {
        setPhase("pause");
      }, 3000); // Pause for 3 seconds
    } else if (phase === "pause") {
      timeout = setTimeout(() => {
        setPhase("reset");
      }, 100);
    } else if (phase === "reset") {
      // Reset all state
      setDisplayedTitle("");
      setShowGhost(false);
      setIsCompleted(false);
      timeout = setTimeout(() => {
        setPhase("typing-title");
      }, 500);
    }

    return () => clearTimeout(timeout);
  }, [phase, displayedTitle, onComplete]);

  // Split "Litewrite" from the following text
  const liteWriteText = "Litewrite";
  const restText = " is Here to";
  const displayedLitewrite = displayedTitle.slice(0, Math.min(displayedTitle.length, liteWriteText.length));
  const displayedRest = displayedTitle.length > liteWriteText.length
    ? displayedTitle.slice(liteWriteText.length)
    : "";

  return (
    <div className={cn("text-center", className)}>
      {/* Line 1: "Litewrite is Here to" - use relative positioning for typewriter effect */}
      <div className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl leading-tight relative">
        {/* Invisible placeholder to keep width stable */}
        <span className="invisible" aria-hidden="true">
          <span className="font-extrabold">{liteWriteText}</span>
          <span className="font-bold">{restText}</span>
        </span>

        {/* Actual typed text, absolutely positioned over the placeholder */}
        <span className="absolute inset-0">
          <span className="font-extrabold bg-gradient-to-r from-[#55b3ca] to-[#6dcce0] bg-clip-text text-transparent">
            {displayedLitewrite}
          </span>
          <span className="font-bold text-foreground">{displayedRest}</span>
          {phase === "typing-title" && (
            <span
              className={cn(
                "inline-block w-[3px] h-[1em] bg-foreground ml-0.5 align-middle",
                showCursor ? "opacity-100" : "opacity-0"
              )}
            />
          )}
        </span>
      </div>

      {/* Line 2: "Write with You!" - always occupies space */}
      <div className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold mt-1 leading-tight relative">
        {/* Invisible placeholder */}
        <span className="invisible" aria-hidden="true">{ghostText}</span>

        {/* Actual displayed text */}
        <span
          className={cn(
            "absolute inset-0 transition-all duration-300",
            !showGhost && !isCompleted && "opacity-0",
            showGhost && !isCompleted && "opacity-100",
            isCompleted && "opacity-100"
          )}
        >
          <span
            className={cn(
              isCompleted
                ? "bg-gradient-to-r from-[#6dcce0] via-[#84e0d4] to-[#fed398] bg-clip-text text-transparent"
                : "text-muted-foreground/40"
            )}
          >
            {ghostText}
          </span>
          {(phase === "show-ghost" || phase === "complete") && !isCompleted && (
            <span
              className={cn(
                "inline-block w-[3px] h-[1em] bg-muted-foreground/40 ml-0.5 align-middle",
                showCursor ? "opacity-100" : "opacity-0"
              )}
            />
          )}
        </span>
      </div>
    </div>
  );
}

export default LatexTypewriter;
