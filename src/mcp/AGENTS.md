# MCP — Agent Guidelines

This document describes the MCP module architecture for AI agents working on this codebase.

## Overview

The MCP module provides [Model Context Protocol](https://modelcontextprotocol.io/) server integration. It creates MCP servers that expose ctxpkg's document tools to AI editors like Cursor, Claude Desktop, and other MCP-compatible clients. The server communicates over stdio transport.

## File Structure

| File | Purpose |
|------|---------|
| `mcp.ts` | MCP server creation and stdio runner |

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
│  ┌───────────────────────────────────────────────────────┐  │
│  │              StdioServerTransport                     │  │
│  └───────────────────────────────────────────────────────┘  │
│                           │                                 │
│  ┌───────────────────────▼───────────────────────────────┐  │
│  │                   McpServer                           │  │
│  │         (from @modelcontextprotocol/sdk)              │  │
│  └───────────────────────────────────────────────────────┘  │
│                           │                                 │
│  ┌───────────────────────▼───────────────────────────────┐  │
│  │              Document Tools                           │  │
│  │  • documents_list_collections                         │  │
│  │  • documents_search                                   │  │
│  │  • documents_get_document                             │  │
│  │  • documents_list_documents                           │  │
│  │  • documents_get_outline                              │  │
│  │  • documents_get_section                              │  │
│  │  • documents_search_batch                             │  │
│  │  • documents_find_related                             │  │
│  └───────────────────────────────────────────────────────┘  │
│                           │                                 │
│  ┌───────────────────────▼───────────────────────────────┐  │
│  │                 BackendClient                         │  │
│  │           (connects to daemon/direct)                 │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Usage

### Starting the MCP Server

Via CLI:

```bash
# Start with all collections
ctxpkg mcp documents

# Limit to specific collections
ctxpkg mcp documents -c my-docs langchain-docs

# Custom server name/version
ctxpkg mcp documents --name my-server --version 2.0.0
```

### Programmatic Usage

```typescript
import { createDocumentsMcpServer, runMcpServer } from '#root/mcp/mcp.ts';
import { createClient } from '#root/client/client.ts';

const client = await createClient({ mode: 'daemon' });

const server = createDocumentsMcpServer({
  client,
  name: 'my-mcp-server',
  version: '1.0.0',
  aliasMap: new Map([['docs', 'pkg:file://./docs/manifest.json']]),
});

await runMcpServer(server);
```

## Editor Configuration

### Cursor

Add to `.cursor/mcp.json`:

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

### Claude Desktop

Add to Claude Desktop config:

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

## Server Modes

### Documents Mode (default)

Exposes all document tools individually. The calling agent decides which tools to use.

```bash
ctxpkg mcp documents
```

### Agent Mode

Exposes a single `ask_documents` tool. An internal LangChain agent handles searching and synthesizes a single answer. This reduces token/context costs for the calling agent.

```bash
ctxpkg mcp agent
```

Requires LLM configuration:
```bash
ctxpkg config set llm.apiKey sk-...
ctxpkg config set llm.model gpt-4o
```

## Exposed Tools

### Documents Mode

The MCP server exposes these tools to AI agents:

| Tool | Description |
|------|-------------|
| `documents_list_collections` | List available document collections with descriptions and versions |
| `documents_search` | Semantic search across documents using hybrid vector + keyword matching |
| `documents_get_document` | Get full document content |
| `documents_list_documents` | List all documents in a collection (table of contents) |
| `documents_get_outline` | Get document heading structure without fetching full content |
| `documents_get_section` | Get a specific section of a document by heading |
| `documents_search_batch` | Execute multiple search queries in a single call (max 10) |
| `documents_find_related` | Find content semantically related to a document or chunk |

See `src/tools/documents/` for tool implementation details.

### Agent Mode

| Tool | Description |
|------|-------------|
| `ask_documents` | Ask a question with a use case; internal agent searches and synthesizes answer |

The `ask_documents` tool requires both a query and a use case to help the agent determine when sufficient information has been found.

See `src/tools/agent/` and `src/agent/` for implementation details.

## Key Components

### `createDocumentsMcpServer(options)`

Creates an MCP server instance with document tools:

```typescript
type DocumentsMcpServerOptions = {
  client: BackendClient;      // Required: backend connection
  name?: string;              // Server name (default: 'ctxpkg-documents')
  version?: string;           // Server version (default: '1.0.0')
  collections?: string[];     // Limit to specific collections
  aliasMap?: Map<string, string>;  // Project alias → collection ID
};
```

### `createAgentMcpServer(options)`

Creates an MCP server with agent mode (single `ask_documents` tool):

```typescript
type AgentMcpServerOptions = {
  client: BackendClient;      // Required: backend connection
  llmConfig: LLMConfig;       // Required: LLM configuration
  name?: string;              // Server name (default: 'ctxpkg-agent')
  version?: string;           // Server version (default: '1.0.0')
  aliasMap?: Map<string, string>;  // Project alias → collection ID
  maxIterations?: number;     // Max agent iterations (default: 15)
};
```

### `runMcpServer(server)`

Connects the server to stdio transport and handles shutdown:

- Creates `StdioServerTransport`
- Connects server to transport
- Registers SIGINT/SIGTERM handlers for graceful shutdown

## Adding New MCP Servers

To create an MCP server with different tools:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerMcpTools } from '#root/tools/tools.mcp.ts';

const createMyMcpServer = (options: MyOptions) => {
  const server = new McpServer({
    name: options.name ?? 'my-server',
    version: options.version ?? '1.0.0',
  });

  // Create tool definitions
  const tools = createMyToolDefinitions(options);
  
  // Register on MCP server
  registerMcpTools(server, tools);

  return server;
};
```

Then add a CLI command in `cli.mcp.ts` to start it.

## Key Patterns

### Alias Resolution

Project aliases (from `context.json`) are resolved to collection IDs:

```typescript
const aliasMap = new Map<string, string>();
for (const [alias, spec] of Object.entries(projectConfig.collections)) {
  const collectionId = collectionsService.computeCollectionId(spec, cwd);
  aliasMap.set(alias, collectionId);
}
```

This allows users to search by friendly names like `"langchain"` instead of `"pkg:https://..."`.

### Graceful Shutdown

The server handles shutdown signals to close cleanly:

```typescript
process.on('SIGINT', async () => {
  await server.close();
  process.exit(0);
});
```
