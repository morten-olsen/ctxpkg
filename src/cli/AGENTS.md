# CLI — Agent Guidelines

This document describes the CLI module architecture for AI agents working on this codebase.

## Overview

The CLI module provides the `ctxpkg` command-line interface using [Commander.js](https://github.com/tj/commander.js). Commands are organized by domain, with shared utilities for formatting and error handling.

## File Structure

| File | Purpose |
|------|---------|
| `cli.ts` | Main entry point, creates program and mounts subcommand groups |
| `cli.utils.ts` | Shared formatting utilities and error handling |
| `cli.client.ts` | Factory for creating `BackendClient` with auto mode detection |
| `cli.collections.ts` | Collection management commands (`init`, `add`, `sync`, etc.) |
| `cli.documents.ts` | Document commands (`search`, `list-collections`, etc.) |
| `cli.config.ts` | Configuration commands (`set`, `get`, `list`, `edit`) |
| `cli.daemon.ts` | Daemon management commands (`start`, `stop`, `status`) |
| `cli.mcp.ts` | MCP server commands |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     createProgram()                         │
│                         cli.ts                              │
├─────────────────────────────────────────────────────────────┤
│   collections    documents     config    daemon    mcp      │
│   ───────────    ──────────    ──────    ──────    ───      │
│   init           search        set       start     start    │
│   add            list-cols     get       stop               │
│   remove         drop-col      list      status             │
│   list           isearch       edit                         │
│   sync                         reset                        │
│   pack                                                      │
└─────────────────────────────────────────────────────────────┘
                          │
            ┌─────────────┴─────────────┐
            ▼                           ▼
    ┌───────────────┐          ┌───────────────┐
    │  cli.utils.ts │          │ cli.client.ts │
    │  (formatting) │          │ (BackendClient│
    └───────────────┘          │    factory)   │
                               └───────────────┘
```

## Command Structure

Commands follow this pattern:

```
ctxpkg <group> <command> [args] [options]

# Examples:
ctxpkg collections add my-docs ./docs
ctxpkg documents search "how to authenticate"
ctxpkg config set openai.apiKey sk-...
ctxpkg daemon status
```

## Adding a New Command

### 1. Add to Existing Domain

Add command in the appropriate `cli.<domain>.ts`:

```typescript
command
  .command('my-command')
  .alias('mc')                              // Optional short alias
  .argument('<required>', 'Description')
  .argument('[optional]', 'Description')
  .description('What this command does')
  .option('-f, --flag', 'Boolean flag')
  .option('-v, --value <val>', 'With value', 'default')
  .action(
    withErrorHandling(async (required, optional, options) => {
      // Implementation
      formatSuccess('Done!');
    }),
  );
```

### 2. Add a New Domain

1. Create `cli.<domain>.ts`:

```typescript
import type { Command } from 'commander';
import { formatHeader, formatSuccess, withErrorHandling, chalk } from './cli.utils.ts';

const create<Domain>Cli = (command: Command) => {
  command.description('Description of command group');

  command
    .command('subcommand')
    .description('What this does')
    .action(withErrorHandling(async () => {
      // Implementation
    }));
};

export { create<Domain>Cli };
```

2. Mount in `cli.ts`:

```typescript
import { create<Domain>Cli } from './cli.<domain>.ts';

// In createProgram():
create<Domain>Cli(program.command('<domain>').description('...'));
```

## Key Patterns

### Error Handling

Always wrap actions with `withErrorHandling()`:

```typescript
.action(
  withErrorHandling(async (args, options) => {
    // Errors are caught and formatted with formatError()
    // process.exitCode is set to 1 on error
  }),
)
```

### Formatting Output

Use utilities from `cli.utils.ts` for consistent output:

```typescript
formatHeader('Section Title');     // Cyan bordered header
formatSuccess('Done!');            // Green ✔ prefix
formatError('Failed');             // Red ✖ prefix
formatInfo('Note');                // Blue ℹ prefix
formatWarning('Careful');          // Yellow ⚠ prefix

// Tables
formatTableHeader([
  { name: 'Name', width: 20 },
  { name: 'Value', width: 30 },
]);
formatTableRow([
  { value: 'foo', width: 20, color: chalk.cyan },
  { value: 'bar', width: 30 },
]);
```

### Backend Client

Use `createCliClient()` from `cli.client.ts`:

```typescript
const client = await createCliClient();
try {
  const results = await client.documents.search({ query: 'foo' });
  // ...
} finally {
  await client.disconnect();
}
```

Auto mode tries daemon first, falls back to direct (in-process).

### Services Cleanup

Always clean up services in `finally` blocks:

```typescript
const services = new Services();
const client = await createCliClient();
try {
  // ...
} finally {
  await client.disconnect();
  await services.destroy();
}
```

### Interactive Prompts

Use `@inquirer/prompts` for interactive input:

```typescript
import { input, confirm, select } from '@inquirer/prompts';

const name = await input({ message: 'Enter name:' });
const confirmed = await confirm({ message: 'Continue?', default: false });
const choice = await select({
  message: 'Pick one:',
  choices: [
    { name: 'Option A', value: 'a' },
    { name: 'Option B', value: 'b' },
  ],
});
```

## Testing Commands

```bash
# Run directly during development
./bin/cli.js collections list
./bin/cli.js documents search "query"
./bin/cli.js config list

# With options
./bin/cli.js collections sync --force
./bin/cli.js documents search "query" --limit 5
```
