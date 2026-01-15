# CLI Reference

Complete command reference for the ctxpkg command-line interface.

## Command Overview

| Command | Description |
|---------|-------------|
| `ctxpkg collections` | Manage context collections |
| `ctxpkg documents` | Query indexed documents |
| `ctxpkg mcp` | Start MCP servers |
| `ctxpkg config` | Manage configuration |
| `ctxpkg daemon` | Control background daemon |

## Collections Commands

Manage context collections. Collections can be **local** (project-specific, stored in `context.json`) or **global** (user-level, available across all projects).

**Alias:** `col`

### Initialize Project

Create a `context.json` file in the current directory.

```bash
ctxpkg collections init
ctxpkg col init
```

### Add Collection

Add a collection to your project or global config.

```bash
ctxpkg col add <alias> <url>
```

**Arguments:**
- `alias` — Name to reference this collection
- `url` — Path or URL to the manifest

**Options:**
- `-g, --global` — Add to global config instead of project

**Examples:**

```bash
# Local manifest (relative path)
ctxpkg col add project-docs ./docs/manifest.json

# Local manifest (explicit file:// URL)
ctxpkg col add lib file://../shared/manifest.json

# Remote manifest
ctxpkg col add react https://example.com/react-docs/manifest.json

# Remote bundle
ctxpkg col add lodash https://example.com/lodash-docs.tar.gz

# Global collection
ctxpkg col add -g typescript-docs https://example.com/ts-docs/manifest.json
ctxpkg col add -g personal-notes file:///Users/me/notes/manifest.json
```

### List Collections

Show configured collections and their sync status.

```bash
ctxpkg col list [options]
ctxpkg col ls [options]
```

**Options:**
- `-g, --global` — Show only global collections
- `--no-global` — Show only local collections

By default, shows both local and global collections with a source indicator.

### Sync Collections

Index documents from configured collections.

```bash
ctxpkg col sync [alias] [options]
```

**Arguments:**
- `alias` — Optional. Sync only this collection (otherwise syncs all)

**Options:**
- `-g, --global` — Sync only global collections
- `--no-global` — Sync only local collections
- `--force` — Re-index all documents (ignore cache)

**Examples:**

```bash
# Sync all collections
ctxpkg col sync

# Sync specific collection
ctxpkg col sync react

# Sync only global collections
ctxpkg col sync -g

# Force re-index everything
ctxpkg col sync --force
```

### Remove Collection

Remove a collection from configuration.

```bash
ctxpkg col remove <alias> [options]
```

**Options:**
- `-g, --global` — Remove from global config
- `--drop` — Also delete indexed data from database

**Examples:**

```bash
# Remove from project config
ctxpkg col remove react

# Remove from global config
ctxpkg col remove -g typescript-docs

# Remove and delete indexed data
ctxpkg col remove react --drop
```

### Create Manifest

Initialize a new manifest file for publishing.

```bash
ctxpkg col manifest init
```

Creates a `manifest.json` in the current directory.

### Pack Collection

Create a distributable bundle from a manifest.

```bash
ctxpkg col pack [options]
```

**Options:**
- `-o, --output <file>` — Output filename (default: `{name}-{version}.tar.gz`)

**Examples:**

```bash
# Create bundle with default name
ctxpkg col pack

# Specify output filename
ctxpkg col pack --output my-docs-1.0.0.tar.gz
```

## Document Commands

Query and manage indexed documents.

**Alias:** `docs`

### List Collections

Show indexed collections with document counts.

```bash
ctxpkg docs ls
ctxpkg docs list-collections
```

### Search

Search indexed documents using hybrid semantic + keyword matching.

```bash
ctxpkg docs search <query> [options]
```

**Options:**
- `-c, --collections <names...>` — Limit to specific collections
- `-l, --limit <n>` — Max results (default: 10)
- `--max-distance <n>` — Filter threshold 0-2, lower = stricter (default: none)
- `--no-hybrid` — Disable hybrid search (vector-only)
- `--rerank` — Enable re-ranking for higher precision
- `--no-global` — Exclude global collections

**Examples:**

```bash
# Basic search
ctxpkg docs search "authentication flow"

# Search specific collections
ctxpkg docs search "hooks" -c react lodash

# Limit results
ctxpkg docs search "error handling" -l 5

# Filter low-quality matches
ctxpkg docs search "query" --max-distance 0.8

# High precision mode
ctxpkg docs search "query" --rerank
```

### Interactive Search

Open an interactive search prompt.

```bash
ctxpkg docs isearch
ctxpkg docs interactive-search
```

### Drop Collection

Remove a collection's indexed data from the database.

```bash
ctxpkg docs drop <collection> [options]
ctxpkg docs drop-collection <collection> [options]
```

**Options:**
- `-f, --force` — Skip confirmation prompt

## MCP Commands

Start Model Context Protocol servers for AI editor integration.

### Documents Server

Expose document tools via MCP.

```bash
ctxpkg mcp documents [options]
ctxpkg mcp docs [options]
```

**Options:**
- `-c, --collections <names...>` — Limit to specific collections
- `--no-global` — Exclude global collections
- `--name <name>` — Custom server name
- `--version <version>` — Custom server version

**Examples:**

```bash
# Start with all collections
ctxpkg mcp documents

# Limit to specific collections
ctxpkg mcp docs -c project-docs react

# Exclude global collections
ctxpkg mcp docs --no-global
```

See [MCP Server Documentation](./mcp-server.md) for the complete tool reference.

## Config Commands

Manage ctxpkg configuration.

**Alias:** `cfg`

### List Settings

Show all configuration values.

```bash
ctxpkg config list
```

### Get Setting

Get a specific configuration value.

```bash
ctxpkg config get <key>
```

### Set Setting

Set a configuration value.

```bash
ctxpkg config set <key> <value>
```

### Show Path

Display the configuration file location.

```bash
ctxpkg config path
```

## Daemon Commands

Control the background daemon process. The daemon provides persistent backend services for better performance.

### Start

Start the background daemon.

```bash
ctxpkg daemon start
```

### Stop

Stop the running daemon.

```bash
ctxpkg daemon stop
```

### Status

Show daemon status.

```bash
ctxpkg daemon status
```

### Restart

Restart the daemon.

```bash
ctxpkg daemon restart
```

## Command Aliases

For convenience, many commands have shorter aliases:

| Full Command | Alias |
|--------------|-------|
| `collections` | `col` |
| `collections list` | `col ls` |
| `documents` | `docs` |
| `documents list-collections` | `docs ls` |
| `documents drop-collection` | `docs drop` |
| `documents interactive-search` | `docs isearch` |
| `config` | `cfg` |
| `mcp documents` | `mcp docs` |

## Global Options

These options are available for all commands:

- `--help` — Show help for command
- `--version` — Show version number
