<p align="center">
  <img src="public/logo.svg" alt="Litewrite Logo" width="120" />
</p>

<h1 align="center">Vibe Writing is Coming - Write Faster and Better!</h1>

<p align="center">
  <strong>Litewrite: Your Personal Writing Assistant</strong><br>
</p>

<p align="center">
  <a href="https://github.com/hkuds/litewrite"><img src="https://img.shields.io/badge/version-1.0.7-blue.svg" alt="Version" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="License" /></a>
  <a href="https://github.com/hkuds/litewrite/actions"><img src="https://img.shields.io/github/actions/workflow/status/hkuds/litewrite/ci.yaml?branch=main&label=CI" alt="CI" /></a>
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Next.js-14-black?logo=next.js" alt="Next.js" />
  <img src="https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white" alt="Docker" />
</p>

<p align="center">
  <a href="https://discord.gg/M88Y27DDEe"><img src="https://img.shields.io/badge/💬Discord-Community-7289da?style=for-the-badge&logo=discord&logoColor=white&labelColor=1a1a2e"></a>
  <a href="https://github.com/HKUDS/Litewrite/issues/4"><img src="https://img.shields.io/badge/💬WeChat-Group-07c160?style=for-the-badge&logo=wechat&logoColor=white&labelColor=1a1a2e"></a>
</p>

<p align="center">
  <a href="https://litewrite.ai"><img src="https://img.shields.io/badge/🌐_Live_Demo-litewrite.ai-ff6b6b?style=for-the-badge" alt="Demo" /></a>
</p>

<p align="center">
  <a href="#-features">Features</a> •
  <a href="#-screenshots">Screenshots</a> •
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-tech-stack">Tech Stack</a> •
  <a href="#-contributing">Contributing</a>
</p>

---

## ✨ Key Features of Litewrite

🚀 **TAP Smart Completion**: Type a few words, AI continues writing for you. Just hit Tab and you're all set!
💬 **ASK Mode**: Summon your AI assistant anytime. Grammar issues? Format problems? Just ask!
🤖 **Agent Mode**: The ultimate hands-off experience! AI automatically edits, polishes, formats, or lets the Agent take creative control
🔍 **Deep Research**: AI conducts in-depth research + auto-generates reports. Research while you write! 👨‍🏫

### 📝 Editor Experience

| Feature | Description |
|---------|-------------|
| **LaTeX Editor** | Built on CodeMirror 6 with syntax highlighting, smart completion, bracket matching, and folding |
| **Markdown Editor** | Full GFM support with code highlighting, math rendering (KaTeX), and live preview |
| **Visual Editing** | Typora-like WYSIWYG: renders content while editing, shows source at cursor position |
| **Multi-file Projects** | Organize large documents with `\input{}`, `\include{}`, and proper file tree management |

### 🤖 AI-Powered Writing

| Feature | Description |
|---------|-------------|
| **TAP Completion** | Ghost-text AI completion as you type (Cursor/Copilot-like experience) |
| **Ask AI** | Select text and ask AI to explain, improve, translate, or rewrite |
| **Deep Research** | Multi-iteration research: web search → outline planning → streamed report generation |
| **Smart Templates** | AI-assisted document generation from simple prompts |

### 👥 Collaboration & Sharing

| Feature | Description |
|---------|-------------|
| **Real-time Collaboration** | Multiple users editing simultaneously with cursor presence indicators |
| **Version History** | Create snapshots, compare diffs, and restore any previous version |
| **Sharing** | Share projects via link with granular view/edit permissions |
| **Comments** | (Coming soon) Inline comments and review workflow |

### 📄 Compilation & Preview

| Feature | Description |
|---------|-------------|
| **Multiple Engines** | pdfLaTeX, XeLaTeX, LuaLaTeX with full TeXLive distribution |
| **Live Preview** | Auto-compile on save with instant PDF preview |
| **SyncTeX** | Bi-directional navigation: click PDF → jump to source, click source → highlight PDF |
| **Export Options** | Download PDF, source ZIP, or individual files |

---

## 📸 Screenshots

<details>
<summary><b>Click to expand screenshots</b></summary>

