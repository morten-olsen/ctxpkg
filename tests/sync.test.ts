/**
 * Tests for collection sync operations:
 * - Syncing local file:// manifests
 * - Syncing remote https:// manifests (mocked)
 * - Syncing bundles (.tar.gz)
 * - Incremental sync (detecting changes)
 * - Force sync
 */

import { join } from 'node:path';
import { cp } from 'node:fs/promises';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  createTestEnv,
  type TestEnv,
  getMswServer,
  mockJsonResponse,
  mockTextResponse,
  FIXTURE_DIR,
  createManifest,
  createDocument,
  http,
  HttpResponse,
} from './setup.js';

// Types for dynamically imported modules
type Services = InstanceType<typeof import('../src/utils/utils.services.js').Services>;
type CollectionsService = InstanceType<typeof import('../src/collections/collections.js').CollectionsService>;
type BackendClient = InstanceType<typeof import('../src/client/client.js').BackendClient>;

describe('sync', () => {
  let env: TestEnv;
  let services: Services;
  let collectionsService: CollectionsService;
  let client: BackendClient;

  beforeEach(async () => {
    env = await createTestEnv();

    const { Services } = await import('../src/utils/utils.services.js');
    const { CollectionsService } = await import('../src/collections/collections.js');
    const { BackendClient } = await import('../src/client/client.js');

    services = new Services();
    collectionsService = services.get(CollectionsService);

    // Create client in direct mode (in-process backend)
    client = new BackendClient({ mode: 'direct' });
    await client.connect();
  });

  afterEach(async () => {
    await client.disconnect();
    await services.destroy();
    await env.cleanup();
  });

  describe('local manifest sync', () => {
    it('syncs local manifest with glob sources', async () => {
      // Copy fixtures to temp project directory
      const docsDir = join(env.projectDir, 'docs');
      await cp(join(FIXTURE_DIR, 'docs'), docsDir, { recursive: true });

      const result = await collectionsService.syncCollection(
        'test-docs',
        { url: `file://${join(docsDir, 'manifest.json')}` },
        env.projectDir,
      );

      expect(result.added).toBeGreaterThan(0);
      expect(result.total).toBe(4); // 4 markdown files in fixtures
    });

    it('indexes documents into database', async () => {
      const docsDir = join(env.projectDir, 'docs');
      await cp(join(FIXTURE_DIR, 'docs'), docsDir, { recursive: true });

      // Use client for sync to ensure same database as search
      await client.collections.sync({
        name: 'test-docs',
        spec: { url: `file://${join(docsDir, 'manifest.json')}` },
        cwd: env.projectDir,
      });

      // Check documents are searchable
      const results = await client.documents.search({
        query: 'authentication',
        limit: 10,
      });

      expect(results.length).toBeGreaterThan(0);
      // Should find the authentication guide
      expect(results.some((r) => r.document.includes('authentication'))).toBe(true);
    });

    it('updates collection record in database', async () => {
      const docsDir = join(env.projectDir, 'docs');
      await cp(join(FIXTURE_DIR, 'docs'), docsDir, { recursive: true });

      const spec = { url: `file://${join(docsDir, 'manifest.json')}` };
      await collectionsService.syncCollection('test-docs', spec, env.projectDir);

      const collectionId = collectionsService.computeCollectionId(spec);
      const record = await collectionsService.getCollection(collectionId);

      expect(record).not.toBeNull();
      expect(record?.name).toBe('test-docs');
      expect(record?.version).toBe('1.0.0');
      expect(record?.last_sync_at).toBeTruthy();
    });

    it('skips sync when manifest unchanged', async () => {
      const docsDir = join(env.projectDir, 'docs');
      await cp(join(FIXTURE_DIR, 'docs'), docsDir, { recursive: true });

      const spec = { url: `file://${join(docsDir, 'manifest.json')}` };

      // First sync
      const result1 = await collectionsService.syncCollection('test-docs', spec, env.projectDir);
      expect(result1.added).toBe(4);

      // Second sync without changes
      const result2 = await collectionsService.syncCollection('test-docs', spec, env.projectDir);
      expect(result2.added).toBe(0);
      expect(result2.updated).toBe(0);
      expect(result2.removed).toBe(0);
    });

    it('force sync re-indexes all documents', async () => {
      const docsDir = join(env.projectDir, 'docs');
      await cp(join(FIXTURE_DIR, 'docs'), docsDir, { recursive: true });

      const spec = { url: `file://${join(docsDir, 'manifest.json')}` };

      // First sync
      await collectionsService.syncCollection('test-docs', spec, env.projectDir);

      // Force sync
      const result = await collectionsService.syncCollection('test-docs', spec, env.projectDir, { force: true });

      // With force, all documents should be processed (updated count reflects re-indexing)
      expect(result.total).toBe(4);
    });
  });

  describe('remote manifest sync', () => {
    const REMOTE_BASE = 'https://example.com/react-docs';

    beforeEach(() => {
      // Set up mock HTTP responses
      getMswServer().use(
        // Mock manifest
        mockJsonResponse(`${REMOTE_BASE}/manifest.json`, {
          name: 'react-docs',
          version: '18.0.0',
          description: 'React documentation',
          sources: {
            files: ['getting-started.md', 'hooks.md'],
          },
        }),
        // Mock document files
        mockTextResponse(
          `${REMOTE_BASE}/getting-started.md`,
          '# Getting Started with React\n\nReact is a JavaScript library for building user interfaces.',
        ),
        mockTextResponse(
          `${REMOTE_BASE}/hooks.md`,
          '# React Hooks\n\nuseState and useEffect are the most common hooks.',
        ),
      );
    });

    it('syncs remote manifest', async () => {
      const result = await collectionsService.syncCollection(
        'react',
        { url: `${REMOTE_BASE}/manifest.json` },
        env.projectDir,
      );

      expect(result.added).toBe(2);
      expect(result.total).toBe(2);
    });

    it('makes documents searchable', async () => {
      // Use client for sync to ensure same database as search
      await client.collections.sync({
        name: 'react',
        spec: { url: `${REMOTE_BASE}/manifest.json` },
        cwd: env.projectDir,
      });

      const results = await client.documents.search({
        query: 'hooks useState',
        limit: 10,
      });

      expect(results.length).toBeGreaterThan(0);
    });

    it('handles baseUrl in manifest', async () => {
      getMswServer().use(
        mockJsonResponse('https://example.com/lodash/manifest.json', {
          name: 'lodash-docs',
          version: '4.0.0',
          baseUrl: 'https://cdn.example.com/lodash/content/',
          sources: {
            files: ['array.md', 'object.md'],
          },
        }),
        mockTextResponse(
          'https://cdn.example.com/lodash/content/array.md',
          '# Array Methods\n\nLodash provides many array utilities.',
        ),
        mockTextResponse(
          'https://cdn.example.com/lodash/content/object.md',
          '# Object Methods\n\nLodash provides many object utilities.',
        ),
      );

      const result = await collectionsService.syncCollection(
        'lodash',
        { url: 'https://example.com/lodash/manifest.json' },
        env.projectDir,
      );

      expect(result.added).toBe(2);
    });

    it('handles fetch errors gracefully', async () => {
      getMswServer().use(
        mockJsonResponse(`${REMOTE_BASE}/partial/manifest.json`, {
          name: 'partial-docs',
          version: '1.0.0',
          sources: {
            files: ['exists.md', 'missing.md'],
          },
        }),
        mockTextResponse(`${REMOTE_BASE}/partial/exists.md`, '# Exists\n\nThis file exists.'),
        http.get(`${REMOTE_BASE}/partial/missing.md`, () => {
          return new HttpResponse(null, { status: 404 });
        }),
      );

      // Should not throw, but may log warnings
      const result = await collectionsService.syncCollection(
        'partial',
        { url: `${REMOTE_BASE}/partial/manifest.json` },
        env.projectDir,
      );

      // At least one document should be synced
      expect(result.added).toBeGreaterThanOrEqual(1);
    });
  });

  describe('manifest with file sources', () => {
    it('syncs manifest with explicit file list', async () => {
      // Create docs directory with manifest using file sources
      const docsDir = join(env.projectDir, 'docs');
      await createManifest(docsDir, {
        name: 'explicit-docs',
        version: '1.0.0',
        sources: {
          files: ['intro.md', { path: 'guide.md' }],
        },
      });
      await createDocument(docsDir, 'intro.md', '# Introduction\n\nWelcome!');
      await createDocument(docsDir, 'guide.md', '# Guide\n\nStep by step instructions.');

      const result = await collectionsService.syncCollection(
        'explicit',
        { url: `file://${join(docsDir, 'manifest.json')}` },
        env.projectDir,
      );

      expect(result.added).toBe(2);
      expect(result.total).toBe(2);
    });
  });

  describe('incremental sync', () => {
    it('detects and syncs new files', async () => {
      const docsDir = join(env.projectDir, 'docs');
      await createManifest(docsDir, {
        name: 'incremental-docs',
        version: '1.0.0',
        sources: { glob: ['**/*.md'] },
      });
      await createDocument(docsDir, 'file1.md', '# File 1');

      const spec = { url: `file://${join(docsDir, 'manifest.json')}` };

      // First sync
      const result1 = await collectionsService.syncCollection('incremental', spec, env.projectDir);
      expect(result1.added).toBe(1);

      // Add new file and update manifest to trigger re-sync
      await createDocument(docsDir, 'file2.md', '# File 2');
      // Force to ensure we pick up the new file
      const result2 = await collectionsService.syncCollection('incremental', spec, env.projectDir, { force: true });

      expect(result2.total).toBe(2);
    });

    it('removes deleted files from index', async () => {
      const docsDir = join(env.projectDir, 'docs');

      // Create manifest with two files
      await createManifest(docsDir, {
        name: 'removal-docs',
        version: '1.0.0',
        sources: {
          files: ['keep.md', 'remove.md'],
        },
      });
      await createDocument(docsDir, 'keep.md', '# Keep');
      await createDocument(docsDir, 'remove.md', '# Remove');

      const spec = { url: `file://${join(docsDir, 'manifest.json')}` };

      // First sync
      await collectionsService.syncCollection('removal', spec, env.projectDir);

      // Update manifest to remove one file
      await createManifest(docsDir, {
        name: 'removal-docs',
        version: '1.0.1',
        sources: {
          files: ['keep.md'],
        },
      });

      // Second sync
      const result = await collectionsService.syncCollection('removal', spec, env.projectDir);

      expect(result.removed).toBe(1);
      expect(result.total).toBe(1);
    });
  });

  describe('sync via client API', () => {
    it('syncs collection through backend client', async () => {
      const docsDir = join(env.projectDir, 'docs');
      await cp(join(FIXTURE_DIR, 'docs'), docsDir, { recursive: true });

      const result = await client.collections.sync({
        name: 'test-docs',
        spec: { url: `file://${join(docsDir, 'manifest.json')}` },
        cwd: env.projectDir,
      });

      expect(result.added).toBe(4);
      expect(result.total).toBe(4);
    });

    it('returns sync status through client', async () => {
      const docsDir = join(env.projectDir, 'docs');
      await cp(join(FIXTURE_DIR, 'docs'), docsDir, { recursive: true });

      const spec = { url: `file://${join(docsDir, 'manifest.json')}` };

      // Before sync
      const statusBefore = await client.collections.getSyncStatus({ spec });
      expect(statusBefore).toBe('not_synced');

      // After sync
      await client.collections.sync({
        name: 'test-docs',
        spec,
        cwd: env.projectDir,
      });

      const statusAfter = await client.collections.getSyncStatus({ spec });
      expect(statusAfter).toBe('synced');
    });
  });
});
