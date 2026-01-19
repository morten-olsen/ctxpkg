import { createServer, type Server } from 'node:http';
import { mkdir, rm, writeFile, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

import { WebSocketServer, WebSocket } from 'ws';

import { Backend } from '../backend/backend.js';
import { destroy } from '../utils/utils.services.js';

import { getSocketPath, getPidFile, getIdleTimeout } from './daemon.config.js';
import type { DaemonOptions, DaemonStatus } from './daemon.schemas.js';

class Daemon {
  #backend: Backend;
  #httpServer: Server | null = null;
  #wsServer: WebSocketServer | null = null;
  #connections = new Set<WebSocket>();
  #idleTimer: ReturnType<typeof setTimeout> | null = null;
  #startTime = 0;
  #socketPath: string;
  #pidFile: string;
  #idleTimeout: number;
  #isShuttingDown = false;

  constructor(options?: DaemonOptions) {
    this.#socketPath = options?.socketPath ?? getSocketPath();
    this.#pidFile = options?.pidFile ?? getPidFile();
    this.#idleTimeout = options?.idleTimeout ?? getIdleTimeout();
    this.#backend = new Backend();
  }

  async start(): Promise<void> {
    // Ensure data directory exists
    await mkdir(dirname(this.#socketPath), { recursive: true });

    // Remove existing socket file if present
    try {
      await rm(this.#socketPath, { force: true });
    } catch {
      // Ignore errors
    }

    // Write PID file
    await writeFile(this.#pidFile, String(process.pid));

    // Create HTTP server listening on Unix socket
    this.#httpServer = createServer();

    // Create WebSocket server attached to HTTP server
    this.#wsServer = new WebSocketServer({ server: this.#httpServer });
    this.#startTime = Date.now();

    this.#wsServer.on('connection', (socket) => {
      this.#handleConnection(socket);
    });

    this.#wsServer.on('error', (error) => {
      console.error('[daemon] WebSocket server error:', error);
    });

    this.#httpServer.on('error', (error) => {
      console.error('[daemon] HTTP server error:', error);
    });

    // Start listening on Unix socket
    await new Promise<void>((resolve, reject) => {
      this.#httpServer?.listen(this.#socketPath, () => {
        resolve();
      });
      this.#httpServer?.on('error', reject);
    });

    // Start idle timer if no connections
    this.#resetIdleTimer();

    // Handle shutdown signals
    process.on('SIGTERM', () => this.stop());
    process.on('SIGINT', () => this.stop());

    console.log(`[daemon] Started on ${this.#socketPath} (PID: ${process.pid})`);
  }

  #handleConnection(socket: WebSocket): void {
    this.#connections.add(socket);
    this.#backend.setConnectionCount(this.#connections.size);
    this.#clearIdleTimer();

    console.log(`[daemon] Client connected (${this.#connections.size} total)`);

    socket.on('message', async (data) => {
      try {
        const request = JSON.parse(data.toString());
        const response = await this.#backend.handleRequest(request);
        socket.send(JSON.stringify(response));
      } catch (error) {
        const errorResponse = {
          id: 'unknown',
          error: {
            code: -32700,
            message: error instanceof Error ? error.message : 'Parse error',
          },
        };
        socket.send(JSON.stringify(errorResponse));
      }
    });

    socket.on('close', () => {
      this.#connections.delete(socket);
      this.#backend.setConnectionCount(this.#connections.size);
      console.log(`[daemon] Client disconnected (${this.#connections.size} remaining)`);

      if (this.#connections.size === 0) {
        this.#resetIdleTimer();
      }
    });

    socket.on('error', (error) => {
      console.error('[daemon] Socket error:', error);
      this.#connections.delete(socket);
      this.#backend.setConnectionCount(this.#connections.size);
    });
  }

  #resetIdleTimer(): void {
    this.#clearIdleTimer();

    if (this.#idleTimeout > 0 && this.#connections.size === 0) {
      console.log(`[daemon] Starting idle timer (${this.#idleTimeout / 1000}s)`);
      this.#idleTimer = setTimeout(() => {
        console.log('[daemon] Idle timeout reached, shutting down');
        this.stop();
      }, this.#idleTimeout);
    }
  }

  #clearIdleTimer(): void {
    if (this.#idleTimer) {
      clearTimeout(this.#idleTimer);
      this.#idleTimer = null;
    }
  }

  async stop(): Promise<void> {
    if (this.#isShuttingDown) return;
    this.#isShuttingDown = true;

    console.log('[daemon] Shutting down...');

    this.#clearIdleTimer();

    // Close all WebSocket connections
    for (const socket of this.#connections) {
      socket.close(1000, 'Server shutting down');
    }
    this.#connections.clear();

    // Close WebSocket server
    const wsServer = this.#wsServer;
    if (wsServer) {
      await new Promise<void>((resolve) => {
        wsServer.close(() => resolve());
      });
      this.#wsServer = null;
    }

    // Close HTTP server
    const httpServer = this.#httpServer;
    if (httpServer) {
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
      this.#httpServer = null;
    }

    // Cleanup backend
    await this.#backend[destroy]();

    // Remove socket and PID files
    try {
      await unlink(this.#socketPath);
    } catch {
      // Ignore
    }
    try {
      await unlink(this.#pidFile);
    } catch {
      // Ignore
    }

    console.log('[daemon] Stopped');
    process.exit(0);
  }

  getStatus(): DaemonStatus {
    return {
      running: this.#httpServer !== null,
      socketPath: this.#socketPath,
      pid: process.pid,
      uptime: Date.now() - this.#startTime,
      connections: this.#connections.size,
    };
  }
}

export { Daemon };
