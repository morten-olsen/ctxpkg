# Global Collections Support

This spec describes the design for supporting global (user-level) collections in addition to project-local collections.

## Overview

Currently, ctxpkg only supports project-local collections defined in `context.json` in the current working directory. This spec extends the system to support global collections that are available across all projects.

## Motivation

- **Shared reference docs**: Users often want access to common documentation (e.g., language references, framework docs) across multiple projects without configuring each project separately.
- **Personal knowledge base**: Users can maintain a personal collection of notes and references accessible everywhere.
- **Reduced duplication**: Avoid syncing the same collections in every project.

## Design

### Global Configuration File

Global collections will be stored in a user-level config file:

```
~/.config/ctxpkg/global-context.json   (Linux/macOS via env-paths)
```

The structure mirrors the project-local `context.json`:

```json
{
  "collections": {
    "typescript-docs": { "url": "https://example.com/ts-docs/manifest.json" },
    "personal-notes": { "url": "file:///Users/alice/notes/manifest.json" }
  }
}
```

### Configuration Module Changes

Add to `src/config/config.ts`:

```typescript
const config = convict({
  // ... existing config ...
  global: {
    configFile: {
      doc: 'Path to global collections config file',
      format: String,
      default: join(paths.config, 'global-context.json'),
      env: 'CTXPKG_GLOBAL_CONFIG_FILE',
    },
  },
});
```

### CollectionsService Changes

Extend `CollectionsService` to support global collections:

```typescript
class CollectionsService {
  // Existing methods for project config
  projectConfigExists(): boolean;
  readProjectConfig(): ProjectConfig;
  writeProjectConfig(config: ProjectConfig): void;
  
  // New methods for global config
  globalConfigExists(): boolean;
  readGlobalConfig(): ProjectConfig;
  writeGlobalConfig(config: ProjectConfig): void;  // Auto-creates file if needed
  
  // Updated methods with global parameter
  addToConfig(name: string, spec: CollectionSpec, global?: boolean): void;
  removeFromConfig(name: string, global?: boolean): void;
  getFromConfig(name: string, global?: boolean): CollectionSpec | undefined;
  
  // Helper to get all collections (local + global)
  getAllCollections(): Map<string, { spec: CollectionSpec; global: boolean }>;
}
```

## CLI Changes

### `collections` Command Group

Add `-g, --global` flag to collection management commands:

#### `collections init`

No changes — `init` is only for project-local config. Global config is auto-created on first `collections add -g`.

#### `collections add`

```bash
# Existing: add to project config
ctxpkg collections add my-docs ./docs

# New: add to global config
ctxpkg collections add -g typescript-docs https://example.com/ts-docs/manifest.json
```

#### `collections remove`

```bash
# Existing: remove from project config
ctxpkg collections remove my-docs

# New: remove from global config
ctxpkg collections remove -g typescript-docs
```

#### `collections list`

```bash
# Default: list both local and global (with source indicator)
ctxpkg collections list

# List global collections only
ctxpkg collections list -g

# List local collections only
ctxpkg collections list --no-global
```

Output format:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Collections                                                         │
├─────────────────────────────────────────────────────────────────────┤
│  Name              URL                              Source    Status │
│  ────────────────  ─────────────────────────────    ────────  ────── │
│  my-docs           file://./docs                    local     ✓      │
│  typescript-docs   https://example.com/ts-docs/...  global    ✓      │
│  personal-notes    file:///Users/alice/notes/...    global    ⚠      │
└─────────────────────────────────────────────────────────────────────┘
```

#### `collections sync`

```bash
# Default: sync both local and global collections
ctxpkg collections sync

# Sync a specific collection (resolved from local first, then global)
ctxpkg collections sync my-docs

# Sync global collections only
ctxpkg collections sync -g

# Sync a specific global collection
ctxpkg collections sync -g typescript-docs

