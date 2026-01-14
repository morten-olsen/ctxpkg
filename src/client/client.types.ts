// Re-export backend API types for client use
export type {
  BackendAPI,
  ReferencesAPI,
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
