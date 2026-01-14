# Agent Guidelines

This document provides guidelines for AI agents working on this codebase.

## Project Focus

**ctxpkg** is a package manager for AI agent context — it helps manage, sync, and distribute reference documentation collections that AI agents can use for context. Think of it as "npm for AI context".

**Core features:**
- Collection package management (local files and remote packages)
- Semantic search over indexed documents
- MCP server integration for AI tools and editors

## Module Documentation

Each module has its own `AGENTS.md` with detailed architecture and patterns:

| Module | Path | Purpose |
|--------|------|---------|
| Backend | `src/backend/AGENTS.md` | JSON-RPC API, request routing, procedures |
| Client | `src/client/AGENTS.md` | Backend client, connection adapters |
| CLI | `src/cli/AGENTS.md` | Command-line interface, formatting |
| Collections | `src/collections/AGENTS.md` | Package management, sync, manifests |
| Daemon | `src/daemon/AGENTS.md` | Background process, Unix socket server |
| Database | `src/database/AGENTS.md` | SQLite, migrations, vector search |
| MCP | `src/mcp/AGENTS.md` | MCP server integration for editors |
| References | `src/references/AGENTS.md` | Document storage, chunking, embeddings |
| Tools | `src/tools/AGENTS.md` | AI agent tools, MCP/LangChain adapters |

**When working on a module, read its `AGENTS.md` first.**

## Documentation Maintenance

> **IMPORTANT**: When making changes to the codebase, always check if documentation needs to be updated.

### Documentation Files

| File | Purpose | Update When |
|------|---------|-------------|
| `README.md` | CLI usage, installation, quick start | Adding/changing CLI commands, config options |
| `ARCHITECTURE.md` | Technical design, components, data flow | Adding services, changing structure |
| `AGENTS.md` | AI agent guidelines (this file) | Discovering new patterns, conventions |
| `src/*/AGENTS.md` | Module-specific guidelines | Changing module architecture |

### Documentation Checklist

When completing a task, verify:

- [ ] New CLI commands are documented in README.md
- [ ] New services/components are documented in ARCHITECTURE.md
- [ ] Module changes reflected in relevant `AGENTS.md`
- [ ] Removed features are removed from docs

## Project Conventions

### File Organization

```
src/
├── <domain>/
│   ├── <domain>.ts          # Main implementation
│   ├── <domain>.schemas.ts  # Zod schemas and types
│   ├── AGENTS.md            # Module documentation
│   └── <domain>.*.ts        # Additional files
```

### Service Pattern

Services use dependency injection via the `Services` container:

```typescript
import type { Services } from '#root/utils/utils.services.ts';
import { destroy } from '#root/utils/utils.services.ts';

class MyService {
  #services: Services;

  constructor(services: Services) {
    this.#services = services;
  }

  [destroy] = async () => { /* cleanup */ };
}
```

### Import Order

Imports should be grouped (enforced by eslint):

1. Node.js built-ins
2. External packages
3. Local utilities (`./`)
4. Internal modules (`#root/`)

### Type Safety

- Use Zod schemas for runtime validation
- Export types derived from schemas: `type Foo = z.infer<typeof fooSchema>`
- Use `// eslint-disable-next-line @typescript-eslint/no-explicit-any` only when necessary

## Common Tasks

| Task | See Module |
|------|------------|
| Add CLI command | `src/cli/AGENTS.md` |
| Add backend procedure | `src/backend/AGENTS.md` |
| Add MCP tool | `src/tools/AGENTS.md`, `src/mcp/AGENTS.md` |
| Add collection source type | `src/collections/AGENTS.md` |
| Add database migration | `src/database/AGENTS.md` |
| Add client adapter | `src/client/AGENTS.md` |

## Testing Changes

```bash
# Lint
pnpm run test:lint

# Unit tests
pnpm run test:unit

# Build (type check)
pnpm run build

# Manual CLI testing
./bin/cli.js <command>
```

## Gotchas

1. **Convict config types**: Use `(config as any).get(key)` for dynamic key access
2. **Service cleanup**: Always call `services.destroy()` in CLI commands (use try/finally)
3. **Async in Commander**: Actions must be async functions, Commander handles promises
4. **sqlite-vec**: Loaded via `pool.afterCreate` hook, vectors stored as JSON strings
5. **ESM**: Project uses ES modules, use `.ts` extensions in imports
6. **Collection IDs**: `file:{hash}` for local, `pkg:{url}` for packages — computed, not user-assigned
7. **Aliases are project-local**: The `name` in `context.json` is an alias, not stored in DB

## Code Quality

Before submitting changes:

1. Run `pnpm run test:lint` - fix all errors
2. Run `pnpm run build` - ensure TypeScript compiles
3. Test affected CLI commands manually
4. Update documentation if needed
5. Keep commits focused and well-described
