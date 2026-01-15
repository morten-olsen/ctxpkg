# Tools — Agent Guidelines

This document describes the tools module architecture for AI agents working on this codebase.

## Overview

The tools module provides AI agent tools in a framework-agnostic format. Tools are defined once using a common format and can be adapted to different runtimes (MCP, LangChain). This allows the same tool logic to work across different AI frameworks.

## File Structure

```
src/tools/
├── tools.types.ts       # Common tool definition types
├── tools.mcp.ts         # MCP server adapter
├── tools.langchain.ts   # LangChain adapter
├── documents/
│   └── documents.ts     # Document tools
├── files/
│   └── files.ts         # File system tools (legacy)
└── git/
    └── git.ts           # Git tools (legacy)
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Tool Definitions                         │
│              (framework-agnostic format)                    │
│                                                             │
│   defineTool({                                              │
│     name: 'tool_name',                                      │
│     description: '...',                                     │
│     schema: z.object({...}),                                │
│     handler: async (input) => {...}                         │
│   })                                                        │
└─────────────────────────────────────────────────────────────┘
                          │
          ┌───────────────┴───────────────┐
          ▼                               ▼
┌─────────────────────┐       ┌─────────────────────┐
│    tools.mcp.ts     │       │ tools.langchain.ts  │
│  registerMcpTools() │       │  toLangchainTools() │
└─────────────────────┘       └─────────────────────┘
          │                               │
          ▼                               ▼
┌─────────────────────┐       ┌─────────────────────┐
│     MCP Server      │       │   LangChain Agent   │
└─────────────────────┘       └─────────────────────┘
```

## Tool Definition Format

Tools use a common format with Zod schemas:

```typescript
import { defineTool } from '#root/tools/tools.types.ts';
import * as z from 'zod';

const myTool = defineTool({
  name: 'my_tool_name',
  description: 'What the tool does and when to use it',
  schema: z.object({
    query: z.string().describe('Parameter description'),
    limit: z.number().optional().default(10),
  }),
  handler: async ({ query, limit }) => {
    // Tool logic here
    return { result: 'data' };
  },
});
```

### Key Fields

| Field | Purpose |
|-------|---------|
| `name` | Unique identifier (use snake_case with category prefix) |
| `description` | Help AI understand when/how to use the tool |
| `schema` | Zod schema for input validation with `.describe()` on fields |
| `handler` | Async function that executes the tool logic |

## Using Tools

### With MCP Server

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerMcpTools } from '#root/tools/tools.mcp.ts';
import { createDocumentToolDefinitions } from '#root/tools/documents/documents.ts';

const server = new McpServer({ name: 'my-server', version: '1.0.0' });
const tools = createDocumentToolDefinitions({ client });

registerMcpTools(server, tools);
```

### With LangChain

```typescript
import { toLangchainTools } from '#root/tools/tools.langchain.ts';
import { createDocumentToolDefinitions } from '#root/tools/documents/documents.ts';

const definitions = createDocumentToolDefinitions({ client });
const langchainTools = toLangchainTools(definitions);

// Use with LangChain agent
const agent = createToolCallingAgent({ tools: Object.values(langchainTools), ... });
```

## Adding New Tools

### 1. Create Tool Definitions

Create a new file in appropriate category folder:

```typescript
// src/tools/myfeature/myfeature.ts
import * as z from 'zod';
import { defineTool, type ToolDefinitions } from '#root/tools/tools.types.ts';

type MyFeatureToolOptions = {
  client: BackendClient;
};

const createMyFeatureToolDefinitions = (options: MyFeatureToolOptions): ToolDefinitions => {
  const { client } = options;

  const doSomething = defineTool({
    name: 'myfeature_do_something',
    description: 'Does something useful. Use this when...',
    schema: z.object({
      input: z.string().describe('The input to process'),
    }),
    handler: async ({ input }) => {
      const result = await client.myFeature.process({ input });
      return result;
    },
  });

  return { doSomething };
};

export { createMyFeatureToolDefinitions };
```

### 2. Register on MCP Server

In `src/mcp/mcp.ts` or relevant MCP setup:

```typescript
import { createMyFeatureToolDefinitions } from '#root/tools/myfeature/myfeature.ts';

const tools = createMyFeatureToolDefinitions({ client });
registerMcpTools(server, tools);
```

## Tool Categories

### Document Tools (`documents/`)

Tools for searching and retrieving indexed documentation:

- `documents_list_collections` — List available collections with descriptions and versions
- `documents_search` — Semantic search across documents with hybrid vector + keyword matching
- `documents_get_document` — Get full document content
- `documents_list_documents` — List all documents in a collection (table of contents)
- `documents_get_outline` — Get document heading structure without fetching full content
- `documents_get_section` — Get a specific section of a document by heading
- `documents_search_batch` — Execute multiple search queries in a single call
- `documents_find_related` — Find content semantically related to a document or chunk

### File Tools (`files/`) — Legacy

Direct file system access tools (LangChain format):

- `file_get_content` — Read file content
- `file_glob_files` — Find files by glob pattern
- `file_search_multiline` — Search file contents with regex
- `file_get_stats` — Get file metadata

### Git Tools (`git/`) — Legacy

Git repository tools (LangChain format):

- `git_status` — Repository status
- `git_get_diff` — File diffs
- `git_get_log` — Commit history

## Best Practices

### Naming

- Use category prefix: `documents_`, `files_`, `git_`
- Use snake_case: `documents_list_collections`
- Be descriptive: `search` → `documents_search`

### Descriptions

Write descriptions that help AI agents understand:
- What the tool does
- When to use it
- What input it expects
- What output it returns

```typescript
description: 
  'Search reference documents using semantic similarity. ' +
  'Returns the most relevant document chunks for the given query. ' +
  'Use this to find information in documentation, guides, or other indexed reference materials.',
```

### Schema Descriptions

Add `.describe()` to all schema fields:

```typescript
schema: z.object({
  query: z.string().describe('The search query - describe what information you are looking for'),
  limit: z.number().optional().default(10).describe('Maximum number of results to return'),
}),
```

### Return Values

- Return structured data (objects/arrays) — adapters handle JSON serialization
- Return helpful error messages as strings
- Include relevant context in results
