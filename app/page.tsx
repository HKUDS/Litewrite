"use client";

import { Navbar } from "@/components/landing/navbar";
import { Hero } from "@/components/landing/hero";
import { EditorShowcase } from "@/components/landing/editor-showcase";
import { AIShowcase } from "@/components/landing/ai-showcase";
import { OtherFeatures } from "@/components/landing/other-features";
import { Footer } from "@/components/landing/footer";

export default function LandingPage() {
  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Global background layer - smooth transitions */}
      <div className="absolute inset-0 -z-10">
        {/* Base gradient + grid background */}
        <div className="absolute inset-0 bg-gradient-mesh" />
        <div className="absolute inset-0 bg-grid opacity-50" />

        {/* Cyan blobs - Hero section */}
        <div className="absolute top-[5%] right-[20%] w-[500px] h-[500px] bg-litewrite-cyan/10 rounded-full blur-[150px]" />
        <div className="absolute top-[10%] left-[15%] w-[400px] h-[400px] bg-litewrite-teal/10 rounded-full blur-[150px]" />

        {/* Teal/cyan blobs - Editor Showcase section */}
        <div className="absolute top-[25%] left-[10%] w-[600px] h-[600px] bg-litewrite-teal/8 rounded-full blur-[200px]" />
        <div className="absolute top-[30%] right-[15%] w-[500px] h-[500px] bg-litewrite-cyan/6 rounded-full blur-[180px]" />

        {/* Transition blobs - middle section (Editor → AI) */}
        <div className="absolute top-[45%] left-[30%] w-[600px] h-[600px] bg-litewrite-teal/6 rounded-full blur-[200px]" />
        <div className="absolute top-[50%] right-[25%] w-[500px] h-[500px] bg-ai-purple/6 rounded-full blur-[200px]" />

        {/* Purple blobs - AI Showcase section */}
        <div className="absolute top-[60%] left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-ai-purple/8 rounded-full blur-[180px]" />
        <div className="absolute top-[65%] right-[20%] w-[400px] h-[400px] bg-ai-indigo/6 rounded-full blur-[150px]" />

        {/* Teal/cyan blobs - Other Features section */}
        <div className="absolute top-[80%] left-[20%] w-[600px] h-[600px] bg-litewrite-teal/6 rounded-full blur-[200px]" />
        <div className="absolute top-[85%] right-[30%] w-[500px] h-[500px] bg-litewrite-cyan/5 rounded-full blur-[180px]" />

        {/* Bottom fade */}
        <div className="absolute top-[95%] left-1/2 -translate-x-1/2 w-[1000px] h-[400px] bg-litewrite-teal/4 rounded-full blur-[200px]" />
      </div>
      <Navbar />
      <main>
        <Hero />
        <EditorShowcase />
        <AIShowcase />
        <OtherFeatures />
      </main>
      <Footer />
    </div>
  );
}
