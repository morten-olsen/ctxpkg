import * as z from 'zod';

import type { BackendClient } from '../../client/client.js';
import { defineTool, type ToolDefinitions } from '../tools.types.js';
import { toLangchainTools } from '../tools.langchain.js';

type DocumentToolOptions = {
  /** Backend client for API calls */
  client: BackendClient;
  /** Optional map of alias names to collection IDs for resolving project-local aliases */
  aliasMap?: Map<string, string>;
};

/**
 * Resolve collection names to IDs, supporting both direct IDs and aliases.
 */
const resolveCollections = (
  collections: string[] | undefined,
  aliasMap: Map<string, string> | undefined,
): string[] | undefined => {
  if (!collections || collections.length === 0) {
    return undefined;
  }
  if (!aliasMap || aliasMap.size === 0) {
    return collections;
  }
  return collections.map((c) => aliasMap.get(c) ?? c);
};

/**
 * Resolve a single collection name to ID, supporting both direct IDs and aliases.
 */
const resolveCollection = (collection: string, aliasMap: Map<string, string> | undefined): string => {
  if (!aliasMap) {
    return collection;
  }
  return aliasMap.get(collection) ?? collection;
};

/**
 * Creates document tool definitions that use the provided BackendClient.
 * These tools provide read-only access to the semantic index.
 *
 * Returns common tool definitions that can be converted to Langchain or MCP tools.
 *
 * @param options - Configuration options
 * @param options.client - BackendClient for API calls
 * @param options.aliasMap - Optional map of project aliases to collection IDs
 */
