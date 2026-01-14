# Daemon Architecture Specification

This document specifies the architecture for running the AI Assist backend as a daemon service with socket-based communication.

## Overview

The goal is to decouple the backend services from the CLI, allowing:

1. **Daemon Mode**: Backend runs as a persistent system daemon, accessible via Unix socket
2. **Direct Mode**: Backend instantiated directly in-process (current behavior)
3. **Remote Mode**: Backend accessed via WebSocket over network

This enables:
- Faster CLI startup (no model loading on each invocation)
- Shared state across CLI invocations
- Potential for multiple clients (editor plugins, web UIs, etc.)
- Background processing capabilities

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Clients                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────────────┐ │
│  │   CLI    │  │  Editor  │  │  Web UI  │  │  Other Clients (future)  │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────────────┬─────────────┘ │
│       │             │             │                     │               │
└───────┼─────────────┼─────────────┼─────────────────────┼───────────────┘
        │             │             │                     │
        │    ┌────────┴─────────────┴─────────────────────┘
        │    │
        │    │   ┌─────────────────────────────────────────┐
        │    │   │           Client-Side Services          │
        │    │   │  ┌─────────────────────────────────┐   │
        │    │   │  │  Interact Service (AI Agent)    │   │
        │    │   │  │  - Runs in client process       │   │
        │    │   │  │  - Uses BackendClient for refs  │   │
        │    │   │  └─────────────────────────────────┘   │
        │    │   └──────────────────┬──────────────────────┘
        │    │                      │
        └────┴──────────────────────┘
                             │
                    ┌────────▼────────┐
                    │  BackendClient  │
                    │                 │
                    │  - connect()    │
                    │  - request()    │
                    │  - subscribe()  │
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
┌───────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ DirectAdapter │  │  DaemonAdapter  │  │ WebSocketAdapter│
│               │  │                 │  │                 │
│ (in-process)  │  │ (Unix socket)   │  │ (ws:// remote)  │
└───────┬───────┘  └────────┬────────┘  └────────┬────────┘
        │                   │                    │
        │           ┌───────▼───────┐            │
        │           │DaemonManager  │            │
        │           │               │            │
        │           │- ensureRunning│            │
        │           │- getSocketPath│            │
        │           └───────┬───────┘            │
        │                   │                    │
        │           ┌───────▼───────┐            │
        │           │    Daemon     │            │
        │           │               │            │
        │           │- Unix Socket  │            │
        │           │- Auto-shutdown│            │
        │           │- Lifecycle    │            │
        │           └───────┬───────┘            │
        │                   │                    │
        └───────────────────┼────────────────────┘
                            │
                   ┌────────▼────────┐
                   │     Backend     │
                   │                 │
                   │  - Services     │
                   │  - Handlers     │
                   │  - Protocol     │
                   └────────┬────────┘
                            │
        ┌───────────────────┴───────────────────┐
        │                                       │
        ▼                                       ▼
┌───────────────┐                     ┌───────────────┐
│  References   │                     │    Future     │
│   Service     │                     │   Services    │
└───────────────┘                     └───────────────┘
```

## Service Location

Services are split between client-side and backend based on their nature:

### Backend Services (in Daemon)

Services that benefit from persistence and shared state:

- **References Service** - Embeddings model loading is slow; sharing across invocations improves performance
- **Future**: Database-backed services, caching services, etc.

### Client-Side Services (in CLI/Client process)

Services that are inherently interactive or stateful per-session:

- **Interact Service** - AI agent sessions are interactive, streaming, and tied to the user's terminal
- **Agent** - Created per-session, uses tools that may need client context

The Interact service uses `BackendClient` to access backend services (like references) while running in the client process.

## Components

### 1. Backend (`src/backend/`)

The core backend that exposes services through a protocol-agnostic interface.

#### Files

```
src/backend/
├── backend.ts              # Main Backend class
├── backend.protocol.ts     # Protocol types and schemas
├── backend.handlers.ts     # Request handlers
└── backend.schemas.ts      # Zod schemas for protocol
```

#### Backend Class

```typescript
// src/backend/backend.ts
import type { Services } from '#root/utils/utils.services.ts';
import { destroy } from '#root/utils/utils.services.ts';

interface BackendOptions {
  services?: Services;
}

class Backend {
  #services: Services;
  #handlers: Map<string, RequestHandler>;

  constructor(options?: BackendOptions);

  // Handle incoming requests
  handleRequest(request: Request): Promise<Response>;

  // Subscribe to events (for streaming responses)
  subscribe(channel: string, callback: EventCallback): Unsubscribe;

  // Cleanup
  [destroy](): Promise<void>;
}
```

#### Protocol

JSON-RPC 2.0 inspired protocol for request/response communication:

```typescript
// src/backend/backend.protocol.ts

// Base request structure
interface Request {
  id: string;           // Unique request ID (UUID)
  method: string;       // Service method name (e.g., "references.search")
  params?: unknown;     // Method parameters
}

// Base response structure
interface Response {
  id: string;           // Matching request ID
  result?: unknown;     // Success result
  error?: {             // Error details (mutually exclusive with result)
    code: number;
    message: string;
    data?: unknown;
  };
}

// Event for subscriptions/streaming
interface Event {
  channel: string;      // Event channel name
  data: unknown;        // Event payload
}

// Standard error codes
enum ErrorCode {
  ParseError = -32700,
  InvalidRequest = -32600,
  MethodNotFound = -32601,
  InvalidParams = -32602,
  InternalError = -32603,
  // Custom codes start at -32000
  ServiceError = -32000,
  NotConnected = -32001,
  Timeout = -32002,
}
```

#### Initial Service Methods

```typescript
// References service methods
"references.listCollections"    // params: {} → Collection[]
"references.dropCollection"     // params: { collection: string } → void
"references.updateCollection"   // params: { pattern, cwd, collection? } → void
"references.updateDocument"     // params: { collection, id, content } → void
"references.search"             // params: { query, collections?, limit? } → SearchResult[]
"references.getDocument"        // params: { collection, id } → Document | null

// System methods
"system.ping"                   // params: {} → { pong: true, timestamp: number }
"system.status"                 // params: {} → { uptime, connections, services }
"system.shutdown"               // params: {} → void (graceful shutdown)
```

### 2. Daemon (`src/daemon/`)

The daemon runtime that exposes the backend over a Unix socket.

#### Files

```
src/daemon/
├── daemon.ts           # Main Daemon class
├── daemon.server.ts    # WebSocket server over Unix socket
├── daemon.config.ts    # Daemon configuration
└── daemon.schemas.ts   # Zod schemas
```

#### Daemon Class

```typescript
// src/daemon/daemon.ts

interface DaemonOptions {
  socketPath?: string;          // Default: ~/.ai-assist/daemon.sock
  idleTimeout?: number;         // Default: 5 minutes (300000ms)
  pidFile?: string;             // Default: ~/.ai-assist/daemon.pid
}

class Daemon {
  #backend: Backend;
  #server: WebSocketServer;
  #connections: Set<WebSocket>;
  #idleTimer: NodeJS.Timeout | null;

  constructor(options?: DaemonOptions);

  // Start the daemon
  start(): Promise<void>;

  // Stop the daemon gracefully
  stop(): Promise<void>;

  // Get daemon status
  getStatus(): DaemonStatus;
}

interface DaemonStatus {
  running: boolean;
  socketPath: string;
  pid: number;
  uptime: number;
  connections: number;
}
```

#### Idle Timeout Behavior

- Timer starts when last connection closes
- Timer resets when new connection opens
- When timer fires: graceful shutdown
- Configurable timeout (default 5 minutes)
- Timer disabled if set to 0 or negative

#### Socket Path

Default location following XDG conventions:
- **macOS**: `~/Library/Application Support/ai-assist/daemon.sock`
- **Linux**: `~/.local/share/ai-assist/daemon.sock`
- **Windows**: `%LOCALAPPDATA%\ai-assist\daemon.sock`

Use `env-paths` package (already a dependency) for consistent paths.

### 3. DaemonManager (`src/daemon/`)

Client-side component that manages daemon lifecycle.

#### DaemonManager Class

```typescript
// src/daemon/daemon.manager.ts

interface DaemonManagerOptions {
  socketPath?: string;
  autoStart?: boolean;        // Default: true
  startTimeout?: number;      // Default: 30000ms
}

class DaemonManager {
  #options: DaemonManagerOptions;

  constructor(options?: DaemonManagerOptions);

  // Ensure daemon is running, start if needed
  ensureRunning(): Promise<void>;

  // Check if daemon is running
  isRunning(): Promise<boolean>;

  // Get socket path
  getSocketPath(): string;

  // Start daemon (spawns new process)
  start(): Promise<void>;

  // Stop daemon (sends shutdown command)
  stop(): Promise<void>;

  // Get daemon status
  getStatus(): Promise<DaemonStatus | null>;
}
```

#### Daemon Process Management

```typescript
// Starting the daemon
async start(): Promise<void> {
  // 1. Check if already running
  if (await this.isRunning()) return;

  // 2. Spawn detached daemon process
  const child = spawn(
    process.execPath,           // Node binary
    [daemonEntryPoint],         // e.g., ./bin/daemon.js
    {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, AI_ASSIST_DAEMON: '1' }
    }
  );
  child.unref();

  // 3. Wait for socket to become available
  await this.waitForSocket(this.#options.startTimeout);
}

// Checking if running
async isRunning(): Promise<boolean> {
  // 1. Check if socket file exists
  // 2. Try to connect and ping
  // 3. Return true if ping succeeds
}
```

### 4. BackendClient (`src/client/`)

Unified client interface for interacting with the backend.

#### Files

```
src/client/
├── client.ts               # Main BackendClient class
├── client.adapters.ts      # Adapter implementations
├── client.types.ts         # Type definitions
└── client.schemas.ts       # Zod schemas
```

#### BackendClient Class

```typescript
// src/client/client.ts

type ConnectionMode = 'direct' | 'daemon' | 'websocket';

interface ClientOptions {
  mode: ConnectionMode;
  // For 'websocket' mode
  url?: string;
  // For 'daemon' mode
  socketPath?: string;
  autoStartDaemon?: boolean;
  // Common options
  timeout?: number;           // Request timeout (default: 30000ms)
}

class BackendClient {
  #adapter: ClientAdapter;
  #connected: boolean;

  constructor(options: ClientOptions);

  // Connect to backend
  connect(): Promise<void>;

  // Disconnect from backend
  disconnect(): Promise<void>;

  // Check connection status
  isConnected(): boolean;

  // Generic request method
  request<T>(method: string, params?: unknown): Promise<T>;

  // Subscribe to events
  subscribe(channel: string, callback: EventCallback): Unsubscribe;

  // Convenience methods (type-safe wrappers)
  references: {
    listCollections(): Promise<Collection[]>;
    dropCollection(collection: string): Promise<void>;
    updateCollection(options: UpdateCollectionOptions): Promise<void>;
    search(options: SearchOptions): Promise<SearchResult[]>;
    getDocument(collection: string, id: string): Promise<Document | null>;
  };

  system: {
    ping(): Promise<{ pong: true; timestamp: number }>;
    status(): Promise<SystemStatus>;
    shutdown(): Promise<void>;
  };
}
```

#### Adapters

```typescript
// src/client/client.adapters.ts

interface ClientAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  send(request: Request): Promise<Response>;
  subscribe(channel: string, callback: EventCallback): Unsubscribe;
}

