# MCP Tools V2 Specification

This document specifies improvements to the MCP server tools to make AI agents more efficient when working with large context bases.

## Overview

The current MCP server exposes three tools for document access:
- `documents_list_collections` — List collections with document counts
- `documents_search` — Hybrid semantic/keyword search
- `documents_get_document` — Get full document content

These tools work but leave efficiency gaps when agents work with large context bases:
1. **Blind searching**: No way to browse what documents exist in a collection
2. **Missing metadata**: Collection descriptions aren't surfaced
3. **Token waste**: Must fetch entire documents even when only a section is needed
4. **Round-trip overhead**: Multiple searches require multiple tool calls

## Goals

1. **Reduce agent round-trips** with batch operations
2. **Enable browsing** before searching with document listings
3. **Surface metadata** so agents can make informed decisions
4. **Support partial retrieval** to reduce token usage
5. **Maintain backward compatibility** with existing tools

## Architecture

### Current Tools (unchanged)

```
┌─────────────────────────────────────────────────────────────┐
│                     Existing Tools                          │
│                                                             │
│  documents_list_collections    documents_search             │
│  documents_get_document                                     │
└─────────────────────────────────────────────────────────────┘
```

### New Tools

```
┌─────────────────────────────────────────────────────────────┐
│                       New Tools                             │
│                                                             │
│  documents_list_documents      List docs in a collection    │
│  documents_get_outline         Get document structure       │
│  documents_get_section         Fetch specific section       │
│  documents_search_batch        Multiple queries at once     │
│  documents_find_related        Find similar content         │
└─────────────────────────────────────────────────────────────┘
```

## Tool Specifications

### 1. Enhanced `documents_list_collections`

**Change**: Enrich return value with manifest metadata already stored in the database.

**Current Return**:
```typescript
{
  collection: string;      // Collection name or alias
  collectionId?: string;   // Full collection ID (if alias used)
  documentCount: number;
}
```

**Enhanced Return**:
```typescript
{
  collection: string;      // Collection name or alias
  collectionId?: string;   // Full collection ID (if alias used)
  documentCount: number;
  description?: string;    // From manifest (NEW)
  version?: string;        // From manifest (NEW)
}
```

**Implementation**: Join `reference_documents` counts with `collections` table metadata.

---

### 2. New: `documents_list_documents`

**Purpose**: List all documents in a collection (table of contents). Enables agents to browse what's available before searching.

**Schema**:
```typescript
{
  collection: z.string().describe('Collection name or alias'),
  limit: z.number().optional().default(100).describe('Maximum documents to return'),
  offset: z.number().optional().default(0).describe('Offset for pagination'),
}
```

**Return**:
```typescript
{
  documents: Array<{
    id: string;           // Document ID (typically file path)
    title: string;        // Extracted from first # heading, or filename
    size: number;         // Character count
  }>;
  total: number;          // Total document count (for pagination)
  hasMore: boolean;       // Whether more documents exist
}
```

**Implementation**:
- Query `reference_documents` table for the collection
- Extract title from content (first `# ` heading or fallback to ID)
- Support pagination for large collections

---

### 3. New: `documents_get_outline`

**Purpose**: Get the heading structure of a document without fetching full content. Helps agents understand document organization and request specific sections.

**Schema**:
```typescript
{
  collection: z.string().describe('Collection name or alias'),
  document: z.string().describe('Document ID'),
  maxDepth: z.number().optional().default(3).describe('Maximum heading depth (1-6)'),
}
```

**Return**:
```typescript
{
  collection: string;
  document: string;
  title: string;              // Document title (# heading)
  outline: Array<{
    level: number;            // Heading level (1-6)
    text: string;             // Heading text
    line: number;             // Line number in document
  }>;
}
```

**Implementation**:
- Fetch document content from database
- Parse markdown headings with regex: `/^(#{1,6})\s+(.+)$/gm`
- Filter by maxDepth
- Include line numbers for reference

---

### 4. New: `documents_get_section`

**Purpose**: Fetch a specific section of a document by heading. Reduces token usage when agents need targeted information.

**Schema**:
```typescript
{
  collection: z.string().describe('Collection name or alias'),
  document: z.string().describe('Document ID'),
  section: z.string().describe('Section heading text to match'),
  includeSubsections: z.boolean().optional().default(true).describe('Include nested subsections'),
}
```

