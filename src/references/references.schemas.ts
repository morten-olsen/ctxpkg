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

const searchChunkItem = z.object({
  document: z.string(),
  collection: z.string(),
  content: z.string(),
  distance: z.number(),
});

export type { ReferenceDocument, SearchChunksOptions };
export { referenceDocumentSchema, searchChunksOptionsSchema, searchChunkItem };
