import { tool } from 'langchain';
import * as z from 'zod';

import type { BackendClient } from '#root/client/client.ts';

/**
 * Creates reference document tools that use the provided BackendClient.
 * These tools provide read-only access to the semantic index.
 */
const createReferenceTools = (client: BackendClient) => {
  const listCollections = tool(
    async () => {
      const collections = await client.references.listCollections();

      if (collections.length === 0) {
        return 'No reference collections found.';
      }

      return JSON.stringify(
        collections.map((c) => ({
          collection: c.collection,
          documentCount: c.document_count,
        })),
        null,
        2,
      );
    },
    {
      name: 'references_list_collections',
      description:
        'List all available reference document collections. Returns collection names and document counts. Use this to discover what reference documentation is available before searching.',
      schema: z.object({}),
    },
  );

  const searchReferences = tool(
    async ({ query, collections, limit }) => {
      const results = await client.references.search({
        query,
        collections,
        limit: limit ?? 10,
      });

      if (results.length === 0) {
        return 'No results found for the given query.';
      }

      return JSON.stringify(
        results.map((r) => ({
          collection: r.collection,
          document: r.document,
          content: r.content,
          relevanceScore: 1 - r.distance, // Convert distance to similarity score
        })),
        null,
        2,
      );
    },
    {
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
    },
  );

  const getDocument = tool(
    async ({ collection, document }) => {
      const result = await client.references.getDocument({ collection, id: document });

      if (!result) {
        return `Document "${document}" not found in collection "${collection}".`;
      }

      return JSON.stringify(
        {
          collection: result.collection,
          document: result.id,
          content: result.content,
        },
        null,
        2,
      );
    },
    {
      name: 'references_get_document',
      description:
        'Get the full content of a specific reference document. Use this after searching to retrieve the complete document when you need more context than the search chunks provide.',
      schema: z.object({
        collection: z.string().describe('The collection name containing the document'),
        document: z.string().describe('The document ID (typically the file path used when indexing)'),
      }),
    },
  );

  return {
    listCollections,
    searchReferences,
    getDocument,
  };
};

export { createReferenceTools };
