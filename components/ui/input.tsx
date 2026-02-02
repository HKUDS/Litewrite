import * as React from "react";

import { cn } from "@/lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // Base styles
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
          // Transition: iOS-like spring
          "transition-all duration-200 ease-spring-gentle",
          // File upload and placeholder
          "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground",
          // Focus state: subtle inset shadow + brand border + soft ring
          "focus-visible:outline-none focus-visible:border-primary/60 focus-visible:ring-[3px] focus-visible:ring-primary/15 focus-visible:shadow-input-inset",
          // Hover state: subtle border change
          "hover:border-input/80",
          // Disabled state
          "disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
