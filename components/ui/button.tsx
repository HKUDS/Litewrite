import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // Base style: iOS-like spring transitions and pressed feedback
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-all duration-200 ease-spring-gentle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.97] active:brightness-[0.97]",
  {
    variants: {
      variant: {
        // Default button: shadow depth changes, no translation
        default:
          "bg-primary text-primary-foreground shadow-btn hover:bg-primary/95 hover:shadow-btn-hover active:shadow-btn-active",
        // Destructive button
        destructive:
          "bg-destructive text-destructive-foreground shadow-btn hover:bg-destructive/95 hover:shadow-btn-hover active:shadow-btn-active",
        // Outline button: subtle border transition
        outline:
          "border border-input bg-background shadow-btn hover:bg-accent/50 hover:text-accent-foreground hover:border-primary/40 hover:shadow-btn-hover active:shadow-btn-active",
        // Secondary button
        secondary:
          "bg-secondary text-secondary-foreground shadow-btn hover:bg-secondary/80 hover:shadow-btn-hover active:shadow-btn-active",
        // Ghost button: background-only transition
        ghost:
          "hover:bg-accent/80 hover:text-accent-foreground active:bg-accent",
        // Link button
        link:
          "text-primary underline-offset-4 hover:underline active:opacity-70",
        // Litewrite brand button: soft cyan gradient (matches logo style)
        gradient:
          "bg-gradient-to-r from-[#7dd3d8] to-[#4ab0be] text-white border-0 shadow-[0_4px_14px_rgba(100,200,210,0.3)] hover:from-[#6cc8cd] hover:to-[#3da3b1] hover:shadow-[0_6px_20px_rgba(100,200,210,0.4)] active:shadow-[0_2px_8px_rgba(100,200,210,0.2)] dark:from-[#5ec8ce] dark:to-[#3a9ca8] dark:shadow-[0_4px_14px_rgba(94,200,206,0.25)] dark:hover:from-[#4ecdc4] dark:hover:to-[#2d8f9a] dark:hover:shadow-[0_6px_20px_rgba(94,200,206,0.35)]",
        // Warm gradient button
        "gradient-warm":
          "bg-gradient-to-r from-litewrite-warm to-litewrite-warm-light text-white border-0 shadow-elevation-2 hover:brightness-105 hover:shadow-elevation-3 active:shadow-elevation-1",
        // AI-only gradient button
        "gradient-ai":
          "bg-gradient-to-r from-ai-purple via-ai-indigo to-ai-blue text-white border-0 shadow-elevation-2 hover:brightness-105 hover:shadow-elevation-3 active:shadow-elevation-1",
        // Glass button
        glass:
          "bg-[var(--glass-bg)] backdrop-blur-md border border-[var(--glass-border)] shadow-elevation-1 hover:bg-[var(--glass-hover)] hover:shadow-elevation-2 hover:border-[var(--glass-border)] active:shadow-btn-active",
        // Glass primary button
        "glass-primary":
          "bg-primary/80 backdrop-blur-md text-primary-foreground border border-primary/20 shadow-elevation-1 hover:bg-primary/85 hover:shadow-elevation-2 active:shadow-btn-active",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        xl: "h-14 rounded-lg px-10 text-base",
        icon: "h-10 w-10",
        "icon-sm": "h-8 w-8",
        "icon-lg": "h-12 w-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