// Direct adapter - instantiates backend in-process
class DirectAdapter implements ClientAdapter {
  #backend: Backend | null;
  // ...
}

// Daemon adapter - connects via Unix socket
class DaemonAdapter implements ClientAdapter {
  #manager: DaemonManager;
  #socket: WebSocket | null;
  // ...
}

// WebSocket adapter - connects via remote WebSocket
class WebSocketAdapter implements ClientAdapter {
  #url: string;
  #socket: WebSocket | null;
  // ...
}
```

### 5. Interact Service Updates

The Interact service remains client-side but uses `BackendClient` for reference access.

#### Updated Interact Module

```typescript
// src/interact/interact.ts (updated)

import { BackendClient } from '#root/client/client.ts';
import { createReferenceTools } from '#root/tools/references/references.ts';

const createDefaultAgent = async (client: BackendClient): Promise<{ agent: ReactAgent }> => {
  // Reference tools now use BackendClient
  const referenceTools = createReferenceTools(client);

  const tools = [
    ...Object.values(fileTools),
    ...Object.values(gitTools),
    ...Object.values(referenceTools),
  ];

  const agent = await createAgent(tools, systemPrompt);
  return { agent };
};

const startSession = async () => {
  // Create client (uses daemon if available)
  const client = await createCliClient();
  await client.connect();

  try {
    const { agent } = await createDefaultAgent(client);
    // ... interactive session loop
  } finally {
    await client.disconnect();
  }
};
```

#### Updated Reference Tools

```typescript
// src/tools/references/references.ts (updated)

