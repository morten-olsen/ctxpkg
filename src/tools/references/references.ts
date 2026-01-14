import * as z from 'zod';

import type { BackendClient } from '#root/client/client.ts';
import { defineTool, type ToolDefinitions } from '#root/tools/tools.types.ts';
import { toLangchainTools } from '#root/tools/tools.langchain.ts';

/**
 * Creates reference document tool definitions that use the provided BackendClient.
 * These tools provide read-only access to the semantic index.
 *
 * Returns common tool definitions that can be converted to Langchain or MCP tools.
 */
const createReferenceToolDefinitions = (client: BackendClient): ToolDefinitions => {
  const listCollections = defineTool({
    name: 'references_list_collections',
    description:
      'List all available reference document collections. Returns collection names and document counts. Use this to discover what reference documentation is available before searching.',
    schema: z.object({}),
    handler: async () => {
      const collections = await client.references.listCollections();

      if (collections.length === 0) {
        return 'No reference collections found.';
      }

      return collections.map((c) => ({
        collection: c.collection,
        documentCount: c.document_count,
      }));
    },
  });

  const searchReferences = defineTool({
    name: 'references_search',
    description:
      'Search reference documents using semantic similarity. Returns the most relevant document chunks for the given query. Use this to find information in documentation, guides, or other indexed reference materials.',
    schema: z.object({
      query: z.string().describe('The search query - describe what information you are looking for'),
      collections: z
        .array(z.string())
        .optional()
        .describe('Optional list of collection names to search in. If not provided, searches all collections.'),
      limit: z.number().optional().default(10).describe('Maximum number of results to return (default: 10)'),
    }),
    handler: async ({ query, collections, limit }) => {
      const results = await client.references.search({
        query,
        collections,
        limit: limit ?? 10,
      });

      if (results.length === 0) {
        return 'No results found for the given query.';
      }

      return results.map((r) => ({
        collection: r.collection,
        document: r.document,
        content: r.content,
        relevanceScore: 1 - r.distance, // Convert distance to similarity score
      }));
    },
  });

  const getDocument = defineTool({
    name: 'references_get_document',
    description:
      'Get the full content of a specific reference document. Use this after searching to retrieve the complete document when you need more context than the search chunks provide.',
    schema: z.object({
      collection: z.string().describe('The collection name containing the document'),
      document: z.string().describe('The document ID (typically the file path used when indexing)'),
    }),
    handler: async ({ collection, document }) => {
      const result = await client.references.getDocument({ collection, id: document });

      if (!result) {
        return `Document "${document}" not found in collection "${collection}".`;
      }

      return {
        collection: result.collection,
        document: result.id,
        content: result.content,
      };
    },
  });

  return {
    listCollections,
    searchReferences,
    getDocument,
  };
};

/**
 * Creates Langchain reference tools for backward compatibility.
 * @deprecated Use createReferenceToolDefinitions with toLangchainTools instead
 */
const createReferenceTools = (client: BackendClient) => {
  const definitions = createReferenceToolDefinitions(client);
  return toLangchainTools(definitions);
};

export { createReferenceToolDefinitions, createReferenceTools };
