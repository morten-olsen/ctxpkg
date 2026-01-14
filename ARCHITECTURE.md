# Architecture

This document describes the architecture and design of `mortens-ai-assist`.

## Overview

The project is a TypeScript CLI application that provides:

1. An AI chat assistant with tool access (files, git)
2. A reference document system with semantic search
3. Configuration management

## Directory Structure

```
src/
├── agent/           # LangChain agent creation
├── cli/             # CLI command definitions
├── config/          # Configuration management (convict)
├── database/        # SQLite database with migrations
├── embedder/        # Text embedding service
├── interact/        # Interactive chat session
├── references/      # Reference document management
├── tools/           # Agent tools (files, git)
└── utils/           # Shared utilities (service container)

bin/
└── cli.js           # CLI entry point
```

## Core Components

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

> Note: Reference tools require a `Services` instance and are created via `createReferenceTools(services)`.

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
| `cli.config.ts` | Config management commands |
| `cli.interact.ts` | Chat/prompt commands |
| `cli.references.ts` | Reference document commands |

## Data Flow

### Chat Session

```
User Input
    ↓
startSession() (interact.ts)
    ↓
createDefaultAgent() → createAgent() (agent.ts)
    ↓
ChatOpenAI + Tools
    ↓
agent.stream() → Response
```

### Reference Search

```
Query Text
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

## Extension Points

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
