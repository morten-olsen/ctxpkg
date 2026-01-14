/**
 * Shared type definitions for backend services.
 * These types define the contract between backend and client.
 */

import type { ReferenceDocument, SearchChunkItem, SearchChunksOptions } from '#root/references/references.schemas.ts';

// Re-export types that are used in the API
export type { ReferenceDocument, SearchChunkItem, SearchChunksOptions };

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
  system: SystemAPI;
};
