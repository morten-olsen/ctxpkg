# Daemon — Agent Guidelines

This document describes the daemon module architecture for AI agents working on this codebase.

## Overview

The daemon module provides a background process that hosts the Backend service. It listens on a Unix socket, accepts WebSocket connections, and routes JSON-RPC requests to the Backend. The daemon supports idle timeout for automatic shutdown and can be auto-started on demand.

## File Structure

| File | Purpose |
|------|---------|
| `daemon.ts` | `Daemon` class — server lifecycle, connections, idle timeout |
| `daemon.manager.ts` | `DaemonManager` — start/stop/status from external processes |
| `daemon.config.ts` | Config accessors (socket path, PID file, timeouts) |
| `daemon.schemas.ts` | Zod schemas for `DaemonStatus` and `DaemonOptions` |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Daemon                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                   HTTP Server                       │    │
│  │              (Unix socket listener)                 │    │
│  └──────────────────────┬──────────────────────────────┘    │
│                         │                                   │
│  ┌──────────────────────▼──────────────────────────────┐    │
│  │                WebSocket Server                     │    │
│  │         (handles client connections)                │    │
│  └──────────────────────┬──────────────────────────────┘    │
│                         │                                   │
│           ┌─────────────┼─────────────┐                     │
│           ▼             ▼             ▼                     │
│      [Client 1]    [Client 2]    [Client N]                 │
│           │             │             │                     │
│           └─────────────┼─────────────┘                     │
│                         ▼                                   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                    Backend                           │   │
│  │              (request handling)                      │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    DaemonManager                            │
│  (runs in CLI/client process, controls daemon externally)   │
│                                                             │
│  isRunning() → ping via socket                              │
│  start()     → spawn detached process                       │
│  stop()      → send system.shutdown                         │
│  getStatus() → query system.status                          │
└─────────────────────────────────────────────────────────────┘
```

## Daemon Lifecycle

### Startup

1. Create data directory if needed
2. Remove stale socket file
3. Write PID file
4. Create HTTP server on Unix socket
5. Attach WebSocket server
6. Start idle timer (if no connections)
7. Register signal handlers (SIGTERM, SIGINT)

### Connections

- Each WebSocket connection is tracked
- Messages are parsed as JSON and routed to `Backend.handleRequest()`
- Responses are sent back as JSON
- Connection count is updated on connect/disconnect

### Idle Timeout

- Timer starts when connection count reaches 0
- Default: 5 minutes (configurable via `daemon.idleTimeout`)
- Set to 0 to disable auto-shutdown
- Timer is cleared when a client connects

### Shutdown

1. Clear idle timer
2. Close all WebSocket connections
3. Close WebSocket server
4. Close HTTP server
5. Cleanup Backend resources
6. Remove socket and PID files
7. Exit process

## DaemonManager

Used by CLI and client to control the daemon:

```typescript
const manager = new DaemonManager();

// Check if running
if (await manager.isRunning()) {
  console.log('Daemon is running');
}

// Start (spawns detached process)
await manager.start();

// Stop (sends shutdown command)
await manager.stop();

// Get status
const status = await manager.getStatus();
// { running, socketPath, pid, uptime, connections }
```

### Auto-Start

`DaemonManager.ensureRunning()` will start the daemon if not running (when `autoStart` is enabled). This is used by `DaemonAdapter` in the client.

## Configuration

Accessed via `daemon.config.ts`:

| Config Key | Default | Description |
|------------|---------|-------------|
| `daemon.socketPath` | `~/.ai-assist/daemon.sock` | Unix socket path |
| `daemon.pidFile` | `~/.ai-assist/daemon.pid` | PID file path |
| `daemon.idleTimeout` | `300000` (5 min) | Idle shutdown timeout (ms), 0 to disable |
| `daemon.autoStart` | `true` | Auto-start daemon when client connects |

## Entry Point

The daemon is started via `bin/daemon.js`:

```typescript
import { Daemon } from '#root/daemon/daemon.ts';

const daemon = new Daemon();
await daemon.start();
```

This script is spawned as a detached process by `DaemonManager.start()`.

## Key Patterns

### Process Management

- PID file tracks the daemon process
- Detached spawn ensures daemon outlives parent
- Socket file existence + ping confirms daemon is alive

### Graceful Shutdown

Always handle shutdown signals:

```typescript
process.on('SIGTERM', () => daemon.stop());
process.on('SIGINT', () => daemon.stop());
```

### Client Connection Format

Clients connect via WebSocket to the Unix socket:

```typescript
const socket = new WebSocket(`ws+unix://${socketPath}:/.`);
```

This is handled by the `ws` library's Unix socket support.
