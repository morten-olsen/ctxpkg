import { randomUUID } from 'node:crypto';

import { WebSocket } from 'ws';

import type { Request, Response } from '#root/backend/backend.protocol.js';
import { ErrorCodes } from '#root/backend/backend.protocol.js';
import { Backend } from '#root/backend/backend.js';
import { DaemonManager } from '#root/daemon/daemon.manager.js';
import { destroy } from '#root/utils/utils.services.js';

type ClientAdapter = {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  request(method: string, params?: unknown): Promise<unknown>;
};

// Direct adapter - instantiates backend in-process
class DirectAdapter implements ClientAdapter {
  #backend: Backend | null = null;

  async connect(): Promise<void> {
    this.#backend = new Backend();
  }

  async disconnect(): Promise<void> {
    if (this.#backend) {
      await this.#backend[destroy]();
      this.#backend = null;
    }
  }

  isConnected(): boolean {
    return this.#backend !== null;
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    if (!this.#backend) {
      throw new Error('Not connected');
    }

    const request: Request = {
      id: randomUUID(),
      method,
      params,
    };

    const response = await this.#backend.handleRequest(request);
    return this.#handleResponse(response);
  }

  #handleResponse(response: Response): unknown {
    if (response.error) {
      const error = new Error(response.error.message);
      (error as Error & { code: number }).code = response.error.code;
      throw error;
    }
    return response.result;
  }
}

// Daemon adapter - connects via Unix socket
class DaemonAdapter implements ClientAdapter {
  #manager: DaemonManager;
  #socket: WebSocket | null = null;
  #pendingRequests = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  #timeout: number;

  constructor(options?: { socketPath?: string; autoStart?: boolean; timeout?: number }) {
    this.#manager = new DaemonManager({
      socketPath: options?.socketPath,
      autoStart: options?.autoStart ?? true,
    });
    this.#timeout = options?.timeout ?? 30000;
  }

  async connect(): Promise<void> {
    await this.#manager.ensureRunning();

    const socketPath = this.#manager.getSocketPath();
    // Connect to Unix socket - ws library uses this format: ws+unix:///path/to/socket
    const socket = new WebSocket(`ws+unix://${socketPath}:/.`);
    this.#socket = socket;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, 5000);

      socket.on('open', () => {
        clearTimeout(timeout);
        resolve();
      });

      socket.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    socket.on('message', (data) => {
      try {
        const response: Response = JSON.parse(data.toString());
        const pending = this.#pendingRequests.get(response.id);
        if (pending) {
          this.#pendingRequests.delete(response.id);
          if (response.error) {
            const error = new Error(response.error.message);
            (error as Error & { code: number }).code = response.error.code;
            pending.reject(error);
          } else {
            pending.resolve(response.result);
          }
        }
      } catch (error) {
        console.error('[client] Failed to parse response:', error);
      }
    });

    socket.on('close', () => {
      // Reject all pending requests
      for (const [id, pending] of this.#pendingRequests) {
        pending.reject(new Error('Connection closed'));
        this.#pendingRequests.delete(id);
      }
      this.#socket = null;
    });
  }

  async disconnect(): Promise<void> {
    if (this.#socket) {
      this.#socket.close();
      this.#socket = null;
    }
  }

  isConnected(): boolean {
    return this.#socket !== null && this.#socket.readyState === WebSocket.OPEN;
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    const socket = this.#socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected');
    }

    const id = randomUUID();
    const request: Request = { id, method, params };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pendingRequests.delete(id);
        const error = new Error('Request timeout');
        (error as Error & { code: number }).code = ErrorCodes.Timeout;
        reject(error);
      }, this.#timeout);

      this.#pendingRequests.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      socket.send(JSON.stringify(request));
    });
  }
}

// WebSocket adapter - connects via remote WebSocket
class WebSocketAdapter implements ClientAdapter {
  #url: string;
  #socket: WebSocket | null = null;
  #pendingRequests = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  #timeout: number;

  constructor(url: string, options?: { timeout?: number }) {
    this.#url = url;
    this.#timeout = options?.timeout ?? 30000;
  }

  async connect(): Promise<void> {
    const socket = new WebSocket(this.#url);
    this.#socket = socket;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, 5000);

      socket.on('open', () => {
        clearTimeout(timeout);
        resolve();
      });

      socket.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    socket.on('message', (data) => {
      try {
        const response: Response = JSON.parse(data.toString());
        const pending = this.#pendingRequests.get(response.id);
        if (pending) {
          this.#pendingRequests.delete(response.id);
          if (response.error) {
            const error = new Error(response.error.message);
            (error as Error & { code: number }).code = response.error.code;
            pending.reject(error);
          } else {
            pending.resolve(response.result);
          }
        }
      } catch (error) {
        console.error('[client] Failed to parse response:', error);
      }
    });

    socket.on('close', () => {
      for (const [id, pending] of this.#pendingRequests) {
        pending.reject(new Error('Connection closed'));
        this.#pendingRequests.delete(id);
      }
      this.#socket = null;
    });
  }

  async disconnect(): Promise<void> {
    if (this.#socket) {
      this.#socket.close();
      this.#socket = null;
    }
  }

  isConnected(): boolean {
    return this.#socket !== null && this.#socket.readyState === WebSocket.OPEN;
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    const socket = this.#socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected');
    }

    const id = randomUUID();
    const request: Request = { id, method, params };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pendingRequests.delete(id);
        const error = new Error('Request timeout');
        (error as Error & { code: number }).code = ErrorCodes.Timeout;
        reject(error);
      }, this.#timeout);

      this.#pendingRequests.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      socket.send(JSON.stringify(request));
    });
  }
}

export type { ClientAdapter };
export { DirectAdapter, DaemonAdapter, WebSocketAdapter };