import type { BackendClient } from '#root/client/client.ts';

const createReferenceTools = (client: BackendClient) => {
  const references_list_collections = tool(
    async () => {
      const collections = await client.references.listCollections();
      return JSON.stringify(collections);
    },
    {
      name: 'references_list_collections',
      description: 'List all reference document collections',
      schema: z.object({}),
    }
  );

  const references_search = tool(
    async ({ query, collections, limit }) => {
      const results = await client.references.search({ query, collections, limit });
      return JSON.stringify(results);
    },
    {
      name: 'references_search',
      description: 'Search reference documents',
      schema: searchChunksOptions,
    }
  );

  // ... other tools

  return { references_list_collections, references_search, /* ... */ };
};
```

### 6. CLI Integration

Update CLI commands to use `BackendClient` instead of directly instantiating services.

#### Client Factory

```typescript
// src/cli/cli.client.ts

interface CliClientOptions {
  mode?: 'auto' | 'direct' | 'daemon';
}

// Factory function for CLI commands
async function createCliClient(options?: CliClientOptions): Promise<BackendClient> {
  const mode = options?.mode ?? 'auto';

  if (mode === 'auto') {
    // Try daemon first, fall back to direct
    const manager = new DaemonManager();
    if (await manager.isRunning()) {
      return new BackendClient({ mode: 'daemon' });
    }
    return new BackendClient({ mode: 'direct' });
  }

  return new BackendClient({ mode });
}
```

#### Updated CLI Command Pattern

```typescript
// Example: Updated references command
command
  .command('search')
  .action(withErrorHandling(async (query, options) => {
    const client = await createCliClient();
    try {
      await client.connect();
      const results = await client.references.search({
        query,
        collections: options.collections,
        limit: parseInt(options.limit, 10),
      });
      // ... display results
    } finally {
      await client.disconnect();
    }
  }));
