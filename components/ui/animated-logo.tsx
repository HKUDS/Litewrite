"use client";

import { useEffect, useState, useCallback } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";

interface AnimatedLogoProps {
  className?: string;
  width?: number;
  height?: number;
  duration?: number;
  pauseDuration?: number; // How long to pause after animation ends before looping
  onAnimationComplete?: () => void;
  loop?: boolean;
  autoPlay?: boolean;
}

export function AnimatedLogo({
  className,
  width = 220,
  height = 116,
  duration = 2,
  pauseDuration = 3000, // Default pause: 3 seconds
  onAnimationComplete,
  loop = true,
  autoPlay = true,
}: AnimatedLogoProps) {
  const [animationKey, setAnimationKey] = useState(0);
  const [isAnimating, setIsAnimating] = useState(autoPlay);
  const [clipProgress, setClipProgress] = useState(0);

  useEffect(() => {
    if (!isAnimating) return;

    const startTime = Date.now();
    const durationMs = duration * 1000;

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / durationMs, 1);

      // Use easeInOutCubic easing
      const eased = progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;

      setClipProgress(eased * 100);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        // Animation complete
        onAnimationComplete?.();

        if (loop) {
          setTimeout(() => {
            setClipProgress(0);
            setAnimationKey(prev => prev + 1);
          }, pauseDuration);
        } else {
          setIsAnimating(false);
        }
      }
    };

    requestAnimationFrame(animate);
  }, [isAnimating, duration, pauseDuration, loop, onAnimationComplete, animationKey]);

  return (
    <div
      className={cn("relative inline-block overflow-hidden", className)}
      style={{ width, height }}
      key={animationKey}
    >
      {/* Logo - reveal left-to-right via clip-path */}
      <Image
        src="/logo.svg"
        alt="Litewrite"
        width={width}
        height={height}
        className="block w-full h-full object-contain"
        style={{
          clipPath: `inset(0 ${100 - clipProgress}% 0 0)`,
        }}
        priority
      />
    </div>
  );
}

export function AnimatedLogoStroke(props: Omit<AnimatedLogoProps, "loop">) {
  return <AnimatedLogo {...props} loop={true} />;
}

export default AnimatedLogo;
