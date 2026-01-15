# Architecture

This document describes the architecture and design of `ctxpkg`.

## Overview

The project is a TypeScript CLI application that provides a **package manager for AI agent context**:

1. Collection package management (local files and remote packages)
2. Semantic search over indexed documents
3. MCP server integration for AI tools and editors
4. A daemon mode for persistent backend services

## Directory Structure

```
src/
├── backend/         # Backend service layer and protocol
├── cli/             # CLI command definitions
├── client/          # Backend client with multiple adapters
├── collections/     # Collection package management
├── config/          # Configuration management (convict)
├── daemon/          # Daemon server and manager
├── database/        # SQLite database with migrations
├── embedder/        # Text embedding service
├── mcp/             # MCP server creation and management
├── documents/       # Document management
├── tools/           # MCP tools (documents)
└── utils/           # Shared utilities (service container)

bin/
├── cli.js           # CLI entry point
└── daemon.js        # Daemon entry point

specs/
└── collection-packages.md  # Collection packages specification
```

## Core Components

### Collections (`src/collections/`)

The heart of the application — package manager for AI context.

**Files:**
- `collections.ts` - Main CollectionsService class
- `collections.schemas.ts` - Zod schemas for project config, manifests, and database records

**Collection Types:**

| Type | Description | Source |
|------|-------------|--------|
| `file` | Local ad-hoc indexing | Path + glob pattern |
| `pkg` | Shareable packages | Manifest URL or bundle |

**Key Concepts:**

- **Project Config** (`context.json`): Per-project file mapping aliases to collection specs
- **Manifest** (`manifest.json`): Package definition with name, version, and sources
- **Bundle** (`.tar.gz`): Distributable archive with manifest and files
- **Collection ID**: Unique identifier (`file:{hash}` or `pkg:{url}`)

**Sync Process:**

```
1. Read project config (context.json)
2. For each collection:
   a. Compute collection ID from spec
   b. Fetch manifest or expand glob
   c. Compare with existing indexed documents (hash-based)
   d. Add/update/remove documents as needed
3. Update collection metadata in database
```

### Documents (`src/documents/`)

Document storage and semantic search:

- Documents organized into collections (keyed by collection ID)
- Content chunked using `TokenTextSplitter`
- Chunks embedded and stored with vectors
- Search uses hybrid vector + keyword matching

**Key Methods:**
- `updateDocument()` - Index a document (chunk, embed, store)
- `search()` - Semantic search across collections
- `getDocumentIds()` - List documents for sync reconciliation
- `deleteDocuments()` - Remove orphaned documents

### Backend (`src/backend/`)

Protocol-agnostic service layer that can run in-process or as a daemon.

**Files:**
- `backend.ts` - Main Backend class, handles request routing
- `backend.protocol.ts` - JSON-RPC inspired protocol definitions
- `backend.services.ts` - Service procedure definitions
- `backend.types.ts` - Shared type definitions for backend API
- `backend.schemas.ts` - Zod schemas for validation

**Services:**
- `documents` - Document search and management
- `collections` - Collection sync and status
- `system` - Ping, status, shutdown

### Client (`src/client/`)

Unified client for interacting with the backend.

**Connection Modes:**
- `direct` - In-process backend (no daemon)
- `daemon` - Connect via Unix socket to daemon
- `websocket` - Connect via remote WebSocket

**Usage:**
```typescript
import { BackendClient } from '#root/client/client.ts';

const client = new BackendClient({ mode: 'direct' });
await client.connect();

// Type-safe API calls
const results = await client.documents.search({ query: 'hello', limit: 10 });
await client.collections.sync({ name: 'docs', spec: {...}, cwd: '/path' });

await client.disconnect();
```

### Daemon (`src/daemon/`)

Persistent backend process for better performance.

**Features:**
- WebSocket server over Unix socket
- Auto-shutdown after idle timeout (configurable)
- PID file for process management
- Graceful shutdown handling

### Database (`src/database/`)

SQLite database using Knex query builder with:

- `better-sqlite3` driver for performance
- `sqlite-vec` extension for vector operations
- Migration system in `migrations/`

