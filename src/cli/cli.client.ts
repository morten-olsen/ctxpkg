import { BackendClient } from '#root/client/client.ts';
import { DaemonManager } from '#root/daemon/daemon.manager.ts';

type CliClientMode = 'auto' | 'direct' | 'daemon';

type CliClientOptions = {
  mode?: CliClientMode;
  socketPath?: string;
  timeout?: number;
};

// Factory function for CLI commands
const createCliClient = async (options?: CliClientOptions): Promise<BackendClient> => {
  const mode = options?.mode ?? 'auto';

  if (mode === 'auto') {
    // Try daemon first, fall back to direct
    const manager = new DaemonManager({ socketPath: options?.socketPath });
    const isDaemonRunning = await manager.isRunning();

    if (isDaemonRunning) {
      const client = new BackendClient({
        mode: 'daemon',
        socketPath: options?.socketPath,
        timeout: options?.timeout,
      });
      await client.connect();
      return client;
    }

    // Fall back to direct mode
    const client = new BackendClient({ mode: 'direct' });
    await client.connect();
    return client;
  }

  if (mode === 'daemon') {
    const client = new BackendClient({
      mode: 'daemon',
      socketPath: options?.socketPath,
      autoStartDaemon: true,
      timeout: options?.timeout,
    });
    await client.connect();
    return client;
  }

  // Direct mode
  const client = new BackendClient({ mode: 'direct' });
  await client.connect();
  return client;
};

export { createCliClient };
export type { CliClientOptions, CliClientMode };
