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
- **Bundle Any Source** — Export docs from Confluence, Notion, or any system to markdown, then package into distributable `.tar.gz` archives

## Design Philosophy

**Zero-friction adoption.** You probably already have documentation worth indexing — a folder of markdown notes, an Obsidian vault, your company's engineering wiki, or a repo full of ADRs and guides. ctxpkg works with what you have. Point it at existing files and start searching. No migration, no reformatting, no custom schemas required.

**Low-risk investment.** Even if you decide ctxpkg isn't for you, any documentation you create remains useful. It's just markdown files with a simple manifest — humans can read it, other tools can consume it, and nothing is locked into a proprietary format. The worst case scenario is you end up with better-organized documentation.

## Installation

`npm i -g ctxpkg` or run command with `npx` prefix (`npx ctxpkg col init`)

## Quick Start

Get your AI agents access to your documentation in minutes:

```bash
# Initialize project config
ctxpkg col init

# Add your docs folder (requires manifest.json)
ctxpkg col add docs ./docs/manifest.json

# Index the documents
ctxpkg col sync
```

Now configure your AI editor to use the ctxpkg MCP server:

<details>
<summary>🔧 Cursor</summary>

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "ctxpkg": {
      "command": "npx",
      "args": ["-y", "ctxpkg", "mcp", "documents"]
    }
  }
}
```

</details>

<details>
<summary>🤖 Claude Code</summary>

Run this command:

```bash
claude mcp add ctxpkg -- npx -y ctxpkg mcp documents
```

</details>

<details>
<summary>⚡ Opencode</summary>

Add to your Opencode configuration:

```json
{
  "mcp": {
    "ctxpkg": {
      "type": "local",
      "command": ["npx", "-y", "ctxpkg", "mcp", "documents"],
      "enabled": true
    }
  }
}
```

</details>

**[See more AI editor setups](docs/setup-agents.md)** • **[Full tutorial: Getting Started](docs/getting-started.md)**

## Documentation

| Guide                                              | Description                                       |
| -------------------------------------------------- | ------------------------------------------------- |
| [AI Editor Setup](docs/setup-agents.md)            | Configure Cursor, Claude Code, Opencode, and more |
| [Getting Started](docs/getting-started.md)         | First-time setup tutorial                         |
| [CLI Reference](docs/cli-reference.md)             | Complete command documentation                    |
| [Configuration](docs/configuration.md)             | Project config, global config, manifests          |
| [How It Works](docs/how-it-works.md)               | Indexing pipeline, search algorithms              |
| [MCP Server](docs/mcp-server.md)                   | AI editor integration and tools                   |
| [AI Chat & Agent Mode](docs/ai-chat.md)            | Chat with docs, reduced-token MCP mode            |
| [Agent Testing](docs/agent-testing.md)             | Validate agent performance with test suites       |
| [Publishing Packages](docs/github-distribution.md) | Distribute docs via GitHub Releases               |

## CLI Management Tools

The CLI is primarily for managing your context collections. Most users will interact with ctxpkg through their AI editor via MCP.

```bash
# Collections — manage context packages
ctxpkg col init                    # Initialize project
ctxpkg col add <alias> <url>       # Add a collection
ctxpkg col add -g <alias> <url>    # Add global collection
ctxpkg col sync                    # Index documents
ctxpkg col list                    # Show collections

# MCP — AI editor integration (main use case)
ctxpkg mcp docs                    # Start MCP server (tools mode)
ctxpkg mcp agent                   # Start MCP server (agent mode)

# Additional tools
ctxpkg docs search "query"         # Direct search (testing)
ctxpkg chat "question"             # AI-powered Q&A
ctxpkg agent test tests.yaml       # Test agent performance
ctxpkg daemon start                # Background service
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

ctxpkg's primary purpose is giving AI agents access to your documentation through the **Model Context Protocol (MCP)**. Once configured, your AI assistant gains access to 8 document tools:

- `search` - Semantic search across all your documentation
- `search_batch` - Multiple queries in one call
- `get_document` - Retrieve full document content
- `get_section` - Get specific document sections
- `get_outline` - Get document structure/outline
- `find_related` - Find related documents
- `list_collections` - List all indexed collections
- `list_documents` - List all documents in collections

### Agent Mode (Recommended for Chat)

For reduced token costs in long conversations, use **Agent Mode**:

```json
{
  "mcpServers": {
    "ctxpkg-agent": {
      "command": "npx",
      "args": ["-y", "ctxpkg", "mcp", "agent"]
    }
  }
}
```

This exposes a single `ask_documents` tool that uses an internal AI agent to search and synthesize answers. The calling agent sees only the final result, not intermediate search calls — reducing context overhead.

See [MCP Server Documentation](docs/mcp-server.md) for complete details.

## AI Chat & Agent Mode

Chat with your documentation directly from the terminal, or use **Agent Mode** for reduced token costs in AI assistants.

```bash
# Configure your LLM
ctxpkg config set llm.apiKey sk-...

# One-shot question
ctxpkg chat "How do I implement caching?" --use-case "Optimizing API performance"

# Interactive session
ctxpkg chat -i
```

**Agent Mode MCP** exposes a single `ask_documents` tool that uses an internal AI agent to search and synthesize answers. The calling agent sees only the final result, not intermediate search calls — reducing context overhead in long conversations.

```json
{
  "mcpServers": {
    "ctxpkg-agent": {
      "command": "ctxpkg",
      "args": ["mcp", "agent"]
    }
  }
}
```

See [AI Chat & Agent Mode](docs/ai-chat.md) for details.

## Distributing Internal Documentation

ctxpkg can package documentation from any source — Confluence, Notion, SharePoint, or internal wikis — into distributable bundles that teams can share via internal systems.

**Workflow:**

1. **Export your docs as Markdown** — Use your platform's export tools or APIs to extract documentation
2. **Add a manifest** — Create a `manifest.json` describing the collection:

   ```json
   {
     "name": "company-knowledge-base",
     "sources": [{ "pattern": "**/*.md" }]
   }
   ```

3. **Create a bundle** — Package everything into a distributable archive:

   ```bash
   ctxpkg col pack --output knowledge-base-v1.tar.gz
   ```

4. **Distribute internally** — Host the bundle on internal file servers, S3, or artifact storage

Teams can then add the bundle:

```bash
ctxpkg col add kb https://internal.example.com/bundles/knowledge-base-v1.tar.gz
```

This enables organizations to centralize and distribute institutional knowledge to AI agents across all teams, without requiring git repositories or public hosting.

See [Publishing Packages](docs/github-distribution.md) for automated publishing with GitHub Actions.

## Development

```bash
pnpm run test:lint   # Linting
pnpm run test:unit   # Unit tests
pnpm run build       # Build TypeScript
```

## License

[GNU Affero General Public License v3.0 (AGPL-3.0)](LICENSE)