```

#### New Daemon CLI Commands

```typescript
// src/cli/cli.daemon.ts

const createDaemonCli = (command: Command) => {
  command.description('Manage the background daemon');

  command
    .command('start')
    .description('Start the daemon')
    .action(withErrorHandling(async () => {
      const manager = new DaemonManager();
      await manager.start();
      formatSuccess('Daemon started');
    }));

  command
    .command('stop')
    .description('Stop the daemon')
    .action(withErrorHandling(async () => {
      const manager = new DaemonManager();
      await manager.stop();
      formatSuccess('Daemon stopped');
    }));

  command
    .command('status')
    .description('Show daemon status')
    .action(withErrorHandling(async () => {
      const manager = new DaemonManager();
      const status = await manager.getStatus();
      // ... display status
    }));

  command
    .command('restart')
    .description('Restart the daemon')
    .action(withErrorHandling(async () => {
      const manager = new DaemonManager();
      await manager.stop();
      await manager.start();
      formatSuccess('Daemon restarted');
    }));
};
```

## File Structure

Complete file structure after implementation:

```
src/
├── backend/
│   ├── backend.ts              # Backend class
│   ├── backend.protocol.ts     # Protocol definitions
│   ├── backend.handlers.ts     # Request handlers
│   └── backend.schemas.ts      # Zod schemas
├── daemon/
│   ├── daemon.ts               # Daemon class
│   ├── daemon.server.ts        # WebSocket server
│   ├── daemon.manager.ts       # DaemonManager class
│   ├── daemon.config.ts        # Configuration
│   └── daemon.schemas.ts       # Zod schemas
├── client/
│   ├── client.ts               # BackendClient class
│   ├── client.adapters.ts      # Adapter implementations
│   ├── client.types.ts         # Type definitions
│   └── client.schemas.ts       # Zod schemas
├── cli/
│   ├── cli.ts                  # (updated) Mount daemon commands
│   ├── cli.daemon.ts           # (new) Daemon management commands
│   ├── cli.client.ts           # (new) Client factory
│   ├── cli.references.ts       # (updated) Use client
│   ├── cli.interact.ts         # (updated) Use client
│   └── ...
├── interact/
│   └── interact.ts             # (updated) Accept BackendClient
├── tools/
│   └── references/
│       └── references.ts       # (updated) Accept BackendClient
└── ...

