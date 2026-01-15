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

See [Distributing Collections via GitHub Releases](docs/github-distribution.md) for a complete guide on automating builds and publishing with GitHub Actions.

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

## Indexing & Search

### How Documents Are Indexed

When you sync a collection, documents go through the following pipeline:

```
Document → Token Chunking → Context Enrichment → Embedding → Storage
```

**1. Token-Based Chunking**

Documents are split into chunks of ~400 tokens with 80 token overlap:

- Uses `cl100k_base` tokenizer for accurate token counting
- Overlap preserves context at chunk boundaries
- Sized to fit within the embedding model's 512-token limit

**2. Context Enrichment**

Each chunk is enriched with document context before embedding:

```
Document: {document title}
Section: {nearest heading}

{chunk content}
```

This helps the embedding model understand what each chunk is about, improving retrieval accuracy.

**3. Embedding**

Chunks are embedded using `mixedbread-ai/mxbai-embed-large-v1`:

- 1024-dimensional vectors
- Instruction-based embeddings (different prompts for indexing vs searching)
- Runs locally via transformers.js (no API calls)

**4. Storage**

Indexed data is stored in SQLite with:

- **Vector table**: Chunk embeddings for similarity search (via sqlite-vec)
- **FTS5 table**: Chunk text for keyword search

### How Search Works

Search combines multiple strategies for better results:

```
Query → Query Embedding → Hybrid Search → Rank Fusion → (Optional Re-rank) → Results
```

**1. Hybrid Search (default)**

Queries run against both indexes simultaneously:

| Method | What it finds |
|--------|---------------|
| Vector search | Semantically similar content (cosine distance) |
| Keyword search | Exact term matches (FTS5 BM25) |

**2. Reciprocal Rank Fusion (RRF)**

Results from both methods are merged using RRF, which combines rankings without requiring score normalization. Documents appearing in both result sets get boosted.

**3. Optional Re-ranking**

With `--rerank`, top candidates are re-scored using a secondary embedding model for higher precision.

### Search Options

```bash
# Basic search
ctxpkg ref search "authentication flow"

# Filter by collection
ctxpkg ref search "hooks" -c react

# Limit results
ctxpkg ref search "error handling" -l 5

# Filter out low-quality matches (distance 0-2, lower = better)
ctxpkg ref search "query" --max-distance 0.8

# Disable hybrid search (vector-only)
ctxpkg ref search "query" --no-hybrid

# Enable re-ranking for higher precision
ctxpkg ref search "query" --rerank
```

### Understanding Results

```
1. getting-started.md in project-docs
   Score: 0.0327 | Distance: 0.4521
```

| Metric | Meaning |
|--------|---------|
| **Distance** | Cosine distance (0 = identical, 2 = opposite). < 0.5 is good, < 1.0 is relevant |
| **Score** | Combined ranking score from hybrid search (higher = better) |

## Development

```bash
pnpm run test:lint   # Run linting
pnpm run test:unit   # Run tests
pnpm run build       # Build TypeScript
```

## License

[GNU Affero General Public License v3.0 (AGPL-3.0)](LICENSE)
