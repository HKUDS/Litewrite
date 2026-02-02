"use client";

import { Sparkles, Users, Zap, LayoutTemplate, ShieldCheck, Share2, Brain, FileText, Palette } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { cn } from "@/lib/utils";

const features = [
  {
    icon: Sparkles,
    title: "AI-Powered Writing",
    description: "Intelligent autocomplete with TAP technology. Get context-aware suggestions as you type, just like Cursor for LaTeX.",
    gradient: "from-ai-purple to-ai-blue",
    iconBg: "bg-gradient-to-br from-ai-purple/20 to-ai-blue/20",
    featured: true,
  },
  {
    icon: Brain,
    title: "Deep Research",
    description: "AI-driven research assistant that searches papers, generates outlines, and writes comprehensive reports with citations.",
    gradient: "from-ai-indigo to-ai-purple",
    iconBg: "bg-gradient-to-br from-ai-indigo/20 to-ai-purple/20",
    featured: true,
  },
  {
    icon: Users,
    title: "Real-time Collaboration",
    description: "Write together with your team in real-time. See cursor movements, edits, and collaborate seamlessly.",
    gradient: "from-litewrite-cyan to-litewrite-teal",
    iconBg: "bg-gradient-to-br from-litewrite-cyan/20 to-litewrite-teal/20",
  },
  {
    icon: Zap,
    title: "Lightning Fast Compile",
    description: "Instant PDF preview with XeLaTeX compilation. SyncTeX support for bidirectional jumping between source and PDF.",
    gradient: "from-litewrite-warm to-litewrite-warm-light",
    iconBg: "bg-gradient-to-br from-litewrite-warm/20 to-litewrite-warm-light/20",
  },
  {
    icon: LayoutTemplate,
    title: "Professional Templates",
    description: "Start quickly with IEEE, ACM, NeurIPS, and more professionally designed academic templates.",
    gradient: "from-litewrite-teal to-litewrite-mint",
    iconBg: "bg-gradient-to-br from-litewrite-teal/20 to-litewrite-mint/20",
  },
  {
    icon: Palette,
    title: "AI Draw",
    description: "Create professional diagrams and figures with AI. Describe what you need, and get TikZ or DrawIO output.",
    gradient: "from-litewrite-blue to-litewrite-cyan",
    iconBg: "bg-gradient-to-br from-litewrite-blue/20 to-litewrite-cyan/20",
  },
  {
    icon: FileText,
    title: "Markdown Support",
    description: "Full Markdown editing with Typora-style visual mode. Switch seamlessly between source and rendered view.",
    gradient: "from-litewrite-cyan-dark to-litewrite-blue-dark",
    iconBg: "bg-gradient-to-br from-litewrite-cyan-dark/20 to-litewrite-blue-dark/20",
  },
  {
    icon: ShieldCheck,
    title: "Version History",
    description: "Never lose your work. Create snapshots, compare versions, and restore any previous state of your document.",
    gradient: "from-emerald-500 to-teal-500",
    iconBg: "bg-gradient-to-br from-emerald-500/20 to-teal-500/20",
  },
  {
    icon: Share2,
    title: "Easy Sharing",
    description: "Share your work with a simple link. Control access permissions and collaborate with anyone, anywhere.",
    gradient: "from-litewrite-blue to-litewrite-cyan",
    iconBg: "bg-gradient-to-br from-litewrite-blue/20 to-litewrite-cyan/20",
  },
];

export function Features() {
  return (
    <section id="features" className="relative py-32 overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-to-b from-background via-muted/20 to-background" />
        <div className="absolute inset-0 bg-grid opacity-50" />
      </div>

      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        {/* Title */}
        <div className="mx-auto max-w-2xl text-center mb-20">
          <div className="inline-flex items-center gap-2 px-4 py-2 mb-6 rounded-full bg-[var(--glass-bg)] backdrop-blur-sm border border-[var(--glass-border)]">
            <Zap className="h-4 w-4 text-litewrite-cyan" />
            <span className="text-sm font-medium text-muted-foreground">Features</span>
          </div>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
            Everything you need to
            <span className="block text-gradient mt-1">write better</span>
          </h2>
          <p className="mt-6 text-lg text-muted-foreground leading-relaxed">
            Powerful features wrapped in a minimalist interface. Focus on your content, we handle the rest.
          </p>
        </div>

        {/* Feature grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, index) => (
            <GlassCard
              key={index}
              variant="default"
              hover="lift-glow"
              padding="lg"
              className={cn(
                "group relative",
                feature.featured && "md:col-span-1 lg:col-span-1 ring-1 ring-primary/20"
              )}
            >
              {/* Featured badge */}
              {feature.featured && (
                <div className="absolute -top-3 left-6">
                  <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-gradient-ai text-white shadow-glow-ai">
                    <Sparkles className="h-3 w-3" />
                    AI Feature
                  </span>
                </div>
              )}

              {/* Icon */}
              <div className={cn(
                "inline-flex p-3 rounded-2xl mb-6 transition-transform duration-300 group-hover:scale-110",
                feature.iconBg
              )}>
                <div className={cn(
                  "p-2 rounded-xl bg-gradient-to-br",
                  feature.gradient
                )}>
                  <feature.icon className="h-5 w-5 text-white" />
                </div>
              </div>

              {/* Content */}
              <h3 className="text-xl font-semibold mb-3 group-hover:text-gradient transition-all duration-300">
                {feature.title}
              </h3>
              <p className="text-muted-foreground leading-relaxed">
                {feature.description}
              </p>

              {/* Hover gradient effect */}
              <div className={cn(
                "absolute inset-0 rounded-xl bg-gradient-to-br opacity-0 group-hover:opacity-5 transition-opacity duration-300 pointer-events-none",
                feature.gradient
              )} />
            </GlassCard>
          ))}
        </div>
      </div>
    </section>
  );
}
