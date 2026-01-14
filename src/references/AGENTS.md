# References — Agent Guidelines

This document describes the references module architecture for AI agents working on this codebase.

## Overview

The references module handles document storage, chunking, embedding, and semantic search. It's the core indexing engine that makes context searchable. Documents are split into chunks, embedded as vectors, and stored in SQLite with sqlite-vec for vector similarity search. The module uses hybrid search combining vector similarity with FTS5 keyword matching for improved retrieval quality.

## File Structure

| File | Purpose |
|------|---------|
| `references.ts` | `ReferencesService` — document CRUD, chunking, embedding, hybrid search |
| `references.schemas.ts` | Zod schemas for documents, search options, results |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                   ReferencesService                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  updateDocument()                                               │
│       │                                                         │
│       ▼                                                         │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐          │
│  │  Hash Check │───▶│   Chunker   │───▶│  Context    │          │
│  │ (skip if    │    │ (1000 char, │    │  Prepend    │          │
│  │  unchanged) │    │  200 overlap)│   │  (title,    │          │
│  └─────────────┘    └─────────────┘    │  section)   │          │
│                                        └──────┬──────┘          │
│                                               │                 │
│                                               ▼                 │
│                                        ┌─────────────┐          │
│                                        │  Embedder   │          │
│                                        │ (document   │          │
│                                        │  embedding) │          │
│                                        └──────┬──────┘          │
│                                               │                 │
│                                               ▼                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    Database                              │   │
│  │  ┌────────────────────┐  ┌────────────────────────────┐  │   │
│  │  │ reference_documents│  │ reference_document_chunks  │  │   │
│  │  │ (collection, id,   │  │ (collection, document,     │  │   │
│  │  │  content, hash)    │  │  content, embedding)       │  │   │
│  │  └────────────────────┘  └────────────────────────────┘  │   │
│  │                          ┌────────────────────────────┐  │   │
│  │                          │reference_documentchunks_fts│  │   │
│  │                          │ (FTS5 for keyword search)  │  │   │
│  │                          └────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  search()                                                       │
│       │                                                         │
│       ▼                                                         │
│  ┌─────────────┐    ┌───────────────────────────────────────┐   │
│  │  Embedder   │───▶│  Hybrid Search                        │   │
│  │ (query      │    │  ┌─────────────┐  ┌─────────────────┐ │   │
│  │  embedding  │    │  │Vector Search│  │ FTS5 Keyword    │ │   │
│  │  with       │    │  │(cosine dist)│  │ Search          │ │   │
│  │  instruction│    │  └──────┬──────┘  └────────┬────────┘ │   │
│  │  prefix)    │    │         │                  │          │   │
│  └─────────────┘    │         └────────┬─────────┘          │   │
│                     │                  ▼                    │   │
│                     │         ┌─────────────────┐           │   │
│                     │         │ RRF Merge       │           │   │
│                     │         │ (reciprocal     │           │   │
│                     │         │  rank fusion)   │           │   │
│                     │         └────────┬────────┘           │   │
│                     │                  ▼                    │   │
│                     │         ┌─────────────────┐           │   │
│                     │         │ Re-rank         │           │   │
│                     │         │ (optional)      │           │   │
│                     │         └─────────────────┘           │   │
│                     └───────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
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

Documents are split into chunks using LangChain's `RecursiveCharacterTextSplitter` with markdown awareness:

- **Chunk size**: 1000 characters (for better semantic context)
- **Chunk overlap**: 200 characters (to preserve context at boundaries)
- **Context prepending**: Each chunk is embedded with document title and section heading for improved retrieval

Each chunk record contains:

- `id`: UUID
- `collection`: Parent collection
- `document`: Parent document ID
- `content`: Original chunk text (without context prefix)
- `embedding`: Vector embedding (JSON-encoded float array, 1024 dimensions)

Chunks are also indexed in an FTS5 table for keyword search.

### Search Options

```typescript
type SearchChunksOptions = {
  query: string;           // Search query
  collections?: string[];  // Filter by collection(s)
  limit?: number;          // Max results (default: 10)
  maxDistance?: number;    // Filter out poor matches (0-2 for cosine)
  hybridSearch?: boolean;  // Combine vector + keyword search (default: true)
  rerank?: boolean;        // Re-rank with secondary model (default: false)
};
```