<br>

#### 🏠 Landing Page
<p align="center">
  <img src="public/screenshots/landing.png" alt="Landing Page" width="800" />
</p>
<p align="center"><em>AI-integrated vibe writing — lite, fast, effortless</em></p>

#### 📚 Template Gallery
<p align="center">
  <img src="public/screenshots/templates.png" alt="Template Gallery" width="800" />
</p>
<p align="center"><em>10+ pre-built templates: NeurIPS, ACM, Beamer, CV, Thesis, and more</em></p>

#### 🔣 Symbol Panel
<p align="center">
  <img src="public/screenshots/symbols.png" alt="Symbol Panel" width="500" />
</p>
<p align="center"><em>Quick insert Greek letters, math operators, and LaTeX constructs</em></p>

#### 📖 Reference Search
<p align="center">
  <img src="public/screenshots/references.png" alt="Reference Search" width="600" />
</p>
<p align="center"><em>Search and insert BibTeX citations with fuzzy matching</em></p>

#### 📜 Version History
<p align="center">
  <img src="public/screenshots/history.png" alt="Version History" width="800" />
</p>
<p align="center"><em>Create snapshots, compare diffs, and restore any previous version</em></p>

#### 🔗 Project Sharing
<p align="center">
  <img src="public/screenshots/share.png" alt="Share Project" width="400" />
</p>
<p align="center"><em>Share via link or invite collaborators by email</em></p>

</details>

