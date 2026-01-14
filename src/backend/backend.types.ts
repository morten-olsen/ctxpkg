/**
 * Shared type definitions for backend services.
 * These types define the contract between backend and client.
 */

import type { ReferenceDocument, SearchChunkItem, SearchChunksOptions } from '#root/references/references.schemas.ts';
import type { CollectionSpec } from '#root/collections/collections.schemas.ts';

// Re-export types that are used in the API
export type { ReferenceDocument, SearchChunkItem, SearchChunksOptions, CollectionSpec };

// Collection info returned by listCollections
export type CollectionInfo = {
  collection: string;
  document_count: number;
};

// Update collection options
export type UpdateCollectionOptions = {
  pattern: string;
  cwd: string;
  collection?: string;
};

// Drop collection params
export type DropCollectionParams = {
  collection: string;
};

// Get document params
export type GetDocumentParams = {
  collection: string;
  id: string;
};

// System status
export type SystemStatus = {
  uptime: number;
  connections: number;
  services: string[];
};

// Ping response
export type PingResponse = {
  pong: true;
  timestamp: number;
};

// Collections types
export type SyncCollectionParams = {
  name: string;
  spec: CollectionSpec;
  cwd: string;
  force?: boolean;
};

export type SyncResult = {
  added: number;
  updated: number;
  removed: number;
  total: number;
};

export type CollectionRecordInfo = {
  id: string;
  type: 'file' | 'pkg';
  lastSyncAt: string | null;
};

export type GetSyncStatusParams = {
  spec: CollectionSpec;
  cwd: string;
};

/**
 * References service API definition.
 * Defines all methods available on the references service.
 */
export type ReferencesAPI = {
  listCollections(): Promise<CollectionInfo[]>;
  dropCollection(params: DropCollectionParams): Promise<void>;
  updateCollection(params: UpdateCollectionOptions): Promise<void>;
  search(params: SearchChunksOptions): Promise<SearchChunkItem[]>;
  getDocument(params: GetDocumentParams): Promise<ReferenceDocument | null>;
};

/**
 * Collections service API definition.
 */
export type CollectionsAPI = {
  sync(params: SyncCollectionParams): Promise<SyncResult>;
  list(): Promise<CollectionRecordInfo[]>;
  getSyncStatus(params: GetSyncStatusParams): Promise<'synced' | 'not_synced' | 'stale'>;
};

/**
 * System service API definition.
 */
export type SystemAPI = {
  ping(): Promise<PingResponse>;
  status(): Promise<SystemStatus>;
  shutdown(): Promise<void>;
};

/**
 * Complete backend API definition.
 * This is the main interface that clients use.
 */
export type BackendAPI = {
  references: ReferencesAPI;
  collections: CollectionsAPI;
  system: SystemAPI;
};
