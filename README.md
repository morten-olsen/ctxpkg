# ctxpkg

A package manager for AI agent context — manage, sync, and distribute reference documentation collections for AI-assisted development workflows.

## Overview

`ctxpkg` helps you manage contextual documentation that AI agents can use to understand your codebase, frameworks, and organizational standards. Think of it as "npm for AI context":

- **Local collections**: Index local documentation with glob patterns
- **Package collections**: Install from remote manifests or bundles
- **Versioning**: Pin to specific versions via URL
- **Sharing**: Create distributable packages for your team or the community
- **Semantic search**: Query indexed documents with natural language

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd ctxpkg

# Install dependencies
pnpm install

# Make globally accessible
npm link
```

## Quick Start

```bash
# Initialize a project config
ctxpkg col init

# Add local documentation
ctxpkg col add project-docs ./docs

# Add a remote package
ctxpkg col add react https://example.com/react-docs/v18/manifest.json

# Sync all collections (index documents)
ctxpkg col sync

# Search your indexed documentation
ctxpkg ref search "how to handle authentication"
```

## CLI Usage

### Collection Commands

Manage context collections as packages.

```bash
# Initialize project config (creates context.json)
ctxpkg collections init
ctxpkg col init

# Add collections
ctxpkg col add project-docs ./docs                    # Local files
ctxpkg col add react https://example.com/manifest.json  # Remote package
ctxpkg col add lib file://../shared/manifest.json     # Local package

# Add with explicit options
ctxpkg col add my-docs --type file --path ./docs --glob "**/*.md"
ctxpkg col add lib --type pkg --url https://example.com/bundle.tar.gz

# List configured collections and sync status
ctxpkg col list
ctxpkg col ls

# Sync collections (index documents)
ctxpkg col sync           # Sync all
ctxpkg col sync react     # Sync specific collection
ctxpkg col sync --force   # Re-index everything

# Remove a collection
ctxpkg col remove react
ctxpkg col remove react --drop  # Also delete indexed data
```

### Reference Commands

Query indexed reference documents.

```bash
# List indexed collections
ctxpkg ref ls

# Search documents
ctxpkg ref search "authentication flow"
ctxpkg ref search "error handling" -c project-docs -l 5
ctxpkg ref search "hooks" --collections react lodash --limit 20

# Interactive search
ctxpkg ref isearch

# Drop a collection from index
ctxpkg ref drop my-docs
ctxpkg ref drop my-docs -f   # Skip confirmation
```

### Publishing Packages

Create distributable documentation packages.

```bash
# Create a manifest for your documentation
ctxpkg col manifest init

# Edit manifest.json to configure sources
# Then create a bundle
ctxpkg col pack
ctxpkg col pack --output my-docs-1.0.0.tar.gz
```

### MCP Server

Expose reference tools via Model Context Protocol for AI editor integration.

```bash
# Start MCP server with reference tools
ctxpkg mcp references
ctxpkg mcp ref

# Limit to specific collections
ctxpkg mcp ref -c project-docs react
```

**MCP Client Configuration:**

```json
{
  "mcpServers": {
    "ctxpkg-references": {
      "command": "ctxpkg",
      "args": ["mcp", "references"]
    }
  }
}
```

### Configuration Commands

```bash
ctxpkg config list          # List all settings
ctxpkg config get <key>     # Get a value
ctxpkg config set <key> <value>  # Set a value
ctxpkg config path          # Show config file location
```

### Daemon Commands

The daemon provides persistent backend services for better performance.

```bash
ctxpkg daemon start    # Start background daemon
ctxpkg daemon stop     # Stop daemon
ctxpkg daemon status   # Show daemon status
ctxpkg daemon restart  # Restart daemon
```

## Project Configuration

Projects use a `context.json` file to declare their collections:

```json
{
  "collections": {
    "project-docs": {
      "type": "file",
      "path": "./docs",
      "glob": "**/*.md"
    },
    "react": {
      "type": "pkg",
      "url": "https://example.com/react-docs/v18/manifest.json"
    },
    "org-standards": {
      "type": "pkg",
      "url": "file://../shared/standards/manifest.json"
    }
  }
}
```

## Package Manifest Format

Published packages use a `manifest.json`:

```json
{
  "name": "my-framework-docs",
  "version": "2.0.0",
  "description": "Documentation for My Framework",
  "sources": {
    "glob": ["**/*.md"]
  }
}
```

Or with explicit file list and hashes:

```json
{
  "name": "my-framework-docs",
  "version": "2.0.0",
  "baseUrl": "https://cdn.example.com/docs/",
  "sources": {
    "files": [
      "getting-started.md",
      { "path": "api/core.md", "hash": "sha256:9f86d081..." },
      { "url": "https://other-cdn.com/shared/contributing.md" }
    ]
  }
}
```

## Command Aliases

| Full Command                    | Alias         |
| ------------------------------- | ------------- |
| `collections`                   | `col`         |
| `collections list`              | `col ls`      |
| `references`                    | `ref`         |
| `references list-collections`   | `ref ls`      |
| `references drop-collection`    | `ref drop`    |
| `references interactive-search` | `ref isearch` |
| `config`                        | `cfg`         |
| `mcp references`                | `mcp ref`     |

## How It Works

1. **Collections** are declared in your project's `context.json`
2. **Sync** fetches and indexes documents into a local SQLite database
3. Documents are **chunked** and **embedded** using local ML models
4. **Search** uses vector similarity to find relevant content
5. **MCP integration** exposes search to AI agents and editors

## Development

```bash
pnpm run test:lint   # Run linting
pnpm run test:unit   # Run tests
pnpm run build       # Build TypeScript
```

## License

[GNU Affero General Public License v3.0 (AGPL-3.0)](LICENSE)
