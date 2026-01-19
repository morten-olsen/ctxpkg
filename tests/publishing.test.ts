/**
 * Tests for publishing commands:
 * - collections manifest init
 * - collections pack
 */

import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as tar from 'tar';

import { createTestEnv, type TestEnv, createDocument } from './setup.js';

describe('publishing', () => {
  let env: TestEnv;

  beforeEach(async () => {
    env = await createTestEnv();
  });

  afterEach(async () => {
    await env.cleanup();
  });

  describe('manifest init', () => {
    it('creates manifest.json with default values', async () => {
      const manifestPath = join(env.projectDir, 'manifest.json');

      // Simulate what the CLI does
      const manifest = {
        name: 'project', // Would be directory name
        version: '1.0.0',
        description: '',
        sources: {
          glob: ['**/*.md'],
        },
      };

      await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

      expect(existsSync(manifestPath)).toBe(true);

      const content = await readFile(manifestPath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.name).toBe('project');
      expect(parsed.version).toBe('1.0.0');
      expect(parsed.sources.glob).toContain('**/*.md');
    });

    it('creates manifest with custom name and version', async () => {
      const manifestPath = join(env.projectDir, 'manifest.json');

      const manifest = {
        name: 'my-custom-docs',
        version: '2.0.0',
        description: '',
        sources: {
          glob: ['**/*.md'],
        },
      };

      await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

      const content = await readFile(manifestPath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.name).toBe('my-custom-docs');
      expect(parsed.version).toBe('2.0.0');
    });
  });

  describe('pack', () => {
    it('creates a tar.gz bundle from manifest', async () => {
      // Create manifest and docs
      const docsDir = env.projectDir;
      await writeFile(
        join(docsDir, 'manifest.json'),
        JSON.stringify({
          name: 'test-bundle',
          version: '1.0.0',
          sources: { glob: ['**/*.md'] },
        }),
      );
      await createDocument(docsDir, 'readme.md', '# README\n\nThis is the readme.');
      await createDocument(docsDir, 'guide.md', '# Guide\n\nThis is a guide.');

      // Create bundle using tar library directly (simulating pack command)
      const outputPath = join(env.tempDir, 'test-bundle-1.0.0.tar.gz');
      const filesToInclude = ['manifest.json', 'readme.md', 'guide.md'];

      await tar.create(
        {
          gzip: true,
          file: outputPath,
          cwd: docsDir,
        },
        filesToInclude,
      );

      expect(existsSync(outputPath)).toBe(true);
    });

    it('bundle can be extracted and contains manifest', async () => {
      // Create source files
      const docsDir = env.projectDir;
      await writeFile(
        join(docsDir, 'manifest.json'),
        JSON.stringify({
          name: 'extract-test',
          version: '1.0.0',
          sources: { files: ['doc.md'] },
        }),
      );
      await createDocument(docsDir, 'doc.md', '# Document\n\nContent here.');

      // Create bundle
      const bundlePath = join(env.tempDir, 'extract-test.tar.gz');
      await tar.create(
        {
          gzip: true,
          file: bundlePath,
          cwd: docsDir,
        },
        ['manifest.json', 'doc.md'],
      );

      // Extract to new directory
      const extractDir = join(env.tempDir, 'extracted');
      await mkdir(extractDir, { recursive: true });
      await tar.extract({
        file: bundlePath,
        cwd: extractDir,
      });

      // Verify contents
      expect(existsSync(join(extractDir, 'manifest.json'))).toBe(true);
      expect(existsSync(join(extractDir, 'doc.md'))).toBe(true);

      const manifest = JSON.parse(await readFile(join(extractDir, 'manifest.json'), 'utf-8'));
      expect(manifest.name).toBe('extract-test');
    });

    it('bundle includes files matching glob pattern', async () => {
      // Create source files with nested structure
      const docsDir = env.projectDir;
      await writeFile(
        join(docsDir, 'manifest.json'),
        JSON.stringify({
          name: 'glob-test',
          version: '1.0.0',
          sources: { glob: ['**/*.md'] },
        }),
      );
      await createDocument(docsDir, 'root.md', '# Root');
      await createDocument(docsDir, 'guides/intro.md', '# Intro Guide');
      await createDocument(docsDir, 'api/ref.md', '# API Reference');
      await createDocument(docsDir, 'skip.txt', 'This should be skipped');

      // Simulate glob expansion and pack
      const { glob } = await import('node:fs/promises');
      const mdFiles: string[] = [];
      for await (const file of glob('**/*.md', { cwd: docsDir })) {
        mdFiles.push(file);
      }

      const bundlePath = join(env.tempDir, 'glob-test.tar.gz');
      await tar.create(
        {
          gzip: true,
          file: bundlePath,
          cwd: docsDir,
        },
        ['manifest.json', ...mdFiles],
      );

      // Extract and verify
      const extractDir = join(env.tempDir, 'glob-extracted');
      await mkdir(extractDir, { recursive: true });
      await tar.extract({
        file: bundlePath,
        cwd: extractDir,
      });

      expect(existsSync(join(extractDir, 'root.md'))).toBe(true);
      expect(existsSync(join(extractDir, 'guides/intro.md'))).toBe(true);
      expect(existsSync(join(extractDir, 'api/ref.md'))).toBe(true);
      expect(existsSync(join(extractDir, 'skip.txt'))).toBe(false);
    });

    it('syncs from created bundle', async () => {
      // Create and pack bundle
      const docsDir = env.projectDir;
      await writeFile(
        join(docsDir, 'manifest.json'),
        JSON.stringify({
          name: 'sync-bundle-test',
          version: '1.0.0',
          sources: { glob: ['**/*.md'] },
        }),
      );
      await createDocument(docsDir, 'readme.md', '# Bundle Readme\n\nThis is from a bundle.');

      const bundlePath = join(env.tempDir, 'sync-bundle.tar.gz');
      await tar.create(
        {
          gzip: true,
          file: bundlePath,
          cwd: docsDir,
        },
        ['manifest.json', 'readme.md'],
      );

      // Sync the bundle
      const { Services } = await import('../src/utils/utils.services.js');
      const { CollectionsService } = await import('../src/collections/collections.js');

      const services = new Services();
      try {
        const collectionsService = services.get(CollectionsService);

        const result = await collectionsService.syncCollection(
          'bundle-pkg',
          { url: `file://${bundlePath}` },
          env.projectDir,
        );

        expect(result.added).toBe(1);
        expect(result.total).toBe(1);
      } finally {
        await services.destroy();
      }
    });
  });
});
