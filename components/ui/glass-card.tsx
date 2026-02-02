import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const glassCardVariants = cva(
  "rounded-xl backdrop-blur-md transition-all duration-300",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--glass-bg)] border border-[var(--glass-border)] shadow-glass",
        light:
          "bg-[var(--glass-bg-light)] border border-[var(--glass-border)]",
        heavy:
          "bg-[var(--glass-bg-heavy)] border border-[var(--glass-border)] shadow-glass-lg",
        gradient:
          "bg-[var(--glass-bg)] border border-transparent relative before:absolute before:inset-0 before:rounded-xl before:p-[1px] before:bg-gradient-primary before:-z-10 before:opacity-50",
        outline:
          "bg-transparent border border-[var(--glass-border)] hover:bg-[var(--glass-bg-light)]",
      },
      hover: {
        none: "",
        lift: "hover:-translate-y-1 hover:shadow-glass-lg",
        glow: "hover:shadow-glow hover:border-primary/30",
        scale: "hover:scale-[1.02]",
        "lift-glow":
          "hover:-translate-y-1 hover:shadow-glow hover:border-primary/30",
      },
      padding: {
        none: "",
        sm: "p-4",
        default: "p-6",
        lg: "p-8",
      },
    },
    defaultVariants: {
      variant: "default",
      hover: "none",
      padding: "default",
    },
  }
);

export interface GlassCardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof glassCardVariants> {
  asChild?: boolean;
}

const GlassCard = React.forwardRef<HTMLDivElement, GlassCardProps>(
  ({ className, variant, hover, padding, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(glassCardVariants({ variant, hover, padding, className }))}
        {...props}
      >
        {children}
      </div>
    );
  }
);
GlassCard.displayName = "GlassCard";

// Glass card header
const GlassCardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5", className)}
    {...props}
  />
));
GlassCardHeader.displayName = "GlassCardHeader";

// Glass card title
const GlassCardTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn(
      "text-xl font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
));
GlassCardTitle.displayName = "GlassCardTitle";

// Glass card description
const GlassCardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
GlassCardDescription.displayName = "GlassCardDescription";

// Glass card content
const GlassCardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("pt-0", className)} {...props} />
));
GlassCardContent.displayName = "GlassCardContent";

// Glass card footer
const GlassCardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center pt-4", className)}
    {...props}
  />
));
GlassCardFooter.displayName = "GlassCardFooter";

export {
  GlassCard,
  GlassCardHeader,
  GlassCardTitle,
  GlassCardDescription,
  GlassCardContent,
  GlassCardFooter,
  glassCardVariants,
};
