"use client";

import { Github, Twitter, Linkedin } from "lucide-react";

const team = [
  {
    name: "Alex Johnson",
    role: "Founder & CEO",
    bio: "Passionate about creating tools that empower writers.",
    initials: "AJ",
    gradient: "from-litewrite-cyan to-litewrite-teal",
  },
  {
    name: "Sarah Chen",
    role: "CTO",
    bio: "Building the future of collaborative editing.",
    initials: "SC",
    gradient: "from-litewrite-blue to-litewrite-cyan",
  },
  {
    name: "Mike Wilson",
    role: "Head of Design",
    bio: "Crafting beautiful and intuitive user experiences.",
    initials: "MW",
    gradient: "from-litewrite-warm to-litewrite-warm-light",
  },
  {
    name: "Emily Davis",
    role: "Product Manager",
    bio: "Ensuring we build what users truly need.",
    initials: "ED",
    gradient: "from-litewrite-teal to-litewrite-mint",
  },
];

export function Team() {
  return (
    <section id="team" className="relative py-32 overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-to-b from-background via-muted/20 to-background" />
      </div>

      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        {/* Header */}
        <div className="mx-auto max-w-2xl text-center mb-20">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-litewrite-cyan-dark dark:text-litewrite-cyan mb-4">
            Our Team
          </h2>
          <p className="text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
            Meet the people behind Litewrite
          </p>
          <p className="mt-6 text-lg text-muted-foreground leading-relaxed">
            We are a group of passionate individuals dedicated to improving the writing experience for everyone.
          </p>
        </div>

        {/* Team Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {team.map((member, index) => (
            <div
              key={index}
              className="group relative flex flex-col items-center text-center p-8 rounded-3xl bg-card border border-border/50 hover:border-border hover:shadow-xl transition-all duration-300"
            >
              {/* Avatar */}
              <div className={`relative h-24 w-24 rounded-full bg-gradient-to-br ${member.gradient} p-[3px] mb-6`}>
                <div className="h-full w-full rounded-full bg-card flex items-center justify-center">
                  <span className={`text-2xl font-bold bg-gradient-to-br ${member.gradient} bg-clip-text text-transparent`}>
                    {member.initials}
                  </span>
                </div>
              </div>

              {/* Info */}
              <h3 className="text-lg font-semibold">{member.name}</h3>
              <p className={`text-sm font-medium bg-gradient-to-r ${member.gradient} bg-clip-text text-transparent mb-3`}>
                {member.role}
              </p>
              <p className="text-sm text-muted-foreground mb-6">{member.bio}</p>

              {/* Social Links */}
              <div className="flex gap-4 mt-auto">
                <a href="#" className="p-2 rounded-full bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors">
                  <Github className="h-4 w-4" />
                </a>
                <a href="#" className="p-2 rounded-full bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors">
                  <Twitter className="h-4 w-4" />
                </a>
                <a href="#" className="p-2 rounded-full bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors">
                  <Linkedin className="h-4 w-4" />
                </a>
              </div>

              {/* Hover effect */}
              <div className={`absolute inset-0 rounded-3xl bg-gradient-to-br ${member.gradient} opacity-0 group-hover:opacity-5 transition-opacity duration-300`} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