### Search Results

```typescript
type SearchChunkItem = {
  id: string;          // Chunk ID
  document: string;    // Document ID
  collection: string;  // Collection ID
  content: string;     // Chunk content
  distance: number;    // Cosine distance (lower = more similar)
  score?: number;      // Combined score after hybrid/rerank (higher = better)
};
```

## Document Lifecycle

### Insert/Update

1. Compute SHA-256 hash of content
2. Check if document exists with same hash → skip if unchanged
3. If updating, delete existing chunks (vector + FTS)
4. Insert/update document record
5. Split content into chunks (1000 chars, 200 overlap)
6. Extract document title and section headings
7. Prepend context to each chunk for embedding
8. Generate embeddings using document embedding method
9. Insert chunk records with embeddings
10. Insert into FTS5 table for keyword search

### Delete

Deletes the document record and all associated chunks from both vector and FTS tables (in a transaction).

## Key Operations

### `updateDocument(doc)`

Upserts a document, re-chunking and re-embedding only if content changed. Uses contextualized embeddings for better retrieval.

### `search({ query, collections?, limit, maxDistance?, hybridSearch?, rerank? })`

1. Embed the query with instruction prefix ("Represent this sentence for searching relevant passages: ")
2. **Vector search**: Query chunks using `vec_distance_cosine()` 
3. **Keyword search** (if hybridSearch=true): Query FTS5 table
4. **Merge results** using Reciprocal Rank Fusion (RRF)
5. **Re-rank** (if rerank=true): Use secondary model for precision
6. Filter by maxDistance threshold
7. Return top N results sorted by score/distance

### `getDocumentIds(collection)`

Returns all document IDs and hashes in a collection — used by sync logic to compute diffs.

### `deleteDocuments(collection, ids)`

Batch delete multiple documents and their chunks from all tables.

## Dependencies

- **DatabaseService**: SQLite with sqlite-vec extension
- **EmbedderService**: Generates vector embeddings with instruction-based methods:
  - `createDocumentEmbeddings()` — for indexing documents
  - `createQueryEmbedding()` — for search queries (with instruction prefix)

## Search Quality Features

### Instruction-Based Embeddings

Different embedding strategies for documents vs queries improves retrieval:

```typescript
// Documents: embedded as-is
await embedder.createDocumentEmbeddings(chunks);

// Queries: embedded with instruction prefix
await embedder.createQueryEmbedding(query);
// → "Represent this sentence for searching relevant passages: {query}"
```

### Context Prepending

Each chunk is embedded with document context for better semantic understanding:

```
Document: {title}
Section: {nearest heading}

{chunk content}
```

The original content (without prefix) is stored for display.

### Hybrid Search with RRF

Combines vector similarity and keyword matching:

```typescript
// Vector results ranked by cosine distance
// Keyword results ranked by FTS5 BM25 score
// Merged using Reciprocal Rank Fusion:
const rrfScore = 1 / (k + rank);  // k=60
```

This catches both semantic matches and exact keyword matches.

### Re-ranking

Optional second-pass ranking using a lightweight model (`all-MiniLM-L6-v2`) for higher precision on top candidates.

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

Document and chunk operations use transactions to maintain consistency across all tables:

```typescript
await database.transaction(async (trx) => {
  await trx(tableNames.referenceDocumentChunks).delete()...
  await trx(tableNames.referenceDocumentChunksFts).delete()...
  await trx(tableNames.referenceDocuments).update()...
  await trx(tableNames.referenceDocumentChunks).insert()...
  await trx(tableNames.referenceDocumentChunksFts).insert()...
});
```

### Vector Search

sqlite-vec provides `vec_distance_cosine()` for cosine distance:

```typescript
database.raw('vec_distance_cosine(?, embedding) as distance', [JSON.stringify(queryEmbedding)])
```

Lower distance = more semantically similar (0 = identical, 2 = opposite).

## Migration Notes

When upgrading from the previous implementation:

1. Run database migrations to create the FTS5 table
2. Re-index existing collections to benefit from:
   - Larger chunks with overlap
   - Context-prepended embeddings
   - FTS5 keyword indexing
