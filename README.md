# ctxpkg

<p align="center">
  <img src="docs/assets/banner.jpg" alt="ctxpkg banner" width="100%">
</p>

A package manager for AI agent context — manage, sync, and distribute documentation collections for AI-assisted development.

> **The Vision:** Imagine an AI assistant that knows your context — your team's commit style, your company's security policies, your preferred patterns — without you explaining it every session.
> [Read the story: **Context Stacking: How Sarah Automated Her Team's Brain**](docs/managing-ai-context-at-scale.md)

## What is ctxpkg?

Just as `npm` manages code dependencies, `ctxpkg` manages **context dependencies**.

Stack documentation layers — from personal notes to team guidelines to project docs — into a unified knowledge base. Your AI agents search this indexed context instead of relying on stale training data or manual copy-paste.

**Key capabilities:**

- **Context Stacking** — Layer documentation from multiple sources (personal, team, project, global)
- **Semantic Search** — Local vector + keyword search finds relevant content without dumping everything into prompts
- **MCP Integration** — AI editors like Cursor and Claude Desktop can query your context directly
- **Git-Native Distribution** — Index docs directly from any git repo (public or private) — no publishing required

## Installation

```bash
git clone <repository-url>
cd ctxpkg
pnpm install
npm link
```

## Quick Start

```bash
# Initialize project config
ctxpkg col init

# Add your docs folder (requires manifest.json)
ctxpkg col add docs ./docs/manifest.json

# Index the documents
ctxpkg col sync

# Search your documentation
ctxpkg docs search "how to authenticate"
```

**[Full tutorial: Getting Started](docs/getting-started.md)**

## Documentation

| Guide | Description |
|-------|-------------|
| [Getting Started](docs/getting-started.md) | First-time setup tutorial |
| [CLI Reference](docs/cli-reference.md) | Complete command documentation |
| [Configuration](docs/configuration.md) | Project config, global config, manifests |
| [How It Works](docs/how-it-works.md) | Indexing pipeline, search algorithms |
| [MCP Server](docs/mcp-server.md) | AI editor integration and tools |
| [Publishing Packages](docs/github-distribution.md) | Distribute docs via GitHub Releases |

## CLI Overview

```bash
# Collections — manage context packages
ctxpkg col init                    # Initialize project
ctxpkg col add <alias> <url>       # Add a collection
ctxpkg col add -g <alias> <url>    # Add global collection
ctxpkg col sync                    # Index documents
ctxpkg col list                    # Show collections

# Documents — query indexed content
ctxpkg docs search "query"         # Search documents
ctxpkg docs ls                     # List indexed collections

# MCP — AI editor integration
ctxpkg mcp docs                    # Start MCP server

# Daemon — background service
ctxpkg daemon start                # Start for better performance
```

See [CLI Reference](docs/cli-reference.md) for complete documentation.

## Example: Context Stacking

Layer context from multiple sources:

```json
{
  "collections": {
    "project-docs": {
      "url": "file://./docs/manifest.json"
    },
    "team-standards": {
      "url": "git+https://github.com/myorg/standards#main?manifest=manifest.json"
    },
    "react": {
      "url": "git+https://github.com/facebook/react#v18.2.0?manifest=docs/manifest.json"
    }
  }
}
```

**Git repositories are the easiest way to share documentation** — no publishing step required. Just point to a repo with a `manifest.json`:

```bash
# Add docs from any git repo (HTTPS or SSH)
ctxpkg col add team-docs "git+https://github.com/myorg/docs#main?manifest=manifest.json"
ctxpkg col add private-docs "git+ssh://git@github.com/myorg/private#main?manifest=manifest.json"
```

Add personal/global context available across all projects:

```bash
ctxpkg col add -g my-notes file:///Users/me/notes/manifest.json
```

## MCP Integration

Connect ctxpkg to your AI editor:

```json
{
  "mcpServers": {
    "ctxpkg": {
      "command": "ctxpkg",
      "args": ["mcp", "documents"]
    }
  }
}
```

Your AI assistant gains access to 8 document tools: `search`, `search_batch`, `get_document`, `get_section`, `get_outline`, `find_related`, `list_collections`, and `list_documents`.

See [MCP Server Documentation](docs/mcp-server.md) for details.

## Development

```bash
pnpm run test:lint   # Linting
pnpm run test:unit   # Unit tests
pnpm run build       # Build TypeScript
```

## License

[GNU Affero General Public License v3.0 (AGPL-3.0)](LICENSE)
