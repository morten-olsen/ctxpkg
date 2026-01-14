# Agent Guidelines

This document provides guidelines for AI agents working on this codebase.

## Documentation Maintenance

> **IMPORTANT**: When making changes to the codebase, always check if documentation needs to be updated. If you discover discrepancies between the code and documentation, fix them.

### Documentation Files

| File | Purpose | Update When |
|------|---------|-------------|
| `README.md` | CLI usage, installation, quick start | Adding/changing CLI commands, config options, features |
| `ARCHITECTURE.md` | Technical design, components, data flow | Adding services, changing structure, modifying data flows |
| `AGENTS.md` | AI agent guidelines (this file) | Discovering new patterns, conventions, or gotchas |

### Documentation Checklist

When completing a task, verify:

- [ ] New CLI commands are documented in README.md
- [ ] New services/components are documented in ARCHITECTURE.md
- [ ] Changed APIs have updated documentation
- [ ] Removed features are removed from docs
- [ ] Examples in docs still work

## Project Conventions

### File Organization

```
src/
├── <domain>/
│   ├── <domain>.ts          # Main implementation
│   ├── <domain>.schemas.ts  # Zod schemas and types
│   └── <domain>.*.ts        # Additional files
```

### CLI Structure

CLI commands are split by domain in `src/cli/`:

- `cli.ts` - Main entry point, mounts subcommand groups
- `cli.utils.ts` - Shared formatting utilities (always use these)
- `cli.<domain>.ts` - Domain-specific commands

**Pattern for new CLI modules:**

```typescript
import type { Command } from 'commander';
import { formatHeader, formatSuccess, withErrorHandling, chalk } from './cli.utils.ts';

const create<Domain>Cli = (command: Command) => {
  command.description('Description of command group');

  command
    .command('subcommand')
    .alias('sc')
    .description('What this does')
    .action(withErrorHandling(async () => {
      // Implementation
    }));
};

export { create<Domain>Cli };
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

  // Optional cleanup
  [destroy] = async () => {
    // cleanup resources
  };
}
```

### Import Order

Imports should be grouped (enforced by eslint):

1. Node.js built-ins
2. External packages
3. Local utilities (`./`)
4. Internal modules (`#root/`)

With blank lines between groups.

### Error Handling in CLI

Always wrap CLI actions with `withErrorHandling()`:

```typescript
.action(withErrorHandling(async (args, options) => {
  // errors are caught and formatted
}))
```

### Formatting Output

Use utilities from `cli.utils.ts`:

```typescript
formatHeader('Section Title');      // Cyan bordered header
formatSuccess('Operation done');    // Green ✔ prefix
formatError('Something failed');    // Red ✖ prefix
formatInfo('Note to user');         // Blue ℹ prefix
formatWarning('Be careful');        // Yellow ⚠ prefix

formatTableHeader([{ name: 'Col', width: 10 }]);
formatTableRow([{ value: 'data', width: 10, color: chalk.cyan }]);
```

### Type Safety

- Use Zod schemas for runtime validation
- Export types derived from schemas: `type Foo = z.infer<typeof fooSchema>`
- Use `// eslint-disable-next-line @typescript-eslint/no-explicit-any` only when necessary (e.g., convict config access)

## Common Tasks

### Adding a New CLI Command

1. Identify which `cli.<domain>.ts` file it belongs to (or create new)
2. Add command with `.command()`, `.alias()`, `.description()`, `.action()`
3. Use `withErrorHandling()` wrapper
4. Update README.md with new command documentation
5. Update ARCHITECTURE.md if adding new domain

### Adding a New Service

1. Create `src/<domain>/<domain>.ts`
2. Implement class with `Services` constructor parameter
3. Add `[destroy]` method if cleanup needed
4. Document in ARCHITECTURE.md

### Adding Agent Tools

1. Create tool file in `src/tools/<category>/`
2. Use `langchain`'s `tool()` with Zod schema
3. Export tools object
4. Add to `createDefaultAgent()` in `src/interact/interact.ts`
5. Document in ARCHITECTURE.md

### Modifying Database Schema

1. Create new migration in `src/database/migrations/`
2. Follow naming: `migrations.NNN-description.ts`
3. Export and register in `migrations.ts`
4. Update ARCHITECTURE.md if adding tables

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

## Code Quality

Before submitting changes:

1. Run `pnpm run test:lint` - fix all errors
2. Run `pnpm run build` - ensure TypeScript compiles
3. Test affected CLI commands manually
4. Update documentation if needed
5. Keep commits focused and well-described
