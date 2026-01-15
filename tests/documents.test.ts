/**
 * Tests for document commands:
 * - documents list-collections (docs ls)
 * - documents search
 * - documents drop-collection (docs drop)
 */

import { join } from 'node:path';
import { cp } from 'node:fs/promises';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { createTestEnv, type TestEnv, FIXTURE_DIR } from './setup.ts';

// Types for dynamically imported modules
type Services = InstanceType<typeof import('../src/utils/utils.services.ts').Services>;
type CollectionsService = InstanceType<typeof import('../src/collections/collections.ts').CollectionsService>;
type BackendClient = InstanceType<typeof import('../src/client/client.ts').BackendClient>;

describe('documents', () => {
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

  // Helper to sync test fixtures using the client (same database as search)
  async function syncTestDocs(): Promise<string> {
    const docsDir = join(env.projectDir, 'docs');
    await cp(join(FIXTURE_DIR, 'docs'), docsDir, { recursive: true });

    const spec = { url: `file://${join(docsDir, 'manifest.json')}` };

    // Use client.collections.sync to ensure same database as client.documents.search
    await client.collections.sync({
      name: 'test-docs',
      spec,
      cwd: env.projectDir,
    });

    return collectionsService.computeCollectionId(spec);
  }

  describe('list-collections', () => {
    it('returns empty list when no collections synced', async () => {
      const collections = await client.documents.listCollections();
      expect(collections).toHaveLength(0);
    });

    it('returns synced collections with document count', async () => {
      await syncTestDocs();

      const collections = await client.documents.listCollections();

      expect(collections.length).toBeGreaterThan(0);
      expect(collections[0]).toHaveProperty('collection');
      expect(collections[0]).toHaveProperty('document_count');
      expect(collections[0].document_count).toBe(4);
    });

    it('returns multiple collections', async () => {
      // Sync first collection
      await syncTestDocs();

      // Sync second collection (use client for same database)
      const docsDir2 = join(env.projectDir, 'docs2');
      await cp(join(FIXTURE_DIR, 'docs'), docsDir2, { recursive: true });
      await client.collections.sync({
        name: 'test-docs-2',
        spec: { url: `file://${join(docsDir2, 'manifest.json')}` },
        cwd: env.projectDir,
      });

      const collections = await client.documents.listCollections();
      expect(collections.length).toBe(2);
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      await syncTestDocs();
    });

    it('returns results for matching query', async () => {
      const results = await client.documents.search({
        query: 'authentication',
        limit: 10,
      });

      expect(results.length).toBeGreaterThan(0);
    });

    it('returns results with required properties', async () => {
      const results = await client.documents.search({
        query: 'getting started',
        limit: 10,
      });

      expect(results.length).toBeGreaterThan(0);

      const result = results[0];
      expect(result).toHaveProperty('collection');
      expect(result).toHaveProperty('document');
      expect(result).toHaveProperty('content');
      expect(result).toHaveProperty('distance');
    });

    it('respects limit parameter', async () => {
      const results = await client.documents.search({
        query: 'function',
        limit: 2,
      });

      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('filters by collection', async () => {
      const collectionId = collectionsService.computeCollectionId({
        url: `file://${join(env.projectDir, 'docs', 'manifest.json')}`,
      });

      const results = await client.documents.search({
        query: 'authentication',
        collections: [collectionId],
        limit: 10,
      });

      expect(results.length).toBeGreaterThan(0);
      results.forEach((r) => {
        expect(r.collection).toBe(collectionId);
      });
    });

    it('returns empty array for no matches with strict distance', async () => {
      // Note: Vector search always returns some results (most similar).
      // To test "no matches", we use a very strict maxDistance filter.
      const results = await client.documents.search({
        query: 'xyznonexistentquery123',
        limit: 10,
        maxDistance: 0.1, // Very strict - nothing should match this well
      });

      expect(results).toHaveLength(0);
    });

    it('supports maxDistance filter', async () => {
      const results = await client.documents.search({
        query: 'API reference',
        limit: 10,
        maxDistance: 0.5, // Very strict
      });

      // All results should have distance < 0.5
      results.forEach((r) => {
        expect(r.distance).toBeLessThan(0.5);
      });
    });

    it('supports hybrid search (default)', async () => {
      const results = await client.documents.search({
        query: 'capitalize string',
        limit: 10,
        hybridSearch: true,
      });

      // Hybrid search should find results with keyword matches
      expect(results.length).toBeGreaterThan(0);
    });

    it('supports vector-only search', async () => {
      const results = await client.documents.search({
        query: 'how to handle user login',
        limit: 10,
        hybridSearch: false,
      });

      // Pure vector search should still find semantically similar content
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('drop-collection', () => {
    it('removes collection from index', async () => {
      const collectionId = await syncTestDocs();

      // Verify it exists
      const beforeList = await client.documents.listCollections();
      expect(beforeList.some((c) => c.collection === collectionId)).toBe(true);

      // Drop it
      await client.documents.dropCollection({ collection: collectionId });

      // Verify it's gone
      const afterList = await client.documents.listCollections();
      expect(afterList.some((c) => c.collection === collectionId)).toBe(false);
    });

    it('removes documents from search results', async () => {
      const collectionId = await syncTestDocs();

      // Verify searchable
      const beforeSearch = await client.documents.search({
        query: 'authentication',
        limit: 10,
      });
      expect(beforeSearch.length).toBeGreaterThan(0);

      // Drop collection
      await client.documents.dropCollection({ collection: collectionId });

      // Verify not searchable
      const afterSearch = await client.documents.search({
        query: 'authentication',
        limit: 10,
      });
      expect(afterSearch).toHaveLength(0);
    });

    it('handles non-existent collection gracefully', async () => {
      // Should not throw
      await expect(client.documents.dropCollection({ collection: 'nonexistent-collection' })).resolves.not.toThrow();
    });
  });

  describe('getDocument', () => {
    it('retrieves document by collection and id', async () => {
      const collectionId = await syncTestDocs();

      const doc = await client.documents.getDocument({
        collection: collectionId,
        id: 'getting-started.md',
      });

      expect(doc).not.toBeNull();
      expect(doc?.content).toContain('Getting Started');
    });

    it('returns null for non-existent document', async () => {
      const collectionId = await syncTestDocs();

      const doc = await client.documents.getDocument({
        collection: collectionId,
        id: 'nonexistent.md',
      });

      expect(doc).toBeNull();
    });
  });
});