**Return**:
```typescript
{
  collection: string;
  document: string;
  section: string;            // Matched heading
  level: number;              // Heading level
  content: string;            // Section content
  startLine: number;          // Start line in document
  endLine: number;            // End line in document
}
```

**Implementation**:
- Fetch document content
- Find heading matching `section` (case-insensitive substring match)
- Extract content from heading to next heading of same or higher level
- If `includeSubsections: false`, stop at any heading

**Section Extraction Algorithm**:
```
1. Split document into lines
2. Find line matching section heading (case-insensitive)
3. Record heading level N
4. Collect lines until:
   - End of document, OR
   - Heading of level <= N (if includeSubsections: true), OR
   - Any heading (if includeSubsections: false)
5. Return collected content
```

---

### 5. New: `documents_search_batch`

**Purpose**: Execute multiple search queries in a single call. Reduces round-trips when agents need to research multiple concepts.

**Schema**:
```typescript
{
  queries: z.array(z.object({
    query: z.string().describe('Search query'),
    collections: z.array(z.string()).optional().describe('Limit to specific collections'),
  })).min(1).max(10).describe('Array of search queries (max 10)'),
  limit: z.number().optional().default(5).describe('Results per query'),
  maxDistance: z.number().optional().describe('Maximum distance threshold per query'),
  hybridSearch: z.boolean().optional().default(true).describe('Use hybrid search'),
}
```

**Return**:
```typescript
{
  results: Array<{
    query: string;
    results: Array<SearchChunkItem>;  // Same as documents_search
  }>;
}
```

**Implementation**:
- Iterate through queries, calling existing search logic
- Share embedding model instance across queries
- Consider parallel execution (but respect rate limits)

---

### 6. New: `documents_find_related`

**Purpose**: Find documents or chunks semantically related to a given document or chunk. Useful for expanding context.

**Schema**:
```typescript
{
  collection: z.string().describe('Collection containing the source'),
  document: z.string().describe('Document ID to find related content for'),
  chunk: z.string().optional().describe('Specific chunk content (if not provided, uses document centroid)'),
  limit: z.number().optional().default(5).describe('Maximum related items'),
  sameDocument: z.boolean().optional().default(false).describe('Include chunks from the same document'),
}
```

**Return**:
```typescript
{
  source: {
    collection: string;
    document: string;
  };
  related: Array<{
    collection: string;
    document: string;
    content: string;
    relevanceScore: number;
  }>;
}
```

**Implementation**:
- If `chunk` provided: embed that chunk and search
- If no `chunk`: compute centroid of document's chunk embeddings
- Search using the embedding, excluding source document unless `sameDocument: true`

---

### 7. Enhanced Search Results (all search tools)

**Current Result Fields**:
```typescript
{
  collection: string;
  collectionId?: string;
  documentId: string;
  content: string;
  relevanceScore: number;
  distance: number;
}
```

**Enhanced Result Fields**:
```typescript
{
  collection: string;
  collectionId?: string;
  documentId: string;
  documentTitle: string;      // NEW: Extracted document title
  sectionHeading?: string;    // NEW: Nearest preceding heading
  content: string;
  relevanceScore: number;
  distance: number;
  chunkIndex?: number;        // NEW: Position in document (1-indexed)
  totalChunks?: number;       // NEW: Total chunks in document
}
```

**Implementation**:
- Store document title in chunks table (already done for embedding context)
- Store section heading in chunks table (already done for embedding context)
- Add chunk index and count query

## Backend Changes

### Database Schema

No schema changes required. Existing tables have necessary data:

- `collections` — Has `name`, `version`, `description`
- `reference_documents` — Has `content`
- `reference_document_chunks` — Has `content` (with embedded context)

### New Service Methods

Add to `DocumentsService`:

```typescript
// List documents in a collection
listDocuments(collection: string, options?: { limit?: number; offset?: number }): Promise<{
  documents: Array<{ id: string; title: string; size: number }>;
  total: number;
}>;

// Get document outline
getDocumentOutline(collection: string, document: string, maxDepth?: number): Promise<{
  title: string;
  outline: Array<{ level: number; text: string; line: number }>;
} | null>;

// Get document section
getDocumentSection(collection: string, document: string, section: string, includeSubsections?: boolean): Promise<{
  section: string;
  level: number;
  content: string;
  startLine: number;
  endLine: number;
} | null>;

// Find related content
findRelated(collection: string, document: string, options?: {
  chunk?: string;
  limit?: number;
  sameDocument?: boolean;
}): Promise<Array<SearchChunkItem>>;
```

