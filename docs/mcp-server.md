# MCP Server Documentation

This guide covers the Model Context Protocol (MCP) server provided by ctxpkg, which exposes document tools to AI editors like Cursor, Claude Desktop, and other MCP-compatible clients.

## Overview

The MCP server gives AI agents direct access to your indexed documentation. Instead of manually copying documentation into prompts, agents can search, browse, and retrieve relevant context on demand.

**Key Benefits:**

- **Efficient context retrieval**: Agents fetch only what they need
- **Reduced token usage**: No need to dump entire docs into prompts
- **Always current**: Searches your synced collections in real-time
- **Smart search**: Hybrid semantic + keyword matching finds relevant content

## Quick Start

### 1. Sync Your Collections

Before starting the MCP server, ensure your collections are synced:

```bash
# Add and sync a collection
ctxpkg col add my-docs ./docs/manifest.json
ctxpkg col sync
```

### 2. Start the MCP Server

```bash
# Start with all collections (local + global)
ctxpkg mcp documents

# Or limit to specific collections
ctxpkg mcp docs -c my-docs react-docs
```

### 3. Configure Your Editor

Add to your MCP client configuration:

**Cursor** (`.cursor/mcp.json`):

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

**Claude Desktop**:

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

## Available Tools

The MCP server exposes 8 tools for document access:

### Discovery Tools

#### `documents_list_collections`

List all available document collections with metadata.

**Use when:** Starting a task to understand what documentation is available.

**Returns:**
- Collection name/alias
- Document count
- Description (from manifest)
- Version (from manifest)

**Example response:**
```json
[
  {
    "collection": "react-docs",
    "documentCount": 142,
    "description": "React 18 documentation",
    "version": "18.2.0"
  }
]
```

#### `documents_list_documents`

List all documents in a specific collection (table of contents).

**Parameters:**
- `collection` (required): Collection name or alias
- `limit` (optional): Max documents to return (default: 100)
- `offset` (optional): Pagination offset (default: 0)

**Use when:** Browsing what's in a collection before searching.

**Example response:**
```json
{
  "documents": [
    { "id": "getting-started.md", "title": "Getting Started", "size": 4521 },
    { "id": "api/hooks.md", "title": "Hooks API Reference", "size": 12340 }
  ],
  "total": 142,
  "hasMore": true
}
```

### Search Tools

#### `documents_search`

Search documents using hybrid semantic + keyword matching.

**Parameters:**
- `query` (required): What you're looking for
- `collections` (optional): Limit to specific collections
- `limit` (optional): Max results (default: 10)
- `maxDistance` (optional): Filter threshold (0-2, lower = stricter)
- `hybridSearch` (optional): Combine vector + keyword (default: true)
- `rerank` (optional): Re-rank for precision (default: false)

**Use when:** Finding information on a topic.

**Example:**
```json
{
  "query": "how to handle authentication",
  "collections": ["react-docs"],
  "limit": 5
}
```

#### `documents_search_batch`

Execute multiple search queries in a single call (max 10 queries).

**Parameters:**
- `queries` (required): Array of `{ query, collections? }` objects
- `limit` (optional): Results per query (default: 5)
- `maxDistance` (optional): Filter threshold
- `hybridSearch` (optional): Use hybrid search (default: true)

**Use when:** Researching multiple related concepts at once.

**Example:**
```json
{
  "queries": [
    { "query": "useState hook" },
    { "query": "useEffect cleanup" },
    { "query": "custom hooks best practices" }
  ],
  "limit": 3
}
```

#### `documents_find_related`

Find content semantically related to a document or chunk.

**Parameters:**
- `collection` (required): Source collection
- `document` (required): Source document ID
- `chunk` (optional): Specific text to find related content for
- `limit` (optional): Max results (default: 5)
- `sameDocument` (optional): Include same document (default: false)

**Use when:** Expanding context or finding related documentation.

### Retrieval Tools

#### `documents_get_document`

Get the full content of a specific document.

**Parameters:**
- `collection` (required): Collection name or alias
- `document` (required): Document ID (typically file path)

**Use when:** You need the complete document after finding it via search.

#### `documents_get_outline`

Get the heading structure of a document without fetching full content.

**Parameters:**
- `collection` (required): Collection name or alias
- `document` (required): Document ID
- `maxDepth` (optional): Max heading depth 1-6 (default: 3)

**Use when:** Understanding document structure before reading specific sections.

