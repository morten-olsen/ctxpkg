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
  limit: z.number().default(10),
});

type SearchChunksOptions = z.infer<typeof searchChunksOptionsSchema>;

const searchChunkItemSchema = z.object({
  document: z.string(),
  collection: z.string(),
  content: z.string(),
  distance: z.number(),
});

type SearchChunkItem = z.infer<typeof searchChunkItemSchema>;

export type { ReferenceDocument, SearchChunksOptions, SearchChunkItem };
export { referenceDocumentSchema, searchChunksOptionsSchema, searchChunkItemSchema };
