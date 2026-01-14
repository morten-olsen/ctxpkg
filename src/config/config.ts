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
      default: 5 * 60 * 1000, // 5 minutes
      env: 'CTXPKG_IDLE_TIMEOUT',
    },
    autoStart: {
      doc: 'Automatically start daemon when CLI commands need it',
      format: Boolean,
      default: true,
      env: 'CTXPKG_AUTO_START',
    },
  },
  references: {
    defaultCollections: {
      doc: 'Default collections to search in (optional)',
      format: Array,
      default: [] as string[],
      env: 'CTXPKG_DEFAULT_COLLECTIONS',
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
