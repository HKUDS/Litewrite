# Contributing to Litewrite

Thanks for your interest in contributing to Litewrite! 🎉

This project is designed to be **self-hosted** and **OSS-friendly**:
- No secrets in the repo
- Optional integrations degrade gracefully
- Docker-first development workflow

## Table of Contents

- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Code Style](#code-style)
- [Commit Guidelines](#commit-guidelines)
- [Pull Requests](#pull-requests)
- [Issue Guidelines](#issue-guidelines)

## Getting Started

### Prerequisites

- Docker Desktop (or Docker Engine + Compose plugin)
- Node.js 22+ (for local linting/testing)
- Git

### One-Command Dev Startup

```bash
git clone https://github.com/larfii/litewrite.git
cd litewrite
./scripts/up-dev.sh
```

This will:
- Create `.env` from `env.example.oss` if missing
- Start the full stack via `docker compose up`

### Access Points

| Service | URL |
|---------|-----|
| App | http://localhost:3000 |
| MinIO Console | http://localhost:9001 |
| AI Server | http://localhost:6612/health |
| Compile Server | http://localhost:3002/health |

### Common Commands

```bash
# Stop everything
docker compose down

# Rebuild images
docker compose up --build

# Follow logs
docker compose logs -f web
docker compose logs -f ai-server

# Reset database
docker compose exec web npx prisma migrate reset
```

## Development Workflow

### Project Structure

```
litewrite/
├── app/              # Next.js App Router (pages + API routes)
├── components/       # React components
├── lib/              # Shared utilities
├── server/           # WebSocket collaboration server (Yjs)
├── ai-server/        # Python AI service (TAP / Deep Research)
├── compile-server/   # LaTeX compile service
├── prisma/           # Database schema & migrations
└── messages/         # i18n translations (en.json, zh.json)
```

### TypeScript Check

```bash
npx tsc --noEmit
```

### Linting

```bash
npm run lint
```

### Tests

```bash
npm test
```

### Building

```bash
npm run build
```

## Code Style

### TypeScript / JavaScript

- Use TypeScript for all new code
- Follow the existing ESLint configuration (`.eslintrc.json`)
- Use Prettier for formatting
- Prefer functional components with hooks
- Use `async/await` over `.then()` chains

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Components | PascalCase | `ProjectSidebar.tsx` |
| Hooks | camelCase with `use` prefix | `useAutoCompile.ts` |
| Utilities | camelCase | `compilerUtils.ts` |
| Constants | SCREAMING_SNAKE_CASE | `MAX_FILE_SIZE` |
| CSS classes | kebab-case (Tailwind) | `text-gray-500` |

### Python (ai-server)

- Follow PEP 8
- Use type hints
- Use `async def` for async functions

## Commit Guidelines

We follow [Conventional Commits](https://www.conventionalcommits.org/).

### Format

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### Types

| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Formatting, missing semicolons, etc. |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf` | Performance improvement |
| `test` | Adding or updating tests |
| `chore` | Build process, auxiliary tools, libraries |

### Examples

```bash
feat(editor): add TAP completion toggle in settings
fix(compile): handle Unicode filenames correctly
docs(readme): update installation instructions
refactor(auth): simplify session handling logic
```

## Pull Requests

### Before Submitting

- [ ] Code compiles without errors (`npm run build`)
- [ ] Linting passes (`npm run lint`)
- [ ] Tests pass (`npm test`)
- [ ] No unrelated changes included
- [ ] i18n strings updated if UI text changed (`messages/`)

### PR Title

Use the same format as commits:

```
feat(editor): add dark mode support
```

### PR Description

Include:
- **Summary**: What does this PR do?
- **Related Issue**: Closes #123 (if applicable)
- **Test Plan**: How to verify the changes work

### Review Process

1. At least one maintainer approval required
2. CI checks must pass
3. No merge conflicts with `dev` branch

## Issue Guidelines

### Bug Reports

Include:
- **Description**: What happened vs. what you expected
- **Steps to reproduce**: Minimal steps to trigger the bug
- **Environment**: OS, browser, Docker version
- **Logs**: Relevant error messages (redact secrets!)

### Feature Requests

Include:
- **Problem**: What problem does this solve?
- **Proposed solution**: How would you implement it?
- **Alternatives**: Other approaches you considered

## Security & Secrets Policy

**Never** put secrets in:
- Commits
- Issues / pull requests
- Screenshots / logs

If you accidentally committed a secret:
1. **Rotate it immediately**
2. Open a PR to remove it
3. Consider the secret compromised

## Code of Conduct

By participating, you agree to abide by our [Code of Conduct](./CODE_OF_CONDUCT.md).

---

Thank you for contributing! ❤️
