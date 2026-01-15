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

// === New schemas for MCP tools v2 ===

// List documents params and result
const listDocumentsParamsSchema = z.object({
  collection: z.string(),
  limit: z.number().optional().default(100),
  offset: z.number().optional().default(0),
});

type ListDocumentsParams = z.infer<typeof listDocumentsParamsSchema>;

const documentInfoSchema = z.object({
  id: z.string(),
  title: z.string(),
  size: z.number(),
});

type DocumentInfo = z.infer<typeof documentInfoSchema>;

const listDocumentsResultSchema = z.object({
  documents: z.array(documentInfoSchema),
  total: z.number(),
  hasMore: z.boolean(),
});

type ListDocumentsResult = z.infer<typeof listDocumentsResultSchema>;

// Get outline params and result
const getOutlineParamsSchema = z.object({
  collection: z.string(),
  document: z.string(),
  maxDepth: z.number().optional().default(3),
});

type GetOutlineParams = z.infer<typeof getOutlineParamsSchema>;

const outlineItemSchema = z.object({
  level: z.number(),
  text: z.string(),
  line: z.number(),
});

type OutlineItem = z.infer<typeof outlineItemSchema>;

const outlineResultSchema = z.object({
  title: z.string(),
  outline: z.array(outlineItemSchema),
});

type OutlineResult = z.infer<typeof outlineResultSchema>;

// Get section params and result
const getSectionParamsSchema = z.object({
  collection: z.string(),
  document: z.string(),
  section: z.string(),
  includeSubsections: z.boolean().optional().default(true),
});

type GetSectionParams = z.infer<typeof getSectionParamsSchema>;

const sectionResultSchema = z.object({
  section: z.string(),
  level: z.number(),
  content: z.string(),
  startLine: z.number(),
  endLine: z.number(),
});

type SectionResult = z.infer<typeof sectionResultSchema>;

// Find related params
const findRelatedParamsSchema = z.object({
  collection: z.string(),
  document: z.string(),
  chunk: z.string().optional(),
  limit: z.number().optional().default(5),
  sameDocument: z.boolean().optional().default(false),
});

type FindRelatedParams = z.infer<typeof findRelatedParamsSchema>;

// Search batch params and result
const searchBatchQuerySchema = z.object({
  query: z.string(),
  collections: z.array(z.string()).optional(),
});

const searchBatchParamsSchema = z.object({
  queries: z.array(searchBatchQuerySchema).min(1).max(10),
  limit: z.number().optional().default(5),
  maxDistance: z.number().optional(),
  hybridSearch: z.boolean().optional().default(true),
});

type SearchBatchParams = z.infer<typeof searchBatchParamsSchema>;

const searchBatchResultItemSchema = z.object({
  query: z.string(),
  results: z.array(searchChunkItemSchema),
});

const searchBatchResultSchema = z.object({
  results: z.array(searchBatchResultItemSchema),
});

type SearchBatchResult = z.infer<typeof searchBatchResultSchema>;

export type {
  ReferenceDocument,
  SearchChunksOptions,
  SearchChunkItem,
  ListDocumentsParams,
  DocumentInfo,
  ListDocumentsResult,
  GetOutlineParams,
  OutlineItem,
  OutlineResult,
  GetSectionParams,
  SectionResult,
  FindRelatedParams,
  SearchBatchParams,
  SearchBatchResult,
};

export {
  referenceDocumentSchema,
  searchChunksOptionsSchema,
  searchChunkItemSchema,
  listDocumentsParamsSchema,
  documentInfoSchema,
  listDocumentsResultSchema,
  getOutlineParamsSchema,
  outlineItemSchema,
  outlineResultSchema,
  getSectionParamsSchema,
  sectionResultSchema,
  findRelatedParamsSchema,
  searchBatchQuerySchema,
  searchBatchParamsSchema,
  searchBatchResultItemSchema,
  searchBatchResultSchema,
};
