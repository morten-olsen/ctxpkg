// Re-export backend API types for client use
export type {
  BackendAPI,
  ReferencesAPI,
  CollectionsAPI,
  SystemAPI,
  CollectionInfo,
  UpdateCollectionOptions,
  DropCollectionParams,
  GetDocumentParams,
  SystemStatus,
  PingResponse,
  ReferenceDocument,
  SearchChunkItem,
  SearchChunksOptions,
  SyncCollectionParams,
  SyncResult,
  CollectionRecordInfo,
  GetSyncStatusParams,
  CollectionSpec,
} from '#root/backend/backend.types.ts';

// Connection modes
export type ConnectionMode = 'direct' | 'daemon' | 'websocket';

// Client options
export type ClientOptions = {
  mode: ConnectionMode;
  // For 'websocket' mode
  url?: string;
  // For 'daemon' mode
  socketPath?: string;
  autoStartDaemon?: boolean;
  // Common options
  timeout?: number;
};
