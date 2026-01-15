import { z } from 'zod';

import {
  referenceDocumentSchema,
  searchChunksOptionsSchema,
  searchChunkItemSchema,
} from '#root/documents/documents.schemas.ts';

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

// Collections schemas
const syncCollectionParamsSchema = z.object({
  name: z.string(),
  spec: z.object({ url: z.string() }),
  cwd: z.string(),
  force: z.boolean().optional(),
});

type SyncCollectionParams = z.infer<typeof syncCollectionParamsSchema>;

const syncResultSchema = z.object({
  added: z.number(),
  updated: z.number(),
  removed: z.number(),
  total: z.number(),
});

type SyncResult = z.infer<typeof syncResultSchema>;

const collectionRecordInfoSchema = z.object({
  id: z.string(),
  url: z.string(),
  name: z.string().nullable(),
  version: z.string().nullable(),
  lastSyncAt: z.string().nullable(),
});

type CollectionRecordInfo = z.infer<typeof collectionRecordInfoSchema>;

export type {
  CollectionInfo,
  UpdateCollectionOptions,
  SystemStatus,
  SyncCollectionParams,
  SyncResult,
  CollectionRecordInfo,
};
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
  syncCollectionParamsSchema,
  syncResultSchema,
  collectionRecordInfoSchema,
};
