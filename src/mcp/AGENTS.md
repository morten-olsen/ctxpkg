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
  aliasMap: new Map([['docs', 'file:abc123']]),
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

## Exposed Tools

The MCP server exposes these tools to AI agents:

| Tool | Description |
|------|-------------|
| `documents_list_collections` | List available document collections |
| `documents_search` | Semantic search across documents |
| `documents_get_document` | Get full document content |

See `src/tools/documents/` for tool implementation details.

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
