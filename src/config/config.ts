import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

import convict from 'convict';
import envPaths from 'env-paths';

const paths = envPaths('ctxpkg', { suffix: '' });
const configPath = join(paths.config, 'config.json');

// Use ~/.ctxpkg for runtime files to avoid spaces in path (ws library URL encoding issue)
const runtimeDir = join(homedir(), '.ctxpkg');

const config = convict({
  database: {
    path: {
      doc: 'Path to the SQLite database file',
      format: String,
      default: join(paths.data, 'database.sqlite'),
      env: 'CTXPKG_DATABASE_PATH',
    },
  },
  llm: {
    provider: {
      doc: 'OpenAI-compatible API base URL',
      format: String,
      default: 'https://api.openai.com/v1',
      env: 'CTXPKG_LLM_PROVIDER',
    },
    model: {
      doc: 'Model identifier to use for agent reasoning',
      format: String,
      default: 'gpt-4o-mini',
      env: 'CTXPKG_LLM_MODEL',
    },
    apiKey: {
      doc: 'API key for the LLM provider',
      format: String,
      default: '',
      env: 'CTXPKG_LLM_API_KEY',
      sensitive: true,
    },
    temperature: {
      doc: 'Temperature for LLM responses (0-2)',
      format: Number,
      default: 0,
      env: 'CTXPKG_LLM_TEMPERATURE',
    },
    maxTokens: {
      doc: 'Maximum tokens for LLM responses',
      format: 'nat',
      default: 4096,
      env: 'CTXPKG_LLM_MAX_TOKENS',
    },
  },
  daemon: {
    socketPath: {
      doc: 'Path to the daemon Unix socket file',
      format: String,
      default: join(runtimeDir, 'daemon.sock'),
      env: 'CTXPKG_SOCKET_PATH',
    },
    pidFile: {
      doc: 'Path to the daemon PID file',
      format: String,
      default: join(runtimeDir, 'daemon.pid'),
      env: 'CTXPKG_PID_FILE',
    },
    idleTimeout: {
      doc: 'Idle timeout in milliseconds before daemon shuts down (0 to disable)',
      format: 'nat',
      default: 0,
      env: 'CTXPKG_IDLE_TIMEOUT',
    },
    autoStart: {
      doc: 'Automatically start daemon when CLI commands need it',
      format: Boolean,
      default: true,
      env: 'CTXPKG_AUTO_START',
    },
  },
  project: {
    configFile: {
      doc: 'Filename for project configuration file',
      format: String,
      default: 'context.json',
      env: 'CTXPKG_PROJECT_CONFIG_FILE',
    },
  },
  global: {
    configFile: {
      doc: 'Path to global collections config file',
      format: String,
      default: join(paths.config, 'global-context.json'),
      env: 'CTXPKG_GLOBAL_CONFIG_FILE',
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
