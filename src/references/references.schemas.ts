import { z } from 'zod';

const referenceDocumentSchema = z.object({
  collection: z.string(),
  id: z.string(),
  content: z.string(),
});

type ReferenceDocument = z.infer<typeof referenceDocumentSchema>;

const searchChunksOptionsSchema = z.object({
  query: z.string(),
  collections: z.array(z.string()).optional(),
  limit: z.number().optional(),
  /**
   * Maximum distance threshold for results (0-2 for cosine, lower is better).
   * Results with distance greater than this will be filtered out.
   */
  maxDistance: z.number().optional(),
  /**
   * Enable hybrid search combining vector similarity with keyword matching.
   * Uses Reciprocal Rank Fusion (RRF) to merge results.
   * @default true
   */
  hybridSearch: z.boolean().optional(),
  /**
   * Enable re-ranking of results using cross-encoder model.
   * Slower but more accurate. Only re-ranks top candidates.
   * @default false
   */
  rerank: z.boolean().optional(),
});

type SearchChunksOptions = z.infer<typeof searchChunksOptionsSchema>;

const searchChunkItemSchema = z.object({
  id: z.string(),
  document: z.string(),
  collection: z.string(),
  content: z.string(),
  distance: z.number(),
  /** Combined score after hybrid search fusion (higher is better) */
  score: z.number().optional(),
});

type SearchChunkItem = z.infer<typeof searchChunkItemSchema>;

export type { ReferenceDocument, SearchChunksOptions, SearchChunkItem };
export { referenceDocumentSchema, searchChunksOptionsSchema, searchChunkItemSchema };