### New Backend Procedures

Add to `createBackendServices`:

```typescript
documents: {
  // ... existing procedures ...
  
  listDocuments: procedure(listDocumentsParamsSchema, async (params) => {
    const docService = services.get(DocumentsService);
    return docService.listDocuments(params.collection, params);
  }),

  getOutline: procedure(getOutlineParamsSchema, async (params) => {
    const docService = services.get(DocumentsService);
    return docService.getDocumentOutline(params.collection, params.document, params.maxDepth);
  }),

  getSection: procedure(getSectionParamsSchema, async (params) => {
    const docService = services.get(DocumentsService);
    return docService.getDocumentSection(
      params.collection, 
      params.document, 
      params.section,
      params.includeSubsections,
    );
  }),

  findRelated: procedure(findRelatedParamsSchema, async (params) => {
    const docService = services.get(DocumentsService);
    return docService.findRelated(params.collection, params.document, params);
  }),

  searchBatch: procedure(searchBatchParamsSchema, async (params) => {
    const docService = services.get(DocumentsService);
    const results = [];
    for (const q of params.queries) {
      const searchResults = await docService.search({
        query: q.query,
        collections: q.collections,
        limit: params.limit,
        maxDistance: params.maxDistance,
        hybridSearch: params.hybridSearch,
      });
      results.push({ query: q.query, results: searchResults });
    }
    return { results };
  }),
}
```

### Client Updates

Add methods to `BackendClient.documents`:

```typescript
documents: {
  // ... existing methods ...
  
  listDocuments(params: ListDocumentsParams): Promise<ListDocumentsResult>;
  getOutline(params: GetOutlineParams): Promise<OutlineResult | null>;
  getSection(params: GetSectionParams): Promise<SectionResult | null>;
  findRelated(params: FindRelatedParams): Promise<SearchChunkItem[]>;
  searchBatch(params: SearchBatchParams): Promise<SearchBatchResult>;
}
```

## Tool Implementation

### File Changes

```
src/tools/documents/
├── documents.ts           # Update existing tools, add new tools
└── documents.helpers.ts   # NEW: Helper functions for outline/section parsing
```

### New Tool Definitions

Add to `createDocumentToolDefinitions`:

```typescript
const listDocuments = defineTool({
  name: 'documents_list_documents',
  description: 
    'List all documents in a collection. Returns document IDs, titles, and sizes. ' +
    'Use this to browse what documentation is available before searching. ' +
    'Supports pagination for large collections.',
  schema: listDocumentsSchema,
  handler: async ({ collection, limit, offset }) => {
    const resolved = resolveCollection(collection, aliasMap);
    const result = await client.documents.listDocuments({ 
      collection: resolved, 
      limit, 
      offset 
    });
    return {
      ...result,
      collection: idToAlias.get(resolved) ?? resolved,
    };
  },
});

const getOutline = defineTool({
  name: 'documents_get_outline',
  description:
    'Get the heading structure of a document. Returns section headings with their levels ' +
    'and line numbers. Use this to understand document organization before reading specific sections.',
  schema: getOutlineSchema,
  handler: async ({ collection, document, maxDepth }) => {
    const resolved = resolveCollection(collection, aliasMap);
    const result = await client.documents.getOutline({ 
      collection: resolved, 
      document, 
      maxDepth 
    });
    if (!result) {
      return `Document "${document}" not found in collection "${collection}".`;
    }
    return {
      collection: idToAlias.get(resolved) ?? resolved,
      document,
      ...result,
    };
  },
});

const getSection = defineTool({
  name: 'documents_get_section',
  description:
    'Get a specific section of a document by heading. Returns the section content without ' +
    'fetching the entire document. Use this when you know which section you need.',
  schema: getSectionSchema,
  handler: async ({ collection, document, section, includeSubsections }) => {
    const resolved = resolveCollection(collection, aliasMap);
    const result = await client.documents.getSection({ 
      collection: resolved, 
      document, 
      section,
      includeSubsections,
    });
    if (!result) {
      return `Section "${section}" not found in document "${document}".`;
    }
    return {
      collection: idToAlias.get(resolved) ?? resolved,
      document,
      ...result,
    };
  },
});

const searchBatch = defineTool({
  name: 'documents_search_batch',
  description:
    'Execute multiple search queries in a single call. More efficient than making ' +
    'separate search calls when researching multiple topics. Limited to 10 queries.',
  schema: searchBatchSchema,
  handler: async ({ queries, limit, maxDistance, hybridSearch }) => {
    const resolvedQueries = queries.map(q => ({
      query: q.query,
      collections: resolveCollections(q.collections, aliasMap),
    }));
    const result = await client.documents.searchBatch({
      queries: resolvedQueries,
      limit,
      maxDistance,
      hybridSearch,
    });
    // Map collection IDs back to aliases in results
    return {
      results: result.results.map(r => ({
        query: r.query,
        results: r.results.map(item => ({
          ...item,
          collection: idToAlias.get(item.collection) ?? item.collection,
        })),
      })),
    };
  },
});

const findRelated = defineTool({
  name: 'documents_find_related',
  description:
    'Find content semantically related to a document or chunk. Use this to expand context ' +
    'or discover related documentation on a topic.',
  schema: findRelatedSchema,
  handler: async ({ collection, document, chunk, limit, sameDocument }) => {
    const resolved = resolveCollection(collection, aliasMap);
    const results = await client.documents.findRelated({
      collection: resolved,
      document,
      chunk,
      limit,
      sameDocument,
    });
    return {
      source: { 
        collection: idToAlias.get(resolved) ?? resolved, 
        document 
      },
      related: results.map(r => ({
        ...r,
        collection: idToAlias.get(r.collection) ?? r.collection,
      })),
    };
  },
});
```