const createDocumentToolDefinitions = (options: DocumentToolOptions): ToolDefinitions => {
  const { client, aliasMap } = options;
  // Build reverse map for showing aliases in results
  const idToAlias = new Map<string, string>();
  if (aliasMap) {
    for (const [alias, id] of aliasMap.entries()) {
      idToAlias.set(id, alias);
    }
  }

  const listCollections = defineTool({
    name: 'documents_list_collections',
    description:
      'List all available document collections. Returns collection names/aliases, document counts, descriptions, and versions. Use this to discover what documentation is available before searching.',
    schema: z.object({}),
    handler: async () => {
      const collections = await client.documents.listCollections();

      if (collections.length === 0) {
        return 'No document collections found.';
      }

      return collections.map((c) => {
        const alias = idToAlias.get(c.collection);
        return {
          collection: alias ?? c.collection,
          collectionId: alias ? c.collection : undefined,
          documentCount: c.document_count,
          description: c.description ?? undefined,
          version: c.version ?? undefined,
        };
      });
    },
  });

  const searchDocuments = defineTool({
    name: 'documents_search',
    description:
      'Search documents using semantic similarity and keyword matching (hybrid search). Returns the most relevant document chunks for the given query. Use this to find information in documentation, guides, or other indexed materials.',
    schema: z.object({
      query: z.string().describe('The search query - describe what information you are looking for'),
      collections: z
        .array(z.string())
        .optional()
        .describe(
          'Optional list of collection names or aliases to search in. If not provided, searches all collections.',
        ),
      limit: z.number().optional().describe('Maximum number of results to return (default: 10)'),
      maxDistance: z
        .number()
        .optional()
        .describe(
          'Maximum distance threshold (0-2 for cosine). Results with distance greater than this are filtered out. Lower values = stricter matching.',
        ),
      hybridSearch: z
        .boolean()
        .optional()
        .describe(
          'Whether to combine vector similarity with keyword matching (default: true). Disable for pure semantic search.',
        ),
      rerank: z
        .boolean()
        .optional()
        .describe(
          'Whether to re-rank results using a secondary model for higher precision (default: false). Slower but more accurate.',
        ),
    }),
    handler: async ({ query, collections, limit, maxDistance, hybridSearch, rerank }) => {
      // Resolve any aliases to collection IDs
      const resolvedCollections = resolveCollections(collections, aliasMap);

      const results = await client.documents.search({
        query,
        collections: resolvedCollections,
        limit: limit ?? 10,
        maxDistance,
        hybridSearch,
        rerank,
      });

      if (results.length === 0) {
        return 'No results found for the given query.';
      }

      return results.map((r) => {
        const alias = idToAlias.get(r.collection);
        return {
          collection: alias ?? r.collection,
          collectionId: alias ? r.collection : undefined,
          documentId: r.document,
          content: r.content,
          relevanceScore: r.score ?? 1 - r.distance, // Use score if available, else convert distance
          distance: r.distance,
        };
      });
    },
  });

  const getDocument = defineTool({
    name: 'documents_get_document',
    description:
      'Get the full content of a specific document. Use this after searching to retrieve the complete document when you need more context than the search chunks provide.',
    schema: z.object({
      collection: z.string().describe('The collection name or alias containing the document'),
      document: z.string().describe('The document ID (typically the file path used when indexing)'),
    }),
    handler: async ({ collection, document }) => {
      // Resolve alias to collection ID
      const resolvedCollection = resolveCollection(collection, aliasMap);

      const result = await client.documents.getDocument({ collection: resolvedCollection, id: document });

      if (!result) {
        return `Document "${document}" not found in collection "${collection}".`;
      }

      const alias = idToAlias.get(result.collection);
      return {
        collection: alias ?? result.collection,
        collectionId: alias ? result.collection : undefined,
        document: result.id,
        content: result.content,
      };
    },
  });

  // === New tools for MCP v2 ===

  const listDocuments = defineTool({
    name: 'documents_list_documents',
    description:
      'List all documents in a collection. Returns document IDs, titles, and sizes. ' +
      'Use this to browse what documentation is available before searching. ' +
      'Supports pagination for large collections.',
    schema: z.object({
      collection: z.string().describe('The collection name or alias'),
      limit: z.number().optional().describe('Maximum documents to return (default: 100)'),
      offset: z.number().optional().describe('Offset for pagination (default: 0)'),
    }),
    handler: async ({ collection, limit, offset }) => {
      const resolvedCollection = resolveCollection(collection, aliasMap);

      const result = await client.documents.listDocuments({
        collection: resolvedCollection,
        limit: limit ?? 100,
        offset: offset ?? 0,
      });

      return {
        collection: idToAlias.get(resolvedCollection) ?? resolvedCollection,
        collectionId: idToAlias.has(resolvedCollection) ? resolvedCollection : undefined,
        documents: result.documents,
        total: result.total,
        hasMore: result.hasMore,
      };
    },
  });

  const getOutline = defineTool({
    name: 'documents_get_outline',
    description:
      'Get the heading structure of a document. Returns section headings with their levels ' +
      'and line numbers. Use this to understand document organization before reading specific sections.',
    schema: z.object({
      collection: z.string().describe('The collection name or alias'),
      document: z.string().describe('The document ID'),
      maxDepth: z.number().optional().describe('Maximum heading depth 1-6 (default: 3)'),
    }),
    handler: async ({ collection, document, maxDepth }) => {
      const resolvedCollection = resolveCollection(collection, aliasMap);

      const result = await client.documents.getOutline({
        collection: resolvedCollection,
        document,
        maxDepth: maxDepth ?? 3,
      });

      if (!result) {
        return `Document "${document}" not found in collection "${collection}".`;
      }

      return {
        collection: idToAlias.get(resolvedCollection) ?? resolvedCollection,
        collectionId: idToAlias.has(resolvedCollection) ? resolvedCollection : undefined,
        document,
        title: result.title,
        outline: result.outline,
      };
    },
  });

  const getSection = defineTool({
    name: 'documents_get_section',
    description:
      'Get a specific section of a document by heading. Returns the section content without ' +
      'fetching the entire document. Use this when you know which section you need.',
    schema: z.object({
      collection: z.string().describe('The collection name or alias'),
      document: z.string().describe('The document ID'),
      section: z.string().describe('Section heading text to match (case-insensitive substring match)'),
      includeSubsections: z.boolean().optional().describe('Include nested subsections in the result (default: true)'),
    }),
    handler: async ({ collection, document, section, includeSubsections }) => {
      const resolvedCollection = resolveCollection(collection, aliasMap);

      const result = await client.documents.getSection({
        collection: resolvedCollection,
        document,
        section,
        includeSubsections: includeSubsections ?? true,
      });

      if (!result) {
        return `Section "${section}" not found in document "${document}".`;
      }

      return {
        collection: idToAlias.get(resolvedCollection) ?? resolvedCollection,
        collectionId: idToAlias.has(resolvedCollection) ? resolvedCollection : undefined,
        document,
        section: result.section,
        level: result.level,
        content: result.content,
        startLine: result.startLine,
        endLine: result.endLine,
      };
    },
  });

  const searchBatch = defineTool({
    name: 'documents_search_batch',
    description:
      'Execute multiple search queries in a single call. More efficient than making ' +
      'separate search calls when researching multiple topics. Limited to 10 queries.',
    schema: z.object({
      queries: z
        .array(
          z.object({
            query: z.string().describe('Search query'),
            collections: z.array(z.string()).optional().describe('Limit to specific collections'),
          }),
        )
        .min(1)
        .max(10)
        .describe('Array of search queries (max 10)'),
      limit: z.number().optional().describe('Results per query (default: 5)'),
      maxDistance: z.number().optional().describe('Maximum distance threshold per query'),
      hybridSearch: z.boolean().optional().describe('Use hybrid search (default: true)'),
    }),
    handler: async ({ queries, limit, maxDistance, hybridSearch }) => {
      // Resolve collection aliases in each query
      const resolvedQueries = queries.map((q) => ({
        query: q.query,
        collections: resolveCollections(q.collections, aliasMap),
      }));

      const result = await client.documents.searchBatch({
        queries: resolvedQueries,
        limit: limit ?? 5,
        maxDistance,
        hybridSearch: hybridSearch ?? true,
      });

      // Map collection IDs back to aliases in results
      return {
        results: result.results.map((r) => ({
          query: r.query,
          results: r.results.map((item) => {
            const alias = idToAlias.get(item.collection);
            return {
              collection: alias ?? item.collection,
              collectionId: alias ? item.collection : undefined,
              documentId: item.document,
              content: item.content,
              relevanceScore: item.score ?? 1 - item.distance,
              distance: item.distance,
            };
          }),
        })),
      };
    },
  });

  const findRelated = defineTool({
    name: 'documents_find_related',
    description:
      'Find content semantically related to a document or chunk. Use this to expand context ' +
      'or discover related documentation on a topic.',
    schema: z.object({
      collection: z.string().describe('Collection containing the source document'),
      document: z.string().describe('Document ID to find related content for'),
      chunk: z
        .string()
        .optional()
        .describe('Specific chunk content to find related items for (uses document centroid if not provided)'),
      limit: z.number().optional().describe('Maximum related items (default: 5)'),
      sameDocument: z.boolean().optional().describe('Include chunks from the same document (default: false)'),
    }),
    handler: async ({ collection, document, chunk, limit, sameDocument }) => {
      const resolvedCollection = resolveCollection(collection, aliasMap);

      const results = await client.documents.findRelated({
        collection: resolvedCollection,
        document,
        chunk,
        limit: limit ?? 5,
        sameDocument: sameDocument ?? false,
      });

      return {
        source: {
          collection: idToAlias.get(resolvedCollection) ?? resolvedCollection,
          collectionId: idToAlias.has(resolvedCollection) ? resolvedCollection : undefined,
          document,
        },
        related: results.map((r) => {
          const alias = idToAlias.get(r.collection);
          return {
            collection: alias ?? r.collection,
            collectionId: alias ? r.collection : undefined,
            documentId: r.document,
            content: r.content,
            relevanceScore: r.score ?? 1 - r.distance,
          };
        }),
      };
    },
  });

  return {
    listCollections,
    searchDocuments,
    getDocument,
    listDocuments,
    getOutline,
    getSection,
    searchBatch,
    findRelated,
  };
};

/**
 * Creates Langchain document tools for backward compatibility.
 * @deprecated Use createDocumentToolDefinitions with toLangchainTools instead
 */
const createDocumentTools = (client: BackendClient, aliasMap?: Map<string, string>) => {
  const definitions = createDocumentToolDefinitions({ client, aliasMap });
  return toLangchainTools(definitions);
};

export { createDocumentToolDefinitions, createDocumentTools };
export type { DocumentToolOptions };