**Tables:**
- `collections` - Collection metadata and sync state
- `reference_documents` - Document metadata and content
- `reference_document_chunks` - Chunked content with embeddings

### Embedder (`src/embedder/`)

Local text embedding using HuggingFace Transformers:

- Model: `mixedbread-ai/mxbai-embed-large-v1`
- Local inference (no API calls)
- 1024-dimensional vectors

### MCP Server (`src/mcp/`)

Model Context Protocol server for AI tool integration.

**Tools Exposed:**
- `documents_list_collections` - List available collections
- `documents_search` - Semantic search
- `documents_get_document` - Retrieve full document

**Usage:**
```bash
ctxpkg mcp documents
ctxpkg mcp docs -c my-docs
```

### CLI (`src/cli/`)

Commander.js-based CLI split into modules:

| File | Purpose |
|------|---------|
| `cli.ts` | Main entry, mounts subcommands |
| `cli.collections.ts` | Collection package management |
| `cli.documents.ts` | Document queries |
| `cli.config.ts` | Config management commands |
| `cli.daemon.ts` | Daemon management commands |
| `cli.mcp.ts` | MCP server commands |
| `cli.utils.ts` | Shared formatting utilities |
| `cli.client.ts` | Client factory for CLI commands |

### Service Container (`src/utils/`)

Lightweight dependency injection:

```typescript
const services = new Services();
const db = services.get(DatabaseService);
await services.destroy(); // cleanup
```

## Data Flow

### Collection Sync

```
context.json (project config)
    ↓
CollectionsService.syncCollection()
    ↓
┌─────────────────────────────────┐
│       Resolve Sources           │
├─────────────┬───────────────────┤
│ file type   │ pkg type          │
│ (glob)      │ (manifest/bundle) │
└─────────────┴───────────────────┘
    ↓
Compare with existing documents
    ↓
Add/Update/Remove via DocumentsService
    ↓
Update collection metadata
```

### Semantic Search

```
Query Text
    ↓
EmbedderService.createEmbeddings()
    ↓
Vector Embedding (1024-dim)
    ↓
SQLite vec_distance_L2() query
    ↓
Ranked Results
```

### Client-Backend Communication

```
CLI Command
    ↓
createCliClient() - auto-detects mode
    ↓
BackendClient.connect()
    ↓
┌─────────────────────────────────┐
│       Adapter Selection         │
├───────────┬───────────┬─────────┤
│  Direct   │  Daemon   │ WebSocket│
└───────────┴───────────┴─────────┘
    ↓
Backend.handleRequest()
    ↓
Response → Client
```

## Configuration

Uses `convict` for configuration:

```typescript
{
  database: { path: '~/.local/share/ai-assist/database.sqlite' },
  daemon: { socketPath, pidFile, idleTimeout, autoStart },
  documents: { defaultCollections: [] },
  project: { configFile: 'context.json' }
}
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `commander` | CLI framework |
| `@inquirer/prompts` | Interactive prompts |
| `chalk` | Terminal colors |
| `@modelcontextprotocol/sdk` | MCP server implementation |
| `knex` | SQL query builder |
| `better-sqlite3` | SQLite driver |
| `sqlite-vec` | Vector search extension |
| `@huggingface/transformers` | Local embeddings |
| `convict` | Configuration management |
| `tar` | Bundle creation/extraction |
| `zod` | Schema validation |
| `ws` | WebSocket implementation |

## Extension Points

### Adding New Collections Sources

1. Add new source type to `collections.schemas.ts`
2. Implement resolution in `CollectionsService`
3. Update CLI to accept new source format

### Adding MCP Tools

1. Define tool in `src/tools/` using `defineTool()`
2. Register on MCP server with `registerMcpTools()`
3. Add CLI command in `cli.mcp.ts`

### Adding Backend Methods

1. Add procedure in `backend.services.ts`
2. Add types in `backend.types.ts`
3. Add proxy in `client.ts`

### Adding CLI Commands

1. Create `src/cli/cli.<domain>.ts`
2. Export `create<Domain>Cli(command: Command)`
3. Mount in `cli.ts`
