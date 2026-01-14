# Architecture

This document describes the architecture and design of `mortens-ai-assist`.

## Overview

The project is a TypeScript CLI application that provides:

1. An AI chat assistant with tool access (files, git)
2. A reference document system with semantic search
3. Configuration management
4. A daemon mode for persistent backend services

## Directory Structure

```
src/
├── agent/           # LangChain agent creation
├── backend/         # Backend service layer and protocol
├── cli/             # CLI command definitions
├── client/          # Backend client with multiple adapters
├── config/          # Configuration management (convict)
├── daemon/          # Daemon server and manager
├── database/        # SQLite database with migrations
├── embedder/        # Text embedding service
├── interact/        # Interactive chat session
├── references/      # Reference document management
├── tools/           # Agent tools (files, git, references)
└── utils/           # Shared utilities (service container)

bin/
├── cli.js           # CLI entry point
└── daemon.js        # Daemon entry point
```

## Core Components

### Backend (`src/backend/`)

The backend provides a protocol-agnostic service layer that can run in-process or as a daemon.

**Files:**
- `backend.ts` - Main Backend class, handles request routing
- `backend.protocol.ts` - JSON-RPC inspired protocol definitions
- `backend.services.ts` - Service procedure definitions
- `backend.types.ts` - Shared type definitions for backend API
- `backend.schemas.ts` - Zod schemas for validation

**Architecture:**
```
Request (JSON-RPC style)
    ↓
Backend.handleRequest()
    ↓
Route to service.method
    ↓
Validate params with Zod
    ↓
Execute handler
    ↓
Response (result or error)
```

**Adding new backend methods:**
1. Define the procedure in `backend.services.ts` using `procedure(schema, handler)`
2. Add the type definition to `backend.types.ts`
3. Types are automatically available in the client

### Daemon (`src/daemon/`)

The daemon runs the backend as a persistent process, accessible via Unix socket.

**Files:**
- `daemon.ts` - Main Daemon class with WebSocket server
- `daemon.manager.ts` - Client-side daemon lifecycle management
- `daemon.config.ts` - Socket paths and configuration
- `daemon.schemas.ts` - Status and options schemas

**Features:**
- WebSocket server over Unix socket
- Auto-shutdown after 5 minutes idle (configurable)
- PID file for process management
- Graceful shutdown handling

**CLI Commands:**
```bash
ai-assist daemon start    # Start the daemon
ai-assist daemon stop     # Stop the daemon
ai-assist daemon status   # Show daemon status
ai-assist daemon restart  # Restart the daemon
```

### Client (`src/client/`)

Unified client for interacting with the backend, with multiple connection modes.

**Files:**
- `client.ts` - BackendClient class
- `client.adapters.ts` - DirectAdapter, DaemonAdapter, WebSocketAdapter
- `client.types.ts` - Re-exports backend types for client use

**Connection Modes:**
- `direct` - In-process backend (no daemon)
- `daemon` - Connect via Unix socket to daemon
- `websocket` - Connect via remote WebSocket

**Usage:**
```typescript
import { BackendClient } from '#root/client/client.ts';

// Direct mode (in-process)
const client = new BackendClient({ mode: 'direct' });
await client.connect();

// Daemon mode (auto-starts if needed)
const client = new BackendClient({ mode: 'daemon', autoStartDaemon: true });
await client.connect();

// Type-safe API calls
const collections = await client.references.listCollections();
const results = await client.references.search({ query: 'hello', limit: 10 });

await client.disconnect();
```

### Service Container (`src/utils/utils.services.ts`)

A lightweight dependency injection container that:

- Lazily instantiates services on first access
- Manages service lifecycle with a `destroy` symbol
- Enables service mocking for tests

```typescript
const services = new Services();
const db = services.get(DatabaseService);
// ... use services
await services.destroy(); // cleanup
```

### Database (`src/database/`)

SQLite database using Knex query builder with:

- `better-sqlite3` driver for performance
- `sqlite-vec` extension for vector operations
- Migration system in `migrations/`

**Tables:**
- `reference_documents` - Document metadata and content
- `reference_document_chunks` - Chunked content with embeddings

### Embedder (`src/embedder/embedder.ts`)

Generates text embeddings using HuggingFace Transformers:

- Model: `mixedbread-ai/mxbai-embed-large-v1`
- Local inference (no API calls)
- Used for semantic search in reference documents

### Agent (`src/agent/agent.ts`)

Creates LangChain ReAct agents with:

- OpenAI-compatible chat models
- Configurable tools
- System prompts

### Tools (`src/tools/`)

Agent tools organized by domain:

**File Tools** (`tools/files/files.ts`):
- `file_get_content` - Read file contents
- `file_glob_files` - Find files by pattern
- `file_search_multiline` - Regex search in files
- `file_get_stats` - File metadata

