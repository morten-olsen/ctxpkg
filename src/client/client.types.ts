// Re-export backend API types for client use
export type { BackendAPI, GetBackendAPIResponse, GetBackendAPIParams } from '#root/backend/backend.types.js';

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
