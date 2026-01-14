import type { ClientOptions, BackendAPI, ReferencesAPI, SystemAPI } from './client.types.ts';
import { DirectAdapter, DaemonAdapter, WebSocketAdapter, type ClientAdapter } from './client.adapters.ts';

// Create a proxy that converts method calls to RPC requests
const createServiceProxy = <T>(adapter: ClientAdapter, serviceName: string): T => {
  const target = {} as Record<string, unknown>;
  return new Proxy(target, {
    get(_target, methodName: string) {
      return async (params?: unknown) => {
        const method = `${serviceName}.${methodName}`;
        return adapter.request(method, params ?? {});
      };
    },
  }) as T;
};

class BackendClient implements BackendAPI {
  #adapter: ClientAdapter;
  #connected = false;

  // Type-safe service proxies
  readonly references: ReferencesAPI;
  readonly system: SystemAPI;

  constructor(options: ClientOptions) {
    // Create appropriate adapter
    switch (options.mode) {
      case 'direct':
        this.#adapter = new DirectAdapter();
        break;
      case 'daemon':
        this.#adapter = new DaemonAdapter({
          socketPath: options.socketPath,
          autoStart: options.autoStartDaemon,
          timeout: options.timeout,
        });
        break;
      case 'websocket':
        if (!options.url) {
          throw new Error('WebSocket URL is required for websocket mode');
        }
        this.#adapter = new WebSocketAdapter(options.url, {
          timeout: options.timeout,
        });
        break;
      default:
        throw new Error(`Unknown connection mode: ${options.mode}`);
    }

    // Create type-safe service proxies
    this.references = createServiceProxy<ReferencesAPI>(this.#adapter, 'references');
    this.system = createServiceProxy<SystemAPI>(this.#adapter, 'system');
  }

  async connect(): Promise<void> {
    await this.#adapter.connect();
    this.#connected = true;
  }

  async disconnect(): Promise<void> {
    await this.#adapter.disconnect();
    this.#connected = false;
  }

  isConnected(): boolean {
    return this.#connected && this.#adapter.isConnected();
  }

  // Generic request method for advanced usage
  async request<T>(method: string, params?: unknown): Promise<T> {
    return this.#adapter.request(method, params) as Promise<T>;
  }
}

// Factory function for creating a client with auto-detection
const createClient = async (options?: Partial<ClientOptions>): Promise<BackendClient> => {
  const mode = options?.mode ?? 'direct';
  const client = new BackendClient({ mode, ...options } as ClientOptions);
  await client.connect();
  return client;
};

export { BackendClient, createClient };
export type { ClientOptions, BackendAPI };
