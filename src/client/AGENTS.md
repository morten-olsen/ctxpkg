# Client — Agent Guidelines

This document describes the client module architecture for AI agents working on this codebase.

## Overview

The client module provides a type-safe interface for communicating with the backend service. It supports multiple connection modes through an adapter pattern, allowing the same API to work in-process, via Unix socket (daemon), or over WebSocket.

## File Structure

| File | Purpose |
|------|---------|
| `client.ts` | `BackendClient` class and `createClient()` factory |
| `client.adapters.ts` | Connection adapters (Direct, Daemon, WebSocket) |
| `client.types.ts` | Connection modes and client options types |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     BackendClient                           │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Service Proxies (via Proxy)             │   │
│  │   .references.search()  →  "references.search"       │   │
│  │   .collections.sync()   →  "collections.sync"        │   │
│  │   .system.ping()        →  "system.ping"             │   │
│  └──────────────────────┬───────────────────────────────┘   │
│                         │                                   │
│  ┌──────────────────────▼───────────────────────────────┐   │
│  │                  ClientAdapter                       │   │
│  │   connect() | disconnect() | request() | isConnected │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
   ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
   │   Direct    │ │   Daemon    │ │  WebSocket  │
   │  (in-proc)  │ │ (Unix sock) │ │  (remote)   │
   └─────────────┘ └─────────────┘ └─────────────┘
```

## Connection Modes

| Mode | Adapter | Use Case |
|------|---------|----------|
| `direct` | `DirectAdapter` | In-process backend, no daemon needed |
| `daemon` | `DaemonAdapter` | Connect to local daemon via Unix socket |
| `websocket` | `WebSocketAdapter` | Connect to remote server |

## Usage

### Basic Usage

```typescript
import { createClient } from '#root/client/client.ts';

// Direct mode (in-process)
const client = await createClient({ mode: 'direct' });

// Daemon mode (Unix socket)
const client = await createClient({ 
  mode: 'daemon',
  socketPath: '/tmp/ctxpkg.sock',  // optional
  autoStartDaemon: true,           // optional, default true
});

// WebSocket mode
const client = await createClient({ 
  mode: 'websocket',
  url: 'ws://localhost:8080',
});

// Use type-safe API
const results = await client.references.search({ query: 'foo' });
await client.disconnect();
```

### Service Proxies

The client uses `Proxy` to convert method calls into RPC requests:

```typescript
client.references.search({ query: 'foo' })
// → adapter.request('references.search', { query: 'foo' })
```

This provides full type safety — methods and parameters are typed from `BackendAPI`.

## Adding a New Adapter

1. Implement the `ClientAdapter` interface:

```typescript
class MyAdapter implements ClientAdapter {
  async connect(): Promise<void> { /* ... */ }
  async disconnect(): Promise<void> { /* ... */ }
  isConnected(): boolean { /* ... */ }
  async request(method: string, params?: unknown): Promise<unknown> { /* ... */ }
}
```

2. Add a new connection mode in `client.types.ts`:

```typescript
export type ConnectionMode = 'direct' | 'daemon' | 'websocket' | 'mymode';
```

3. Handle it in `BackendClient` constructor in `client.ts`.

## Key Patterns

### Request/Response Handling

Adapters must:
- Generate unique request IDs (use `randomUUID()`)
- Track pending requests for async response matching
- Handle timeouts and connection errors
- Parse responses and throw on errors

### Error Handling

Errors from the backend include a `code` property matching `ErrorCodes`:

```typescript
try {
  await client.references.search({ query: 'foo' });
} catch (error) {
  if (error.code === ErrorCodes.Timeout) { /* ... */ }
}
```

### Daemon Auto-Start

`DaemonAdapter` uses `DaemonManager` to auto-start the daemon if not running. This is controlled by the `autoStartDaemon` option.