# Sync local collections only
ctxpkg collections sync --no-global
```

### `documents` Command Group

Add `--no-global` flag to search commands:

#### `documents search`

```bash
# Default: search in local + global collections
ctxpkg documents search "how to authenticate"

# Exclude global collections
ctxpkg documents search "how to authenticate" --no-global

# Specific collections (can mix local and global aliases)
ctxpkg documents search "query" -c my-docs -c typescript-docs
```

**Default behavior when no `-c` option:**
1. If `context.json` exists in cwd: search local + global collections
2. If no `context.json` exists: search global collections only
3. If neither exists: error with helpful message

#### `documents interactive-search`

Update collection picker to show both local and global collections, with source indicators:

```
? Search in:
❯ All collections
  my-docs (local, 42 docs)
  typescript-docs (global, 156 docs)
  personal-notes (global, 23 docs)
```

#### `documents list-collections`

This command lists collections from the database (already synced). No changes needed — it shows all synced collections regardless of where they were configured.

### MCP Server

The MCP server start command gets a `--no-global` flag:

```bash
# Default: MCP tools search local + global collections
ctxpkg mcp start

# Exclude global collections from MCP tool searches
ctxpkg mcp start --no-global
```

This is a server-level setting, not a per-tool parameter. When `--no-global` is passed, the MCP server operates in local-only mode for all searches.

## Resolution Order and Precedence

When resolving collection names/aliases:

1. **Local first**: If both local and global have the same alias, local wins
2. **Explicit scope**: `-g` flag or collection ID (e.g., `pkg:https://...`) always explicit

Example:
```bash
# Both local and global have "docs" alias
ctxpkg collections sync docs        # Syncs local "docs"
ctxpkg collections sync -g docs     # Syncs global "docs"
```

## Implementation Plan

### Phase 1: Core Infrastructure

1. Add `global.configFile` to config schema
2. Extend `CollectionsService`:
   - Add `globalConfigExists()`, `readGlobalConfig()`, `writeGlobalConfig()`
   - Auto-create global config on first write (no explicit init needed)
   - Refactor `addToProjectConfig` → `addToConfig(name, spec, { global })`
   - Add `getAllCollections()` helper

### Phase 2: CLI Collections Commands

1. Add `-g, --global` option to:
   - `collections add` (auto-creates global config if needed)
   - `collections remove`
2. Update `collections list`:
   - Add `-g, --global` flag (show only global)
   - Add `--no-global` flag (show only local)
   - Default: show local + global combined with source column
3. Update `collections sync`:
   - Add `-g, --global` flag (sync only global)
   - Add `--no-global` flag (sync only local)
   - Default: sync local + global combined

### Phase 3: Search Commands

1. Update `documents search`:
   - Add `--no-global` flag
   - Default collection resolution includes global
2. Update `documents interactive-search`:
   - Show global collections in picker with indicator
3. Update `documents list-collections`:
   - Add source indicator column

### Phase 4: MCP Integration

1. Add `--no-global` flag to `mcp start` command
2. Pass flag to MCP server context, apply to all search operations

## Edge Cases

### No Local Config

When there's no `context.json` in cwd:

- `collections list`: Show global collections only (if any)
- `collections sync`: Sync global collections only (if any)
- `documents search`: Search global collections only (if any exist)

### No Global Config

When global config doesn't exist:

- `collections list -g`: Show message "No global collections configured."
- `collections add -g <name> <url>`: Auto-create global config, then add
- `documents search`: Search local collections only

### No Config At All

When neither local nor global config exists:

- `collections list`: Show message "No collections configured."
- `documents search`: Error with helpful message to add collections

### Name Conflicts

If the same alias exists in both local and global:

- Search resolves to local (local takes precedence)
- `collections list` shows both with different sources
- Explicit `-g` flag required to operate on global version

## Future Considerations

- **Collection groups**: Allow grouping collections (e.g., "python-stack" → [python-docs, django-docs])
- **Collection inheritance**: Global config could define "always include" collections
- **Remote global config**: Sync global config from a URL for team-wide defaults