bin/
├── cli.js                      # CLI entry point
└── daemon.js                   # (new) Daemon entry point
```

## Implementation Plan

### Phase 1: Backend Core

1. Create `src/backend/backend.protocol.ts` - Protocol types and schemas
2. Create `src/backend/backend.schemas.ts` - Zod validation schemas
3. Create `src/backend/backend.handlers.ts` - Request handlers for references service
4. Create `src/backend/backend.ts` - Main Backend class

### Phase 2: Daemon

1. Create `src/daemon/daemon.config.ts` - Daemon configuration
2. Create `src/daemon/daemon.schemas.ts` - Status and config schemas
3. Create `src/daemon/daemon.server.ts` - WebSocket server implementation
4. Create `src/daemon/daemon.ts` - Main Daemon class
5. Create `bin/daemon.js` - Daemon entry point

### Phase 3: Daemon Manager

1. Create `src/daemon/daemon.manager.ts` - DaemonManager class

### Phase 4: Client

1. Create `src/client/client.types.ts` - Type definitions
2. Create `src/client/client.schemas.ts` - Zod schemas
3. Create `src/client/client.adapters.ts` - Adapter implementations
4. Create `src/client/client.ts` - Main BackendClient class

### Phase 5: CLI Integration

1. Create `src/cli/cli.client.ts` - Client factory
2. Create `src/cli/cli.daemon.ts` - Daemon management commands
3. Update `src/cli/cli.references.ts` - Use BackendClient
4. Update `src/cli/cli.ts` - Mount daemon commands

### Phase 6: Interact Service Integration

1. Update `src/tools/references/references.ts` - Accept BackendClient instead of Services
2. Update `src/interact/interact.ts` - Accept BackendClient, pass to reference tools
3. Update `src/cli/cli.interact.ts` - Create client and pass to interact

### Phase 7: Documentation & Testing

1. Update `ARCHITECTURE.md` with new components
2. Update `README.md` with daemon usage
3. Add unit tests for protocol handling
4. Add integration tests for daemon lifecycle

## Dependencies

### New Dependencies

```json
{
  "dependencies": {
    "ws": "^8.18.0"           // WebSocket implementation
  },
  "devDependencies": {
    "@types/ws": "^8.5.12"    // WebSocket types
  }
}
```

### Existing Dependencies (Already Available)

- `zod` - Schema validation
- `env-paths` - Cross-platform paths
- `chalk` - Terminal colors (for daemon CLI)

## Configuration

### New Config Options

```typescript
// src/config/config.ts (additions)

