import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

import convict from 'convict';
import envPaths from 'env-paths';

const paths = envPaths('ai-assist', { suffix: '' });
const configPath = join(paths.config, 'config.json');

// Use ~/.ai-assist for runtime files to avoid spaces in path (ws library URL encoding issue)
const runtimeDir = join(homedir(), '.ai-assist');

const config = convict({
  database: {
    path: {
      doc: 'Path to the SQLite database file',
      format: String,
      default: join(paths.data, 'database.sqlite'),
      env: 'AI_ASSIST_DATABASE_PATH',
    },
  },
  daemon: {
    socketPath: {
      doc: 'Path to the daemon Unix socket file',
      format: String,
      default: join(runtimeDir, 'daemon.sock'),
      env: 'AI_ASSIST_SOCKET_PATH',
    },
    pidFile: {
      doc: 'Path to the daemon PID file',
      format: String,
      default: join(runtimeDir, 'daemon.pid'),
      env: 'AI_ASSIST_PID_FILE',
    },
    idleTimeout: {
      doc: 'Idle timeout in milliseconds before daemon shuts down (0 to disable)',
      format: 'nat',
      default: 5 * 60 * 1000, // 5 minutes
      env: 'AI_ASSIST_IDLE_TIMEOUT',
    },
    autoStart: {
      doc: 'Automatically start daemon when CLI commands need it',
      format: Boolean,
      default: true,
      env: 'AI_ASSIST_AUTO_START',
    },
  },
  openai: {
    apiKey: {
      doc: 'The API key for the OpenAI compatible provider',
      format: String,
      default: '',
      env: 'OPENAI_API_KEY',
      sensitive: true,
    },
    baseUrl: {
      doc: 'The base URL for the API (optional)',
      format: String,
      default: 'https://api.openai.com/v1',
      env: 'OPENAI_BASE_URL',
    },
    model: {
      doc: 'The model to use',
      format: String,
      default: 'gpt-4o',
      env: 'OPENAI_MODEL',
    },
    temperature: {
      doc: 'The temperature for generation',
      format: Number,
      default: 0,
    },
  },
  references: {
    defaultCollections: {
      doc: 'Default collections to search in (optional)',
      format: Array,
      default: [] as string[],
      env: 'AI_ASSIST_DEFAULT_COLLECTIONS',
    },
  },
});

// Ensure config directory exists for future writes, but don't fail if we can't read yet
if (existsSync(configPath)) {
  try {
    config.loadFile(configPath);
  } catch (e) {
    console.warn(`Failed to load config from ${configPath}:`, e);
  }
}

config.validate({ allowed: 'strict' });

export { config, configPath };

export const saveConfig = () => {
  if (!existsSync(paths.config)) {
    mkdirSync(paths.config, { recursive: true });
  }
  writeFileSync(configPath, JSON.stringify(config.get(), null, 2));
};
