# Database — Agent Guidelines

This document describes the database module architecture for AI agents working on this codebase.

## Overview

The database module provides SQLite storage with vector search capabilities using [sqlite-vec](https://github.com/asg017/sqlite-vec). It uses [Knex](https://knexjs.org/) for query building and migrations. The database stores collection metadata, reference documents, and vector embeddings for semantic search.

## File Structure

```
src/database/
├── database.ts              # DatabaseService class
└── migrations/
    ├── migrations.ts        # Migration source (collects all migrations)
    ├── migrations.types.ts  # Migration type definition
    └── migrations.001-init.ts  # Initial schema
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    DatabaseService                          │
│                                                             │
│  getInstance() → lazy init, singleton pattern               │
│       │                                                     │
│       ▼                                                     │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                    Knex                             │    │
│  │              (query builder)                        │    │
│  └──────────────────────┬──────────────────────────────┘    │
│                         │                                   │
│  ┌──────────────────────▼──────────────────────────────┐    │
│  │              better-sqlite3                         │    │
│  │         (SQLite driver for Node.js)                 │    │
│  └──────────────────────┬──────────────────────────────┘    │
│                         │                                   │
│  ┌──────────────────────▼──────────────────────────────┐    │
│  │                sqlite-vec                           │    │
│  │      (vector extension, loaded via afterCreate)     │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

## Schema

### `collections`

Tracks synced collection packages:

| Column | Type | Description |
|--------|------|-------------|
| `id` | string (PK) | Collection ID (`file:{hash}` or `pkg:{url}`) |
| `type` | string | `'file'` or `'pkg'` |
| `path` | string? | Local path (file type) |
| `glob` | string? | Glob pattern (file type) |
| `url` | text? | Manifest URL (pkg type) |
| `manifest_hash` | string? | SHA-256 of manifest (pkg type) |
| `last_sync_at` | string? | ISO timestamp of last sync |
| `created_at` | string | ISO timestamp |
| `updated_at` | string | ISO timestamp |

### `reference_documents`

Stores full document content:

| Column | Type | Description |
|--------|------|-------------|
| `collection` | string (PK) | Collection ID |
| `id` | string (PK) | Document ID (e.g., file path) |
| `hash` | string | SHA-256 of content (change detection) |
| `content` | text | Full document content |

### `reference_document_chunks`

Stores document chunks with embeddings:

| Column | Type | Description |
|--------|------|-------------|
| `id` | string (PK) | UUID |
| `collection` | string | Collection ID |
| `document` | string | Parent document ID |
| `content` | text | Chunk text (~500 chars) |
| `embedding` | vector(1024) | Vector embedding |

## Usage

### Getting Database Instance

```typescript
import { DatabaseService, tableNames } from '#root/database/database.ts';

const databaseService = services.get(DatabaseService);
const db = await databaseService.getInstance();

// Query using Knex
const docs = await db(tableNames.referenceDocuments)
  .where({ collection: 'my-collection' })
  .select('*');
```

### Vector Search

sqlite-vec provides `vec_distance_L2()` for Euclidean distance:

```typescript
const results = await db(tableNames.referenceDocumentChunks)
  .select('*', db.raw('vec_distance_L2(?, embedding) as distance', [JSON.stringify(queryVector)]))
  .orderBy('distance', 'asc')
  .limit(10);
```

### Table Names

Always use `tableNames` constant for consistency:

```typescript
import { tableNames } from '#root/database/database.ts';

tableNames.collections           // 'collections'
tableNames.referenceDocuments    // 'reference_documents'
tableNames.referenceDocumentChunks  // 'reference_documentchunks'
```

## Adding Migrations

### 1. Create Migration File

```typescript
// migrations/migrations.002-add-feature.ts
import type { Migration } from './migrations.types.ts';

const addFeature: Migration = {
  name: 'add-feature',
  up: async (knex) => {
    await knex.schema.alterTable('some_table', (table) => {
      table.string('new_column').nullable();
    });
  },
  down: async (knex) => {
    await knex.schema.alterTable('some_table', (table) => {
      table.dropColumn('new_column');
    });
  },
};

export { addFeature };
```

### 2. Register Migration

In `migrations/migrations.ts`:

```typescript
import { init } from './migrations.001-init.ts';
import { addFeature } from './migrations.002-add-feature.ts';

const migrations: Migration[] = [init, addFeature];
```

### 3. Update Table Names (if adding tables)

Export new table names from the migration file and re-export from `migrations.ts`.

## Key Patterns

### Singleton Initialization

Database is lazily initialized on first `getInstance()` call:

```typescript
public getInstance = async () => {
  if (!this.#instance) {
    this.#instance = this.#setup();
  }
  return await this.#instance;
};
```

### sqlite-vec Loading

The extension is loaded via Knex pool's `afterCreate` hook:

```typescript
pool: {
  afterCreate: (conn: Db, done: (err: unknown, conn: Db) => void) => {
    sqliteVec.load(conn);
    done(null, conn);
  },
},
```

### Vector Storage

Embeddings are stored as JSON strings and parsed by sqlite-vec:

```typescript
// Insert
await db(tableNames.referenceDocumentChunks).insert({
  embedding: JSON.stringify(vectorArray),
  // ...
});

// Query
db.raw('vec_distance_L2(?, embedding)', [JSON.stringify(queryVector)])
```

## Configuration

Database path is configured via `database.path` (default: `~/.ai-assist/data.db`).
