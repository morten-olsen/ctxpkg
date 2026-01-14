import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { WebSocket } from 'ws';

import { getSocketPath, getPidFile, getAutoStart } from './daemon.config.ts';
import type { DaemonStatus } from './daemon.schemas.ts';

type DaemonManagerOptions = {
  socketPath?: string;
  pidFile?: string;
  autoStart?: boolean;
  startTimeout?: number;
};

class DaemonManager {
  #socketPath: string;
  #pidFile: string;
  #autoStart: boolean;
  #startTimeout: number;

  constructor(options?: DaemonManagerOptions) {
    this.#socketPath = options?.socketPath ?? getSocketPath();
    this.#pidFile = options?.pidFile ?? getPidFile();
    this.#autoStart = options?.autoStart ?? getAutoStart();
    this.#startTimeout = options?.startTimeout ?? 30000;
  }

  getSocketPath(): string {
    return this.#socketPath;
  }

  async isRunning(): Promise<boolean> {
    // Check if socket file exists
    try {
      await access(this.#socketPath);
    } catch {
      return false;
    }

    // Try to connect and ping
    return new Promise((resolve) => {
      const socket = new WebSocket(`ws+unix://${this.#socketPath}:/.`);
      const timeout = setTimeout(() => {
        socket.close();
        resolve(false);
      }, 2000);

      socket.on('open', () => {
        // Send ping request
        socket.send(JSON.stringify({ id: 'ping', method: 'system.ping', params: {} }));
      });

      socket.on('message', (data) => {
        clearTimeout(timeout);
        try {
          const response = JSON.parse(data.toString());
          socket.close();
          resolve(response.result?.pong === true);
        } catch {
          socket.close();
          resolve(false);
        }
      });

      socket.on('error', () => {
        clearTimeout(timeout);
        resolve(false);
      });
    });
  }

  async ensureRunning(): Promise<void> {
    if (await this.isRunning()) {
      return;
    }

    if (!this.#autoStart) {
      throw new Error('Daemon is not running and autoStart is disabled');
    }

    await this.start();
  }

  async start(): Promise<void> {
    if (await this.isRunning()) {
      return;
    }

    // Find the daemon entry point
    const currentFile = fileURLToPath(import.meta.url);
    const projectRoot = dirname(dirname(dirname(currentFile)));
    const daemonScript = join(projectRoot, 'bin', 'daemon.js');

    // Spawn detached daemon process
    const child = spawn(process.execPath, [daemonScript], {
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        AI_ASSIST_DAEMON: '1',
      },
    });

    child.unref();

    // Wait for socket to become available
    await this.#waitForSocket();
  }

  async #waitForSocket(): Promise<void> {
    const startTime = Date.now();
    const pollInterval = 100;

    while (Date.now() - startTime < this.#startTimeout) {
      if (await this.isRunning()) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Daemon failed to start within ${this.#startTimeout}ms`);
  }

  async stop(): Promise<void> {
    if (!(await this.isRunning())) {
      return;
    }

    // Send shutdown command
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws+unix://${this.#socketPath}:/.`);
      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error('Shutdown request timed out'));
      }, 5000);

      socket.on('open', () => {
        socket.send(JSON.stringify({ id: 'shutdown', method: 'system.shutdown', params: {} }));
      });

      socket.on('message', () => {
        clearTimeout(timeout);
        socket.close();
        resolve();
      });

      socket.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      socket.on('close', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  async getStatus(): Promise<DaemonStatus | null> {
    if (!(await this.isRunning())) {
      return null;
    }

    return new Promise((resolve) => {
      const socket = new WebSocket(`ws+unix://${this.#socketPath}:/.`);
      const timeout = setTimeout(() => {
        socket.close();
        resolve(null);
      }, 2000);

      socket.on('open', () => {
        socket.send(JSON.stringify({ id: 'status', method: 'system.status', params: {} }));
      });

      socket.on('message', async (data) => {
        clearTimeout(timeout);
        try {
          const response = JSON.parse(data.toString());
          socket.close();

          // Read PID from file
          let pid = 0;
          try {
            const pidContent = await readFile(this.#pidFile, 'utf8');
            pid = parseInt(pidContent, 10);
          } catch {
            // Ignore
          }

          resolve({
            running: true,
            socketPath: this.#socketPath,
            pid,
            uptime: response.result?.uptime ?? 0,
            connections: response.result?.connections ?? 0,
          });
        } catch {
          socket.close();
          resolve(null);
        }
      });

      socket.on('error', () => {
        clearTimeout(timeout);
        resolve(null);
      });
    });
  }
}

export { DaemonManager };
export type { DaemonManagerOptions };
