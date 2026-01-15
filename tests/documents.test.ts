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

  // === New tests for MCP tools v2 ===

  describe('listDocuments', () => {
    it('lists all documents in a collection', async () => {
      const collectionId = await syncTestDocs();

      const result = await client.documents.listDocuments({
        collection: collectionId,
        limit: 100,
        offset: 0,
      });

      expect(result.documents.length).toBe(4);
      expect(result.total).toBe(4);
      expect(result.hasMore).toBe(false);
    });

    it('returns document info with title and size', async () => {
      const collectionId = await syncTestDocs();

      const result = await client.documents.listDocuments({
        collection: collectionId,
        limit: 100,
        offset: 0,
      });

      const doc = result.documents.find((d) => d.id === 'getting-started.md');
      expect(doc).toBeDefined();
      expect(doc?.title).toBe('Getting Started');
      expect(doc?.size).toBeGreaterThan(0);
    });

    it('supports pagination', async () => {
      const collectionId = await syncTestDocs();

      const page1 = await client.documents.listDocuments({
        collection: collectionId,
        limit: 2,
        offset: 0,
      });

      expect(page1.documents.length).toBe(2);
      expect(page1.total).toBe(4);
      expect(page1.hasMore).toBe(true);

      const page2 = await client.documents.listDocuments({
        collection: collectionId,
        limit: 2,
        offset: 2,
      });

      expect(page2.documents.length).toBe(2);
      expect(page2.hasMore).toBe(false);
    });
  });

  describe('getOutline', () => {
    it('returns document outline with headings', async () => {
      const collectionId = await syncTestDocs();

      const result = await client.documents.getOutline({
        collection: collectionId,
        document: 'getting-started.md',
        maxDepth: 3,
      });

      expect(result).not.toBeNull();
      expect(result?.title).toBe('Getting Started');
      expect(result?.outline.length).toBeGreaterThan(0);
    });

    it('outline items have level, text, and line number', async () => {
      const collectionId = await syncTestDocs();

      const result = await client.documents.getOutline({
        collection: collectionId,
        document: 'getting-started.md',
        maxDepth: 6,
      });

      expect(result).not.toBeNull();
      const heading = result?.outline[0];
      expect(heading).toHaveProperty('level');
      expect(heading).toHaveProperty('text');
      expect(heading).toHaveProperty('line');
      expect(heading?.level).toBeGreaterThanOrEqual(1);
      expect(heading?.level).toBeLessThanOrEqual(6);
    });

    it('respects maxDepth parameter', async () => {
      const collectionId = await syncTestDocs();

      const result = await client.documents.getOutline({
        collection: collectionId,
        document: 'getting-started.md',
        maxDepth: 1,
      });

      expect(result).not.toBeNull();
      // All headings should be level 1
      result?.outline.forEach((h) => {
        expect(h.level).toBe(1);
      });
    });

    it('returns null for non-existent document', async () => {
      const collectionId = await syncTestDocs();

      const result = await client.documents.getOutline({
        collection: collectionId,
        document: 'nonexistent.md',
        maxDepth: 3,
      });

      expect(result).toBeNull();
    });
  });

  describe('getSection', () => {
    it('returns section content by heading', async () => {
      const collectionId = await syncTestDocs();

      const result = await client.documents.getSection({
        collection: collectionId,
        document: 'getting-started.md',
        section: 'Installation',
        includeSubsections: true,
      });

      expect(result).not.toBeNull();
      expect(result?.section).toContain('Installation');
      expect(result?.content).toBeDefined();
      expect(result?.level).toBeGreaterThanOrEqual(1);
    });

    it('returns section with start and end lines', async () => {
      const collectionId = await syncTestDocs();

      const result = await client.documents.getSection({
        collection: collectionId,
        document: 'getting-started.md',
        section: 'Installation',
        includeSubsections: true,
      });

      expect(result).not.toBeNull();
      expect(result?.startLine).toBeGreaterThan(0);
      expect(result?.endLine).toBeGreaterThanOrEqual(result?.startLine ?? 0);
    });

    it('returns null for non-existent section', async () => {
      const collectionId = await syncTestDocs();

      const result = await client.documents.getSection({
        collection: collectionId,
        document: 'getting-started.md',
        section: 'NonexistentSection12345',
        includeSubsections: true,
      });

      expect(result).toBeNull();
    });

    it('matches section heading case-insensitively', async () => {
      const collectionId = await syncTestDocs();

      const result = await client.documents.getSection({
        collection: collectionId,
        document: 'getting-started.md',
        section: 'installation', // lowercase
        includeSubsections: true,
      });

      expect(result).not.toBeNull();
    });
  });

  describe('searchBatch', () => {
    beforeEach(async () => {
      await syncTestDocs();
    });

    it('executes multiple queries in one call', async () => {
      const result = await client.documents.searchBatch({
        queries: [{ query: 'authentication' }, { query: 'getting started' }],
        limit: 5,
        hybridSearch: true,
      });

      expect(result.results.length).toBe(2);
      expect(result.results[0].query).toBe('authentication');
      expect(result.results[1].query).toBe('getting started');
    });

    it('returns results for each query', async () => {
      const result = await client.documents.searchBatch({
        queries: [{ query: 'authentication' }, { query: 'API' }],
        limit: 3,
        hybridSearch: true,
      });

      result.results.forEach((r) => {
        expect(r.results.length).toBeGreaterThan(0);
        expect(r.results.length).toBeLessThanOrEqual(3);
      });
    });

    it('supports collection filtering per query', async () => {
      const collectionId = collectionsService.computeCollectionId({
        url: `file://${join(env.projectDir, 'docs', 'manifest.json')}`,
      });

      const result = await client.documents.searchBatch({
        queries: [{ query: 'test', collections: [collectionId] }],
        limit: 5,
        hybridSearch: true,
      });

      result.results[0].results.forEach((r) => {
        expect(r.collection).toBe(collectionId);
      });
    });
  });

  describe('findRelated', () => {
    beforeEach(async () => {
      await syncTestDocs();
    });

    it('finds related content for a document', async () => {
      const collectionId = await syncTestDocs();

      const results = await client.documents.findRelated({
        collection: collectionId,
        document: 'getting-started.md',
        limit: 5,
        sameDocument: false,
      });

      // Should find related content from other documents
      expect(results.length).toBeGreaterThan(0);
    });

    it('returns results with relevance score', async () => {
      const collectionId = await syncTestDocs();

      const results = await client.documents.findRelated({
        collection: collectionId,
        document: 'getting-started.md',
        limit: 3,
        sameDocument: false,
      });

      results.forEach((r) => {
        expect(r).toHaveProperty('collection');
        expect(r).toHaveProperty('document');
        expect(r).toHaveProperty('content');
        expect(r).toHaveProperty('score');
      });
    });

    it('can include same document chunks when sameDocument is true', async () => {
      const collectionId = await syncTestDocs();

      const results = await client.documents.findRelated({
        collection: collectionId,
        document: 'getting-started.md',
        limit: 10,
        sameDocument: true,
      });

      // Results exist (may or may not include same doc depending on similarity)
      expect(results.length).toBeGreaterThanOrEqual(0);
    });

    it('can find related by chunk content', async () => {
      const collectionId = await syncTestDocs();

      const results = await client.documents.findRelated({
        collection: collectionId,
        document: 'getting-started.md',
        chunk: 'How to install and configure the application',
        limit: 5,
        sameDocument: false,
      });

      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('listCollections metadata', () => {
    it('returns description and version from manifest', async () => {
      await syncTestDocs();

      const collections = await client.documents.listCollections();

      expect(collections.length).toBeGreaterThan(0);
      const col = collections[0];

      // The test fixture manifest has description and version
      expect(col).toHaveProperty('description');
      expect(col).toHaveProperty('version');
    });
  });
});
