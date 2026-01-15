/**
 * Integration tests for end-to-end workflows combining multiple operations.
 * These tests verify the complete user journeys documented in README.md.
 */

import { join } from 'node:path';
import { cp, writeFile, mkdir } from 'node:fs/promises';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as tar from 'tar';

import {
  createTestEnv,
  type TestEnv,
  FIXTURE_DIR,
  getMswServer,
  mockJsonResponse,
  mockTextResponse,
  createDocument,
} from './setup.ts';

// Types for dynamically imported modules
type Services = InstanceType<typeof import('../src/utils/utils.services.ts').Services>;
type CollectionsService = InstanceType<typeof import('../src/collections/collections.ts').CollectionsService>;
type BackendClient = InstanceType<typeof import('../src/client/client.ts').BackendClient>;

describe('integration', () => {
  let env: TestEnv;
  let services: Services;
  let collectionsService: CollectionsService;
  let client: BackendClient;

  beforeEach(async () => {
    env = await createTestEnv();

    const { Services } = await import('../src/utils/utils.services.ts');
    const { CollectionsService } = await import('../src/collections/collections.ts');
    const { BackendClient } = await import('../src/client/client.ts');

    services = new Services();
    collectionsService = services.get(CollectionsService);

    client = new BackendClient({ mode: 'direct' });
    await client.connect();
  });

  afterEach(async () => {
    await client.disconnect();
    await services.destroy();
    await env.cleanup();
  });

  describe('full local workflow', () => {
    it('init → add local → sync → search', async () => {
      // Step 1: Initialize project config
      collectionsService.initProjectConfig(env.projectDir);
      expect(collectionsService.projectConfigExists(env.projectDir)).toBe(true);

      // Step 2: Copy docs and add local collection
      const docsDir = join(env.projectDir, 'docs');
      await cp(join(FIXTURE_DIR, 'docs'), docsDir, { recursive: true });

      collectionsService.addToProjectConfig(
        'project-docs',
        { url: `file://${join(docsDir, 'manifest.json')}` },
        env.projectDir,
      );

      const config = collectionsService.readProjectConfig(env.projectDir);
      expect(config.collections['project-docs']).toBeDefined();

      // Step 3: Sync the collection (use client for same database as search)
      const spec = collectionsService.getFromProjectConfig('project-docs', env.projectDir);
      if (!spec) throw new Error('spec should exist');

      const syncResult = await client.collections.sync({
        name: 'project-docs',
        spec,
        cwd: env.projectDir,
      });
      expect(syncResult.added).toBeGreaterThan(0);

      // Step 4: Search the indexed documents
      const searchResults = await client.documents.search({
        query: 'authentication',
        limit: 5,
      });

      expect(searchResults.length).toBeGreaterThan(0);
      expect(searchResults[0].content).toBeTruthy();
    });
  });

  describe('remote package workflow', () => {
    const REMOTE_URL = 'https://packages.example.com/react-docs';

    beforeEach(() => {
      getMswServer().use(
        mockJsonResponse(`${REMOTE_URL}/manifest.json`, {
          name: 'react-docs',
          version: '18.2.0',
          description: 'React documentation package',
          sources: {
            files: ['hooks.md', 'components.md'],
          },
        }),
        mockTextResponse(
          `${REMOTE_URL}/hooks.md`,
          '# React Hooks\n\nuseState allows you to add state to functional components.\nuseEffect handles side effects.',
        ),
        mockTextResponse(
          `${REMOTE_URL}/components.md`,
          '# React Components\n\nComponents are the building blocks of React applications.',
        ),
      );
    });

    it('add remote → sync → search → remove', async () => {
      // Initialize
      collectionsService.initProjectConfig(env.projectDir);

      // Add remote collection
      collectionsService.addToProjectConfig('react', { url: `${REMOTE_URL}/manifest.json` }, env.projectDir);

      // Sync (use client for same database as search)
      const spec = collectionsService.getFromProjectConfig('react', env.projectDir);
      if (!spec) throw new Error('spec should exist');

      const syncResult = await client.collections.sync({
        name: 'react',
        spec,
        cwd: env.projectDir,
      });

      expect(syncResult.added).toBe(2);

      // Search
      const results = await client.documents.search({
        query: 'useState hooks',
        limit: 5,
      });
      expect(results.length).toBeGreaterThan(0);

      // Remove (including indexed data)
      const collectionId = collectionsService.computeCollectionId(spec);
      await client.documents.dropCollection({ collection: collectionId });
      collectionsService.removeFromProjectConfig('react', env.projectDir);

      // Verify removed
      const configAfter = collectionsService.readProjectConfig(env.projectDir);
      expect(configAfter.collections['react']).toBeUndefined();

      const searchAfter = await client.documents.search({ query: 'hooks', limit: 5 });
      expect(searchAfter).toHaveLength(0);
    });
  });

  describe('global + local workflow', () => {
    it('add global → add local → sync → search both', async () => {
      // Add global collection
      collectionsService.addToConfig(
        'global-docs',
        { url: 'file://' + join(FIXTURE_DIR, 'docs', 'manifest.json') },
        { global: true },
      );

      // Initialize project and add local collection
      collectionsService.initProjectConfig(env.projectDir);

      const localDocsDir = join(env.projectDir, 'local-docs');
      await mkdir(localDocsDir, { recursive: true });
      await writeFile(
        join(localDocsDir, 'manifest.json'),
        JSON.stringify({
          name: 'local-docs',
          version: '1.0.0',
          sources: { glob: ['**/*.md'] },
        }),
      );
      await createDocument(
        localDocsDir,
        'local-guide.md',
        '# Local Guide\n\nThis is local-specific content about widgets.',
      );

      collectionsService.addToProjectConfig(
        'local-docs',
        { url: `file://${join(localDocsDir, 'manifest.json')}` },
        env.projectDir,
      );

      // Get all collections (should include both)
      const allCollections = collectionsService.getAllCollections(env.projectDir);
      expect(allCollections.size).toBe(2);
      expect(allCollections.get('global-docs')?.source).toBe('global');
      expect(allCollections.get('local-docs')?.source).toBe('local');

      // Sync both (use client for same database as search)
      for (const [name, { spec }] of allCollections) {
        await client.collections.sync({
          name,
          spec,
          cwd: env.projectDir,
        });
      }

      // Search should find results from both collections
      const globalResults = await client.documents.search({
        query: 'authentication',
        limit: 5,
      });
      expect(globalResults.length).toBeGreaterThan(0);

      const localResults = await client.documents.search({
        query: 'widgets',
        limit: 5,
      });
      expect(localResults.length).toBeGreaterThan(0);
    });
  });

  describe('bundle workflow', () => {
    it('manifest init → pack → sync bundle', async () => {
      // Step 1: Create manifest (simulating manifest init)
      const sourceDir = join(env.projectDir, 'source');
      await mkdir(sourceDir, { recursive: true });

      await writeFile(
        join(sourceDir, 'manifest.json'),
        JSON.stringify({
          name: 'my-bundle',
          version: '1.0.0',
          description: 'A bundled documentation package',
          sources: { glob: ['**/*.md'] },
        }),
      );
      await createDocument(sourceDir, 'intro.md', '# Introduction\n\nWelcome to the bundle.');
      await createDocument(sourceDir, 'api.md', '# API\n\nAPI documentation here.');

      // Step 2: Pack into bundle
      const bundlePath = join(env.tempDir, 'my-bundle-1.0.0.tar.gz');
      await tar.create(
        {
          gzip: true,
          file: bundlePath,
          cwd: sourceDir,
        },
        ['manifest.json', 'intro.md', 'api.md'],
      );

      // Step 3: Initialize project and add bundle
      collectionsService.initProjectConfig(env.projectDir);
      collectionsService.addToProjectConfig('my-bundle', { url: `file://${bundlePath}` }, env.projectDir);

      // Step 4: Sync the bundle (use client for same database as search)
      const spec = collectionsService.getFromProjectConfig('my-bundle', env.projectDir);
      if (!spec) throw new Error('spec should exist');

      const result = await client.collections.sync({
        name: 'my-bundle',
        spec,
        cwd: env.projectDir,
      });

      expect(result.added).toBe(2);
      expect(result.total).toBe(2);

      // Step 5: Verify searchable
      const results = await client.documents.search({
        query: 'API documentation',
        limit: 5,
      });
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('precedence test', () => {
    it('local collection shadows global with same name', async () => {
      // Add global collection named "docs"
      const globalDocsDir = join(env.tempDir, 'global-docs');
      await mkdir(globalDocsDir, { recursive: true });
      await writeFile(
        join(globalDocsDir, 'manifest.json'),
        JSON.stringify({
          name: 'global-version',
          version: '1.0.0',
          sources: { glob: ['**/*.md'] },
        }),
      );
      await createDocument(globalDocsDir, 'global.md', '# Global\n\nThis is the GLOBAL version.');

      collectionsService.addToConfig(
        'docs',
        { url: `file://${join(globalDocsDir, 'manifest.json')}` },
        { global: true },
      );

      // Add local collection with same name "docs"
      collectionsService.initProjectConfig(env.projectDir);

      const localDocsDir = join(env.projectDir, 'local-docs');
      await mkdir(localDocsDir, { recursive: true });
      await writeFile(
        join(localDocsDir, 'manifest.json'),
        JSON.stringify({
          name: 'local-version',
          version: '2.0.0',
          sources: { glob: ['**/*.md'] },
        }),
      );
      await createDocument(localDocsDir, 'local.md', '# Local\n\nThis is the LOCAL version.');

      collectionsService.addToProjectConfig(
        'docs',
        { url: `file://${join(localDocsDir, 'manifest.json')}` },
        env.projectDir,
      );

      // Get "docs" - should return local version
      const spec = collectionsService.getFromConfig('docs', { cwd: env.projectDir });
      expect(spec?.url).toContain('local-docs');

      // getAllCollections should show local as the winner
      const all = collectionsService.getAllCollections(env.projectDir);
      const docs = all.get('docs');
      expect(docs?.source).toBe('local');
      expect(docs?.spec.url).toContain('local-docs');
    });
  });

  describe('multi-collection search', () => {
    it('searches across multiple synced collections', async () => {
      // Create and sync two collections
      collectionsService.initProjectConfig(env.projectDir);

      // Collection 1: API docs
      const apiDir = join(env.projectDir, 'api-docs');
      await mkdir(apiDir, { recursive: true });
      await writeFile(
        join(apiDir, 'manifest.json'),
        JSON.stringify({
          name: 'api-docs',
          version: '1.0.0',
          sources: { glob: ['**/*.md'] },
        }),
      );
      await createDocument(apiDir, 'rest-api.md', '# REST API\n\nEndpoints for user management.');

      collectionsService.addToProjectConfig(
        'api-docs',
        { url: `file://${join(apiDir, 'manifest.json')}` },
        env.projectDir,
      );

      // Collection 2: Tutorial docs
      const tutorialDir = join(env.projectDir, 'tutorials');
      await mkdir(tutorialDir, { recursive: true });
      await writeFile(
        join(tutorialDir, 'manifest.json'),
        JSON.stringify({
          name: 'tutorials',
          version: '1.0.0',
          sources: { glob: ['**/*.md'] },
        }),
      );
      await createDocument(
        tutorialDir,
        'getting-started.md',
        '# Getting Started Tutorial\n\nLearn the basics of user management.',
      );

      collectionsService.addToProjectConfig(
        'tutorials',
        { url: `file://${join(tutorialDir, 'manifest.json')}` },
        env.projectDir,
      );

      // Sync both (use client for same database as search)
      const config = collectionsService.readProjectConfig(env.projectDir);
      for (const [name, spec] of Object.entries(config.collections)) {
        await client.collections.sync({
          name,
          spec,
          cwd: env.projectDir,
        });
      }

      // Search across all
      const results = await client.documents.search({
        query: 'user management',
        limit: 10,
      });

      // Should find results from both collections
      expect(results.length).toBeGreaterThanOrEqual(2);

      const collections = new Set(results.map((r) => r.collection));
      expect(collections.size).toBe(2);
    });
  });
});