daemon: {
  enabled: {
    doc: 'Enable daemon mode for CLI',
    format: Boolean,
    default: true,
    env: 'AI_ASSIST_DAEMON_ENABLED',
  },
  socketPath: {
    doc: 'Custom socket path for daemon',
    format: String,
    default: '',  // Empty = use default from env-paths
    env: 'AI_ASSIST_SOCKET_PATH',
  },
  idleTimeout: {
    doc: 'Idle timeout in milliseconds (0 to disable)',
    format: 'nat',
    default: 300000,  // 5 minutes
    env: 'AI_ASSIST_IDLE_TIMEOUT',
  },
  autoStart: {
    doc: 'Automatically start daemon if not running',
    format: Boolean,
    default: true,
    env: 'AI_ASSIST_AUTO_START',
  },
}
```

## Security Considerations

### Unix Socket Permissions

- Socket file created with mode `0600` (owner read/write only)
- Located in user-specific directory
- No network exposure by default

### WebSocket Mode

- Optional TLS support for remote connections
- Authentication token support (future)
- Rate limiting consideration (future)

## Error Handling

### Connection Errors

```typescript
class ConnectionError extends Error {
  code: 'ECONNREFUSED' | 'ETIMEDOUT' | 'ENOENT';
}
```

### Protocol Errors

Standard JSON-RPC error codes (see Protocol section).

### Graceful Degradation

- If daemon connection fails with `autoStart: false`, throw clear error
- If daemon won't start, provide actionable error message
- Always clean up resources on failure

## Testing Strategy

### Unit Tests

- Protocol serialization/deserialization
- Request handler logic
- Adapter connection logic

### Integration Tests

- Daemon startup/shutdown lifecycle
- Client-daemon communication
- Multiple concurrent connections
- Idle timeout behavior

### Manual Testing Checklist

- [ ] `ai-assist daemon start` starts daemon
- [ ] `ai-assist daemon status` shows correct status
- [ ] `ai-assist daemon stop` stops daemon
- [ ] Daemon auto-starts when CLI command runs
- [ ] Daemon shuts down after 5 minutes idle
- [ ] Multiple CLI commands share daemon connection
- [ ] Direct mode still works (no daemon)
- [ ] Error messages are helpful when daemon fails
- [ ] `ai-assist interact` works with daemon running
- [ ] `ai-assist interact` works in direct mode (no daemon)
- [ ] Reference tools in agent work correctly via client
- [ ] `ai-assist references search` works with daemon
- [ ] `ai-assist references update-collection` works with daemon

## Future Considerations

### Additional Backend Services

The architecture supports adding new backend services (database-backed, cacheable, slow-to-initialize):

```typescript
// Examples of future backend services
"embeddings.create"           // Generate embeddings (if separated from references)
"cache.get"                   // Shared cache access
"cache.set"
"index.search"                // Code indexing/search
```

### Client-Side Service Integration

The Interact service and other client-side services use `BackendClient`:

```typescript
// src/interact/interact.ts - Updated to use BackendClient
import { BackendClient } from '#root/client/client.ts';

const createDefaultAgent = async (client: BackendClient) => {
  // Reference tools now use the client instead of Services
  const referenceTools = createReferenceTools(client);
  // ... rest of agent creation
};
```

```typescript
// src/tools/references/references.ts - Updated tool implementation
import type { BackendClient } from '#root/client/client.ts';

const createReferenceTools = (client: BackendClient) => ({
  references_search: tool(async ({ query, collections, limit }) => {
    const results = await client.references.search({ query, collections, limit });
    return JSON.stringify(results);
  }, { /* schema */ }),
  // ...
});
```

### Multi-Workspace Support

Daemon could manage multiple workspace contexts:

```typescript
"workspace.open"              // Open workspace context
"workspace.close"             // Close workspace context
"workspace.list"              // List open workspaces
```

### Remote Access

WebSocket adapter enables:
- Editor plugins connecting to local daemon
- Web UI connecting to local/remote backend
- Collaborative features (future)