**Example response:**
```json
{
  "title": "Authentication Guide",
  "outline": [
    { "level": 1, "text": "Authentication Guide", "line": 1 },
    { "level": 2, "text": "Setup", "line": 5 },
    { "level": 2, "text": "OAuth Integration", "line": 25 },
    { "level": 3, "text": "Google OAuth", "line": 30 },
    { "level": 3, "text": "GitHub OAuth", "line": 55 }
  ]
}
```

#### `documents_get_section`

Get a specific section of a document by heading.

**Parameters:**
- `collection` (required): Collection name or alias
- `document` (required): Document ID
- `section` (required): Heading text to match (case-insensitive)
- `includeSubsections` (optional): Include nested sections (default: true)

**Use when:** You only need a specific part of a document.

**Example:**
```json
{
  "collection": "react-docs",
  "document": "hooks/use-effect.md",
  "section": "Cleanup Functions"
}
```

## Recommended Agent Workflow

For best results, AI agents should follow this pattern:

### 1. Discover Available Context

```
Agent: Call documents_list_collections
→ Learn what documentation collections are available
```

### 2. Browse Before Searching

```
Agent: Call documents_list_documents for relevant collection
→ See what documents exist, spot relevant files by title
```

### 3. Search for Specific Information

```
Agent: Call documents_search with focused query
→ Get relevant chunks from across documents
```

### 4. Retrieve Details as Needed

```
Option A: Call documents_get_document for full content
Option B: Call documents_get_outline → documents_get_section for targeted retrieval
```

### 5. Expand Context if Needed

```
Agent: Call documents_find_related to discover related content
Agent: Call documents_search_batch for multiple related queries
```

## CLI Options

```bash
# Start with all collections
ctxpkg mcp documents

# Aliases
ctxpkg mcp docs

# Limit to specific collections
ctxpkg mcp docs -c project-docs react-docs

# Exclude global collections
ctxpkg mcp docs --no-global

# Custom server name/version
ctxpkg mcp docs --name my-context-server --version 2.0.0
```

## Tips for Effective Use

### For Documentation Authors

1. **Use descriptive headings**: Section retrieval relies on heading text matching
2. **Add manifest descriptions**: They appear in `list_collections` to help agents choose
3. **Keep documents focused**: Smaller, focused docs work better than monolithic files

### For Agent Developers

1. **Use batch search** when researching multiple concepts
2. **Get outlines first** for large documents to find relevant sections
3. **Set appropriate limits** to avoid overwhelming context windows
4. **Use `maxDistance`** to filter out low-quality matches

### For Users

1. **Sync regularly**: Run `ctxpkg col sync` to keep indexed content current
2. **Use aliases**: Name collections meaningfully in `context.json`
3. **Layer context**: Use global collections for personal/team docs, local for project-specific

## Troubleshooting

### "No document collections found"

Ensure collections are synced:

```bash
ctxpkg col list    # Check configured collections
ctxpkg col sync    # Sync all collections
```

### Search returns irrelevant results

- Try more specific queries
- Use `maxDistance` to filter (e.g., `0.8` for stricter matching)
- Check if the information exists in your indexed docs

### MCP server not connecting

1. Verify ctxpkg is in your PATH: `which ctxpkg`
2. Check MCP client configuration syntax
3. Try running manually: `ctxpkg mcp docs`

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     AI Editor / Client                      │
│              (Cursor, Claude Desktop, etc.)                 │
└──────────────────────────┬──────────────────────────────────┘
                           │ stdio (JSON-RPC)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                      MCP Server                             │
│                                                             │
│   Tools:                                                    │
│   • documents_list_collections                              │
│   • documents_list_documents                                │
│   • documents_search                                        │
│   • documents_search_batch                                  │
│   • documents_get_document                                  │
│   • documents_get_outline                                   │
│   • documents_get_section                                   │
│   • documents_find_related                                  │
│                                                             │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    Backend Services                         │
│                                                             │
│   SQLite Database:                                          │
│   • Vector embeddings (sqlite-vec)                          │
│   • Full-text search (FTS5)                                 │
│   • Collection metadata                                     │
└─────────────────────────────────────────────────────────────┘
```

## See Also

- [Managing AI Context at Scale](managing-ai-context-at-scale.md) — The vision behind ctxpkg
- [Distributing Collections via GitHub](github-distribution.md) — Publishing documentation packages
