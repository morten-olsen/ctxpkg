/**
 * Tests for config commands:
 * - config list
 * - config get
 * - config set
 * - config path
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { createTestEnv, type TestEnv } from './setup.js';

describe('config', () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = await createTestEnv();
  });

  afterEach(async () => {
    await env.cleanup();
  });

  describe('config values', () => {
    it('has database.path config', async () => {
      const { config } = await import('../src/config/config.js');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dbPath = (config as any).get('database.path') as string;

      expect(dbPath).toBeDefined();
      expect(typeof dbPath).toBe('string');
    });

    it('has project.configFile config', async () => {
      const { config } = await import('../src/config/config.js');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const configFile = (config as any).get('project.configFile') as string;

      expect(configFile).toBe('context.json');
    });

    it('has global.configFile config', async () => {
      const { config } = await import('../src/config/config.js');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const globalConfig = (config as any).get('global.configFile') as string;

      expect(globalConfig).toBeDefined();
      expect(typeof globalConfig).toBe('string');
    });

    it('has daemon config options', async () => {
      const { config } = await import('../src/config/config.js');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const socketPath = (config as any).get('daemon.socketPath') as string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pidFile = (config as any).get('daemon.pidFile') as string;

      expect(socketPath).toBeDefined();
      expect(pidFile).toBeDefined();
    });

    it('respects environment variable overrides', async () => {
      // env vars are set in createTestEnv
      const { config } = await import('../src/config/config.js');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dbPath = (config as any).get('database.path') as string;

      // Should be ':memory:' as set in test env
      expect(dbPath).toBe(':memory:');
    });
  });

  describe('config schema', () => {
    it('exports configPath', async () => {
      const { configPath } = await import('../src/config/config.js');

      expect(configPath).toBeDefined();
      expect(typeof configPath).toBe('string');
    });

    it('exports saveConfig function', async () => {
      const { saveConfig } = await import('../src/config/config.js');

      expect(saveConfig).toBeDefined();
      expect(typeof saveConfig).toBe('function');
    });
  });
});
