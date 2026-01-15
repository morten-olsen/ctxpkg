import * as z from 'zod';

import type { BackendClient } from '#root/client/client.ts';
import { defineTool, type ToolDefinitions } from '#root/tools/tools.types.ts';
import { toLangchainTools } from '#root/tools/tools.langchain.ts';

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
      'List all available document collections. Returns collection names/aliases and document counts. Use this to discover what documentation is available before searching.',
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

  return {
    listCollections,
    searchDocuments,
    getDocument,
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
