/**
 * Tests for collection management commands:
 * - collections init
 * - collections add
 * - collections remove
 * - collections list
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { createTestEnv, type TestEnv } from './setup.js';

// Types for dynamically imported modules
type Services = InstanceType<typeof import('../src/utils/utils.services.js').Services>;
type CollectionsService = InstanceType<typeof import('../src/collections/collections.js').CollectionsService>;

describe('collections', () => {
  let env: TestEnv;
  let services: Services;
  let collectionsService: CollectionsService;

  beforeEach(async () => {
    // Create test environment (this resets modules and sets env vars)
    env = await createTestEnv();

    // Dynamically import after env vars are set
    const { Services } = await import('../src/utils/utils.services.js');
    const { CollectionsService } = await import('../src/collections/collections.js');

    services = new Services();
    collectionsService = services.get(CollectionsService);
  });

  afterEach(async () => {
    await services.destroy();
    await env.cleanup();
  });

  describe('init', () => {
    it('creates context.json file', () => {
      collectionsService.initProjectConfig(env.projectDir);

      const configPath = join(env.projectDir, 'context.json');
      expect(existsSync(configPath)).toBe(true);
    });

    it('creates valid JSON with empty collections', async () => {
      collectionsService.initProjectConfig(env.projectDir);

      const configPath = join(env.projectDir, 'context.json');
      const content = await readFile(configPath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed).toEqual({ collections: {} });
    });

    it('fails if context.json already exists', () => {
      collectionsService.initProjectConfig(env.projectDir);

      expect(() => {
        collectionsService.initProjectConfig(env.projectDir);
      }).toThrow(/already exists/);
    });

    it('overwrites with force option', async () => {
      // Create initial config with a collection
      collectionsService.initProjectConfig(env.projectDir);
      collectionsService.addToProjectConfig('test', { url: 'file://./test' }, env.projectDir);

      // Force overwrite
      collectionsService.initProjectConfig(env.projectDir, true);

      const config = collectionsService.readProjectConfig(env.projectDir);
      expect(config.collections).toEqual({});
    });
  });

  describe('add', () => {
    beforeEach(() => {
      collectionsService.initProjectConfig(env.projectDir);
    });

    it('adds local manifest to project config', () => {
      collectionsService.addToProjectConfig('project-docs', { url: 'file://./docs/manifest.json' }, env.projectDir);

      const config = collectionsService.readProjectConfig(env.projectDir);
      expect(config.collections['project-docs']).toEqual({
        url: 'file://./docs/manifest.json',
      });
    });

    it('adds remote manifest to project config', () => {
      collectionsService.addToProjectConfig(
        'react',
        { url: 'https://example.com/react-docs/manifest.json' },
        env.projectDir,
      );

      const config = collectionsService.readProjectConfig(env.projectDir);
      expect(config.collections['react']).toEqual({
        url: 'https://example.com/react-docs/manifest.json',
      });
    });

    it('adds bundle URL to project config', () => {
      collectionsService.addToProjectConfig('bundle-pkg', { url: 'https://example.com/docs.tar.gz' }, env.projectDir);

      const config = collectionsService.readProjectConfig(env.projectDir);
      expect(config.collections['bundle-pkg']).toEqual({
        url: 'https://example.com/docs.tar.gz',
      });
    });

    it('fails for duplicate collection name', () => {
      collectionsService.addToProjectConfig('docs', { url: 'file://./docs' }, env.projectDir);

      expect(() => {
        collectionsService.addToProjectConfig('docs', { url: 'file://./other-docs' }, env.projectDir);
      }).toThrow(/already exists/);
    });

    it('adds to global config with global option', () => {
      collectionsService.addToConfig(
        'typescript-docs',
        { url: 'https://example.com/ts-docs/manifest.json' },
        { global: true },
      );

      const globalConfig = collectionsService.readGlobalConfig();
      expect(globalConfig.collections['typescript-docs']).toEqual({
        url: 'https://example.com/ts-docs/manifest.json',
      });
    });

    it('auto-creates global config file on first add', () => {
      const globalConfigPath = collectionsService.getGlobalConfigPath();
      expect(existsSync(globalConfigPath)).toBe(false);

      collectionsService.addToConfig('global-docs', { url: 'https://example.com/docs' }, { global: true });

      expect(existsSync(globalConfigPath)).toBe(true);
    });
  });

  describe('remove', () => {
    beforeEach(() => {
      collectionsService.initProjectConfig(env.projectDir);
      collectionsService.addToProjectConfig('react', { url: 'https://example.com/react' }, env.projectDir);
      collectionsService.addToProjectConfig('lodash', { url: 'https://example.com/lodash' }, env.projectDir);
    });

    it('removes collection from project config', () => {
      collectionsService.removeFromProjectConfig('react', env.projectDir);

      const config = collectionsService.readProjectConfig(env.projectDir);
      expect(config.collections['react']).toBeUndefined();
      expect(config.collections['lodash']).toBeDefined();
    });

    it('fails for non-existent collection', () => {
      expect(() => {
        collectionsService.removeFromProjectConfig('nonexistent', env.projectDir);
      }).toThrow(/not found/);
    });

    it('removes from global config with global option', () => {
      collectionsService.addToConfig('global-docs', { url: 'https://example.com/global' }, { global: true });

      collectionsService.removeFromConfig('global-docs', { global: true });

      const globalConfig = collectionsService.readGlobalConfig();
      expect(globalConfig.collections['global-docs']).toBeUndefined();
    });
  });

  describe('list', () => {
    beforeEach(() => {
      collectionsService.initProjectConfig(env.projectDir);
    });

    it('returns empty collections when none configured', () => {
      const config = collectionsService.readProjectConfig(env.projectDir);
      expect(Object.keys(config.collections)).toHaveLength(0);
    });

    it('returns all configured collections', () => {
      collectionsService.addToProjectConfig('docs1', { url: 'file://./docs1' }, env.projectDir);
      collectionsService.addToProjectConfig('docs2', { url: 'https://example.com/docs2' }, env.projectDir);

      const config = collectionsService.readProjectConfig(env.projectDir);
      expect(Object.keys(config.collections)).toHaveLength(2);
      expect(config.collections['docs1']).toBeDefined();
      expect(config.collections['docs2']).toBeDefined();
    });

    it('getAllCollections returns both local and global', () => {
      collectionsService.addToProjectConfig('local-docs', { url: 'file://./local' }, env.projectDir);
      collectionsService.addToConfig('global-docs', { url: 'https://example.com/global' }, { global: true });

      const all = collectionsService.getAllCollections(env.projectDir);
      expect(all.size).toBe(2);
      expect(all.get('local-docs')?.source).toBe('local');
      expect(all.get('global-docs')?.source).toBe('global');
    });

    it('local collections shadow global with same name', () => {
      collectionsService.addToConfig('docs', { url: 'https://example.com/global-docs' }, { global: true });
      collectionsService.addToProjectConfig('docs', { url: 'file://./local-docs' }, env.projectDir);

      const all = collectionsService.getAllCollections(env.projectDir);
      const docs = all.get('docs');
      expect(docs?.source).toBe('local');
      expect(docs?.spec.url).toBe('file://./local-docs');
    });
  });

  describe('collection ID computation', () => {
    it('computes correct ID for https URL', () => {
      const id = collectionsService.computeCollectionId({
        url: 'https://example.com/docs/manifest.json',
      });
      expect(id).toBe('pkg:https://example.com/docs/manifest.json');
    });

    it('computes correct ID for file URL', () => {
      const id = collectionsService.computeCollectionId({
        url: 'file:///home/user/docs/manifest.json',
      });
      expect(id).toBe('pkg:file:///home/user/docs/manifest.json');
    });

    it('normalizes trailing slashes', () => {
      const id1 = collectionsService.computeCollectionId({
        url: 'https://example.com/docs/',
      });
      const id2 = collectionsService.computeCollectionId({
        url: 'https://example.com/docs',
      });
      expect(id1).toBe(id2);
    });
  });

  describe('sync status', () => {
    it('returns not_synced for new collection', async () => {
      const status = await collectionsService.getSyncStatus({
        url: 'https://example.com/new-docs/manifest.json',
      });
      expect(status).toBe('not_synced');
    });
  });
});