> 💡 **Try it yourself:** Visit [litewrite.ai](https://litewrite.ai) for the live demo!

---

## 🚀 Quick Start

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (includes Docker Compose)
- 8GB+ RAM recommended (TeXLive image is ~5GB)

### Development Setup

```bash
# Clone the repository
git clone https://github.com/hkuds/litewrite.git
cd litewrite

# Start with one command
./scripts/up-dev.sh
```

This will:
1. Create `.env` from `env.example.oss` if missing
2. Pull/build all Docker images
3. Start the full stack (web, ws, ai-server, compile, minio, redis)

### Access Points

| Service | URL | Description |
|---------|-----|-------------|
| 🌐 **App** | http://localhost:3000 | Main application |
| 📦 **MinIO** | http://localhost:9001 | Object storage console (`minioadmin`/`minioadmin`) |
| 🤖 **AI Server** | http://localhost:6612/health | AI services health check |
| 🔧 **Compile** | http://localhost:3002/health | LaTeX compile service |

### Production Deployment

```bash
# With custom env files
./scripts/up-prod.sh --env-file .env.production --env-file .env.secrets
```

<details>
<summary><b>Required Environment Variables</b></summary>

| Variable | Description |
|----------|-------------|
| `NEXTAUTH_SECRET` | Random string for session encryption |
| `INTERNAL_API_SECRET` | Internal service authentication |
| `DATABASE_URL` | PostgreSQL connection string |
| `S3_BUCKET` | S3 bucket name |
| `S3_REGION` | S3 region |
| `S3_ACCESS_KEY_ID` | S3 access key (for MinIO or static credentials) |
| `S3_SECRET_ACCESS_KEY` | S3 secret key |
| `OPENROUTER_API_KEY` | AI service API key |

See `env.example.oss` for the complete configuration reference.

</details>

---



## 🛠 Tech Stack

<table>
<tr>
<td width="50%">

### Frontend
- **Framework:** Next.js 14 (App Router)
- **Language:** TypeScript 5
- **Editor:** CodeMirror 6 + y-codemirror.next
- **UI:** Tailwind CSS + Shadcn UI
- **Icons:** Lucide React

</td>
<td width="50%">

### Backend
- **API:** Next.js API Routes
- **ORM:** Prisma
- **Auth:** NextAuth.js 5
- **Collaboration:** Yjs + y-websocket

</td>
</tr>
<tr>
<td>

### Infrastructure
- **Database:** SQLite (via Prisma)
- **Cache:** Redis
- **Storage:** S3-compatible (MinIO/AWS)
- **Container:** Docker + Docker Compose

</td>
<td>

### AI & Compile
- **AI Server:** Python FastAPI
- **LLM:** OpenRouter (multi-model)
- **LaTeX:** TeXLive (full distribution)
- **Engines:** pdfLaTeX, XeLaTeX, LuaLaTeX

</td>
</tr>
</table>

---

## 🏗 Architecture

<p align="center">
  <img src="public/Architecture.png" alt="Litewrite Architecture" width="800" />
</p>

---

## 📁 Project Structure

```
litewrite/
├── app/                      # Next.js App Router pages & API routes
│   ├── api/                  # API endpoints
│   ├── editor/               # Editor page
│   └── (home)/               # Dashboard pages
├── components/               # React components
│   ├── editor/               # Editor-specific components
│   ├── pdf-viewer/           # PDF preview components
│   └── ui/                   # Shadcn UI components
├── lib/                      # Shared utilities
├── server/                   # WebSocket server (Yjs collaboration)
├── prisma/                   # Database schema & migrations
│
├── ai-server/                # AI service (Python FastAPI)
│   ├── api/                  # API endpoints
│   ├── services/             # TAP, Ask, Deep Research
│   └── core/                 # Core modules
│
├── compile-server/           # LaTeX compile service
│
├── docker-compose.yml        # Development configuration
├── docker-compose.prod.yml   # Production configuration
└── scripts/                  # Helper scripts
```

---

## 🔧 Development

### Common Commands

```bash
# Start development environment
docker compose up

# Start in background
docker compose up -d

# View logs
docker compose logs -f web
docker compose logs -f ai-server

# Rebuild specific service
docker compose up --build web

# Reset database
docker compose exec web npx prisma migrate reset

# Run TypeScript check
npm run typecheck

# Run linting
npm run lint
```

### Hot Reload

| Directory | Service | Auto-reload |
|-----------|---------|-------------|
| `app/`, `components/`, `lib/` | Next.js | ✅ |
| `server/` | WebSocket | ✅ |
| `ai-server/` | AI Server | ✅ |
| `compile-server/` | Compile | ❌ (rebuild needed) |

---

## ⚙️ Environment Variables

<details>
<summary><b>Click to expand full list</b></summary>

### Required

| Variable | Description |
|----------|-------------|
| `NEXTAUTH_SECRET` | NextAuth encryption secret |
| `OPENROUTER_API_KEY` | AI service API key |

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | Database connection | `file:./dev.db` |
| `LLM_MODEL` | LLM model | `openai/gpt-4o-mini` |
| `EMBEDDING_MODEL` | Embedding model | `text-embedding-3-small` |
| `EMBEDDING_API_KEY` | Embedding API key | - |
| `SERPER_API_KEY` | Web search API | - |
| `REDIS_URL` | Redis connection | - |
| `S3_BUCKET` | S3 bucket name | `litewrite` |
| `S3_REGION` | S3 region | `us-east-1` |

> See `env.example.oss` for the complete reference.

</details>

---



## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](./CONTRIBUTING.md) for details.

```bash
# Quick contribution workflow
git clone https://github.com/hkuds/litewrite.git
cd litewrite
git checkout -b feature/your-feature
# Make your changes
git commit -m "feat: add amazing feature"
git push origin feature/your-feature
# Open a Pull Request
```

---

## 🙏 Acknowledgments

Litewrite is built on the shoulders of giants:

- [Next.js](https://nextjs.org/) - React framework
- [CodeMirror](https://codemirror.net/) - Code editor
- [Yjs](https://yjs.dev/) - CRDT for collaboration
- [Prisma](https://www.prisma.io/) - Database ORM
- [TeXLive](https://tug.org/texlive/) - TeX distribution
- [Shadcn UI](https://ui.shadcn.com/) - UI components

---

## 📄 License

This project is licensed under **AGPL-3.0-only**. See [`LICENSE`](./LICENSE) for details.

**TL;DR:** You can use, modify, and distribute this software, but if you run a modified version as a service, you must release your source code.

---

<p align="center">
  <sub>Made with ❤️ by the Litewrite Team</sub>
</p>

<p align="center">
  <a href="https://github.com/hkuds/litewrite/stargazers">⭐ Star us on GitHub!</a>
</p>
