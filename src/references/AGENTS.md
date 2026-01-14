# References — Agent Guidelines

This document describes the references module architecture for AI agents working on this codebase.

## Overview

The references module handles document storage, chunking, embedding, and semantic search. It's the core indexing engine that makes context searchable. Documents are split into chunks, embedded as vectors, and stored in SQLite with sqlite-vec for vector similarity search.

## File Structure

| File | Purpose |
|------|---------|
| `references.ts` | `ReferencesService` — document CRUD, chunking, embedding, search |
| `references.schemas.ts` | Zod schemas for documents, search options, results |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   ReferencesService                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  updateDocument()                                           │
│       │                                                     │
│       ▼                                                     │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐      │
│  │  Hash Check │───▶│   Chunker   │───▶│  Embedder   │      │
│  │ (skip if    │    │ (split into │    │ (vectorize  │      │
│  │  unchanged) │    │  ~500 char) │    │  chunks)    │      │
│  └─────────────┘    └─────────────┘    └─────────────┘      │
│                                               │             │
│                                               ▼             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                    Database                          │   │
│  │  ┌────────────────────┐  ┌────────────────────────┐  │   │
│  │  │ reference_documents│  │reference_document_chunks│  │   │
│  │  │ (collection, id,   │  │ (collection, document, │  │   │
│  │  │  content, hash)    │  │  content, embedding)   │  │   │
│  │  └────────────────────┘  └────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  search()                                                   │
│       │                                                     │
│       ▼                                                     │
│  ┌─────────────┐    ┌─────────────────────────────────┐     │
│  │  Embedder   │───▶│  vec_distance_L2() via sqlite-vec│    │
│  │ (vectorize  │    │  (find nearest chunks)          │     │
│  │  query)     │    └─────────────────────────────────┘     │
│  └─────────────┘                                            │
└─────────────────────────────────────────────────────────────┘
```

## Data Model

### Documents

```typescript
type ReferenceDocument = {
  collection: string;  // Collection ID (e.g., "file:abc123" or "pkg:https://...")
  id: string;          // Document ID within collection (e.g., "intro.md")
  content: string;     // Full document content
};
```

Documents are stored with a SHA-256 hash of content for change detection.

### Chunks

Documents are split into chunks (~500 characters) using LangChain's `RecursiveCharacterTextSplitter` with markdown awareness. Each chunk gets:

- `id`: UUID
- `collection`: Parent collection
- `document`: Parent document ID
- `content`: Chunk text
- `embedding`: Vector embedding (JSON-encoded float array)

### Search Results

```typescript
type SearchChunkItem = {
  document: string;    // Document ID
  collection: string;  // Collection ID
  content: string;     // Chunk content
  distance: number;    // L2 distance (lower = more similar)
};
```

## Document Lifecycle

### Insert/Update

1. Compute SHA-256 hash of content
2. Check if document exists with same hash → skip if unchanged
3. If updating, delete existing chunks
4. Insert/update document record
5. Split content into chunks
6. Generate embeddings for all chunks
7. Insert chunk records with embeddings

### Delete

Deletes both the document record and all associated chunks (in a transaction).

## Key Operations

### `updateDocument(doc)`

Upserts a document, re-chunking and re-embedding only if content changed.

### `search({ query, collections?, limit })`

1. Embed the query string
2. Query chunks using `vec_distance_L2()` 
3. Optionally filter by collection(s)
4. Return top N results sorted by distance

### `getDocumentIds(collection)`

Returns all document IDs and hashes in a collection — used by sync logic to compute diffs.

### `deleteDocuments(collection, ids)`

Batch delete multiple documents and their chunks.

## Dependencies

- **DatabaseService**: SQLite with sqlite-vec extension
- **EmbedderService**: Generates vector embeddings (e.g., OpenAI, local model)

## Key Patterns

### Change Detection

Content hashing avoids re-processing unchanged documents:

```typescript
const hash = createHash('sha256').update(content).digest('hex');
if (current && current.hash === hash) {
  return; // Skip - content unchanged
}
```

### Transaction Safety

Document and chunk operations use transactions to maintain consistency:

```typescript
await database.transaction(async (trx) => {
  await trx(tableNames.referenceDocumentChunks).delete()...
  await trx(tableNames.referenceDocuments).update()...
  await trx(tableNames.referenceDocumentChunks).insert()...
});
```

### Vector Search

sqlite-vec provides `vec_distance_L2()` for Euclidean distance:

```typescript
database.raw('vec_distance_L2(?, embedding) as distance', [JSON.stringify(queryEmbedding)])
```

Lower distance = more semantically similar.