**Git Tools** (`tools/git/git.ts`):
- `git_status` - Repository status
- `git_get_diff` - Show diffs
- `git_get_log` - Commit history

**Reference Tools** (`tools/references/references.ts`):
- `references_list_collections` - List available document collections
- `references_search` - Semantic search across reference documents
- `references_get_document` - Retrieve full document content

> Note: Reference tools use a `BackendClient` instance and are created via `createReferenceTools(client)`.

### References (`src/references/`)

Document management with semantic search:

- Documents organized into collections
- Content chunked using `RecursiveCharacterTextSplitter`
- Chunks embedded and stored with vectors
- Search uses L2 distance for similarity

### CLI (`src/cli/`)

Commander.js-based CLI split into modules:

| File | Purpose |
|------|---------|
| `cli.ts` | Main entry, mounts subcommands |
| `cli.utils.ts` | Shared formatting utilities |
| `cli.client.ts` | Client factory for CLI commands |
| `cli.config.ts` | Config management commands |
| `cli.daemon.ts` | Daemon management commands |
| `cli.interact.ts` | Chat/prompt commands |
| `cli.references.ts` | Reference document commands |

## Data Flow

### Client-Backend Communication

```
CLI Command
    ↓
createCliClient() - auto-detects daemon or direct mode
    ↓
BackendClient.connect()
    ↓
┌─────────────────────────────────────────┐
│            Adapter Selection            │
├─────────────┬─────────────┬─────────────┤
│   Direct    │   Daemon    │  WebSocket  │
│ (in-process)│(Unix socket)│  (remote)   │
└─────────────┴─────────────┴─────────────┘
    ↓
Backend.handleRequest()
    ↓
Service Method Execution
    ↓
Response → Client
```

### Chat Session

```
User Input
    ↓
startSession() (interact.ts)
    ↓
createCliClient() → BackendClient
    ↓
createDefaultAgent(client) → createAgent() (agent.ts)
    ↓
ChatOpenAI + Tools (including reference tools via client)
    ↓
agent.stream() → Response
```

### Reference Search

```
Query Text
    ↓
BackendClient.references.search()
    ↓
Backend → ReferencesService.search()
    ↓
EmbedderService.createEmbeddings()
    ↓
Vector Embedding
    ↓
SQLite vec_distance_L2() query
    ↓
Ranked Results
```

### Document Indexing

```
Glob Pattern
    ↓
Read Files
    ↓
RecursiveCharacterTextSplitter
    ↓
Chunks
    ↓
EmbedderService.createEmbeddings()
    ↓
Store in SQLite (document + chunks)
```

## Configuration

Uses `convict` for configuration with:

- Schema validation
- Environment variable support
- Sensitive value redaction
- File persistence

**Schema** (`src/config/config.ts`):
```typescript
{
  openai: {
    apiKey: { sensitive: true, env: 'OPENAI_API_KEY' },
    baseUrl: { env: 'OPENAI_BASE_URL' },
    model: { env: 'OPENAI_MODEL' },
    temperature: { default: 0 }
  }
}
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `commander` | CLI framework |
| `@inquirer/prompts` | Interactive prompts |
| `chalk` | Terminal colors |
| `langchain` | AI agent framework |
| `@langchain/openai` | OpenAI integration |
| `knex` | SQL query builder |
| `better-sqlite3` | SQLite driver |
| `sqlite-vec` | Vector search extension |
| `@huggingface/transformers` | Local embeddings |
| `convict` | Configuration management |
| `simple-git` | Git operations |
| `zod` | Schema validation |
| `ws` | WebSocket implementation |

## Extension Points

### Adding New Backend Methods

1. Add procedure to `src/backend/backend.services.ts`:
   ```typescript
   const myService = {
     myMethod: procedure(mySchema, async (params) => {
       // implementation
       return result;
     }),
   };
   ```

2. Add types to `src/backend/backend.types.ts`:
   ```typescript
   export type MyServiceAPI = {
     myMethod(params: MyParams): Promise<MyResult>;
   };
   ```

3. Update `BackendAPI` type and add proxy in `client.ts`
4. Types are automatically available in the client

### Adding New Tools

1. Create tool file in `src/tools/<domain>/`
2. Define tools using `langchain`'s `tool()` helper
3. Export tool collection
4. Add to agent in `src/interact/interact.ts`

### Adding CLI Commands

1. Create `src/cli/cli.<domain>.ts`
2. Export `create<Domain>Cli(command: Command)` function
3. Use utilities from `cli.utils.ts`
4. Mount in `cli.ts`

### Adding Services

1. Create service class with constructor accepting `Services`
2. Optionally implement `[destroy]` for cleanup
3. Access via `services.get(MyService)`
