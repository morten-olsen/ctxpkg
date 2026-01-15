# Getting Started with ctxpkg

This tutorial walks you through setting up ctxpkg and creating your first context collection. By the end, you'll have indexed documentation that your AI assistant can search.

## Prerequisites

- Node.js 22.18.0+ and pnpm
- **An existing project with documentation** — this tutorial assumes you have a project with Markdown files in a `docs/` folder (or similar). If you don't have one handy, you can create a few `.md` files to experiment with.
- An AI editor with MCP support (Cursor, Claude Desktop, etc.) — optional but recommended

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

Verify the installation:

```bash
ctxpkg --version
```

## Tutorial: Index Your Project's Documentation

This tutorial assumes you have an existing project with some Markdown documentation — for example, a `docs/` folder with `.md` files. We'll index these files so you can search them.

### Step 1: Initialize Your Project

Navigate to your project directory (the one with your documentation) and initialize ctxpkg:

```bash
cd /path/to/your/project
ctxpkg col init
```

This creates a `context.json` file in your project root — this is where your collection configurations live.

### Step 2: Create a Manifest

A manifest describes what documents to include in a collection. Create `docs/manifest.json`:

```json
{
  "name": "my-project-docs",
  "version": "1.0.0",
  "description": "Documentation for My Project",
  "sources": {
    "glob": ["**/*.md"]
  }
}
```

This tells ctxpkg to include all Markdown files in the `docs/` directory.

### Step 3: Add the Collection

Register your documentation as a collection:

```bash
ctxpkg col add project-docs ./docs/manifest.json
```

- `project-docs` is the alias you'll use to reference this collection
- The path points to your manifest file

Check that it was added:

```bash
ctxpkg col list
```

You should see your collection listed with status "not synced".

### Step 4: Sync (Index) the Collection

Now index the documents:

```bash
ctxpkg col sync
```

This process:

1. Reads all files matching your manifest's glob patterns
2. Splits documents into chunks
3. Generates embeddings for semantic search
4. Stores everything in a local SQLite database

The first sync downloads the embedding model (~500MB) — subsequent syncs are much faster.

### Step 5: Search Your Documentation

Try searching for something you know is in your docs. For example, if you have a file called `getting-started.md`:

```bash
ctxpkg docs search "getting started"
```

Or search for any topic covered in your documentation:

```bash
ctxpkg docs search "install"
```

You'll see results ranked by relevance, with snippets from matching documents.

**Tip:** If you get no results, check that your docs contain the terms you're searching for. You can list what was indexed with `ctxpkg docs ls`.

### Step 6: Connect to Your AI Editor (Optional)

To let your AI assistant search your documentation directly, configure the MCP server.

**For Cursor**, create `.cursor/mcp.json` in your project:

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

**For Claude Desktop**, add to your MCP configuration:

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

Restart your editor. Your AI assistant now has access to tools like `documents_search` and `documents_get_document` to query your indexed documentation.

## Next Steps

### Add a Remote Collection

You can also add documentation packages hosted online:

```bash
ctxpkg col add react https://example.com/react-docs/manifest.json
ctxpkg col sync react
```

### Add Global Collections

Global collections are available across all your projects — perfect for personal notes or company-wide standards.

**Example: Index your personal notes folder**

If you have a folder of Markdown files (Obsidian vault, personal wiki, etc.), you can make it searchable across all your projects:

1. Create a `manifest.json` in your notes folder:

```json
{
  "name": "my-notes",
  "version": "1.0.0",
  "description": "Personal notes and snippets",
  "sources": {
    "glob": ["**/*.md"]
  }
}
```

2. Add it as a global collection (note the `file://` prefix for absolute paths):

```bash
ctxpkg col add -g my-notes file:///Users/me/Documents/notes/manifest.json
```

3. Sync:

```bash
ctxpkg col sync -g
```

Now your personal notes are searchable from any project.

**Adding remote global collections:**

```bash
ctxpkg col add -g typescript-docs https://example.com/ts-docs/manifest.json
ctxpkg col sync -g
```

### Explore More

- [CLI Reference](./cli-reference.md) — Full command documentation
- [Configuration Guide](./configuration.md) — Project config, global config, manifest format
- [How It Works](./how-it-works.md) — Technical details on indexing and search
- [MCP Server](./mcp-server.md) — Complete MCP tool reference
- [Publishing Packages](./github-distribution.md) — Distribute your documentation as a package

## Common Tasks

### Update Documentation

When your docs change, re-sync:

```bash
ctxpkg col sync project-docs
```

Only changed files are re-indexed.

### Force Re-index Everything

```bash
ctxpkg col sync --force
```

### Remove a Collection

```bash
# Remove from config only
ctxpkg col remove project-docs

# Remove from config AND delete indexed data
ctxpkg col remove project-docs --drop
```

### Interactive Search

For exploring your documentation:

```bash
ctxpkg docs isearch
```

This opens an interactive prompt where you can run multiple searches.

## Troubleshooting

### "No collections found"

Make sure you've run `ctxpkg col init` in your project directory and added at least one collection.

### Sync is slow

The first sync downloads the embedding model. Subsequent syncs only process changed files and should be much faster.

### Search returns no results

1. Check that your collection is synced: `ctxpkg col list`
2. Verify documents were indexed: `ctxpkg docs ls`
3. Try a broader search query

### MCP server not connecting

1. Verify ctxpkg is in your PATH: `which ctxpkg`
2. Check your MCP configuration syntax
3. Restart your editor after configuration changes