## Implementation Plan

### Phase 1: Backend Service Methods

1. Add `listDocuments` to `DocumentsService`
2. Add `getDocumentOutline` to `DocumentsService`
3. Add `getDocumentSection` to `DocumentsService`
4. Add helper functions for markdown parsing
5. Add backend procedure registrations
6. Add Zod schemas for new endpoints

### Phase 2: Client Updates

1. Add client methods for new endpoints
2. Add TypeScript types for params/results

### Phase 3: Tool Definitions

1. Create `documents.helpers.ts` for shared utilities
2. Add new tool definitions to `documents.ts`
3. Update `documents_list_collections` to include metadata
4. Enhance search result formatting

### Phase 4: Batch and Related

1. Add `searchBatch` to service and client
2. Add `findRelated` to service and client
3. Add corresponding tool definitions

### Phase 5: Testing

1. Add unit tests for new service methods
2. Add unit tests for markdown parsing helpers
3. Add integration tests for new tools
4. Manual testing with MCP client

### Phase 6: Documentation

1. Update `src/mcp/AGENTS.md` with new tools
2. Update `src/tools/AGENTS.md` with new patterns
3. Update `README.md` if needed

## Backward Compatibility

- All existing tools remain unchanged in interface
- Enhanced return fields are additive (optional new fields)
- No breaking changes to existing consumers

## Performance Considerations

### Caching

- Document title extraction can be cached in the chunks table
- Section heading already stored during chunking
- Consider caching outlines for frequently accessed documents

### Batch Search

- Queries execute sequentially to avoid overwhelming the embedding model
- Could parallelize with worker pool in future if needed
- Limit of 10 queries prevents abuse

### Large Documents

- `listDocuments` pagination prevents memory issues
- `getSection` extracts only needed content
- Outline parsing is O(n) single pass

## Future Enhancements

Not in scope for this iteration, but potential future work:

1. **Streaming section retrieval**: Stream large sections chunk by chunk
2. **Cross-collection related**: Find related across all collections
3. **Section search**: Search within a specific document section
4. **Cached outlines**: Store parsed outlines in database
5. **Document summaries**: AI-generated document summaries
6. **Smart chunking**: Section-aware chunking for better retrieval

## Testing Checklist

- [ ] `documents_list_collections` returns description and version
- [ ] `documents_list_documents` lists all docs with titles
- [ ] `documents_list_documents` pagination works correctly
- [ ] `documents_get_outline` returns heading structure
- [ ] `documents_get_outline` respects maxDepth
- [ ] `documents_get_section` extracts correct content
- [ ] `documents_get_section` handles missing sections gracefully
- [ ] `documents_get_section` respects includeSubsections
- [ ] `documents_search_batch` executes multiple queries
- [ ] `documents_search_batch` respects query limit (10)
- [ ] `documents_find_related` finds semantically similar content
- [ ] `documents_find_related` excludes source document by default
- [ ] All tools resolve aliases correctly
- [ ] All tools return helpful messages for not-found cases
- [ ] MCP server exposes all new tools
- [ ] Existing tools continue working unchanged
