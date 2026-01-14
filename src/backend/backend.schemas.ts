import { z } from 'zod';

import {
  referenceDocumentSchema,
  searchChunksOptionsSchema,
  searchChunkItemSchema,
} from '#root/references/references.schemas.ts';

// Collection info schema
const collectionInfoSchema = z.object({
  collection: z.string(),
  document_count: z.number(),
});

type CollectionInfo = z.infer<typeof collectionInfoSchema>;

// Update collection options
const updateCollectionOptionsSchema = z.object({
  pattern: z.string(),
  cwd: z.string(),
  collection: z.string().optional(),
});

type UpdateCollectionOptions = z.infer<typeof updateCollectionOptionsSchema>;

// Drop collection params
const dropCollectionParamsSchema = z.object({
  collection: z.string(),
});

// Get document params
const getDocumentParamsSchema = z.object({
  collection: z.string(),
  id: z.string(),
});

// System status schema
const systemStatusSchema = z.object({
  uptime: z.number(),
  connections: z.number(),
  services: z.array(z.string()),
});

type SystemStatus = z.infer<typeof systemStatusSchema>;

// Ping response
const pingResponseSchema = z.object({
  pong: z.literal(true),
  timestamp: z.number(),
});

export type { CollectionInfo, UpdateCollectionOptions, SystemStatus };
export {
  referenceDocumentSchema,
  searchChunksOptionsSchema,
  searchChunkItemSchema,
  collectionInfoSchema,
  updateCollectionOptionsSchema,
  dropCollectionParamsSchema,
  getDocumentParamsSchema,
  systemStatusSchema,
  pingResponseSchema,
};
