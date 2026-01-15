/**
 * Global test setup for vitest
 */

import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeAll, afterAll, afterEach, vi } from 'vitest';
import { setupServer, SetupServer } from 'msw/node';
import { http, HttpResponse, passthrough } from 'msw';

// ============================================================================
// Test Environment Types
// ============================================================================

type TestEnv = {
  tempDir: string;
  projectDir: string;
  configDir: string;
  cleanup: () => Promise<void>;
};

// ============================================================================
// Test Environment Setup
// ============================================================================

/**
 * Create an isolated test environment with temp directories and config overrides.
 * Call this in beforeEach() and cleanup in afterEach().
 *
 * IMPORTANT: Due to convict caching env vars at module load time,
 * you must call vi.resetModules() and re-import services after creating the env.
 */
async function createTestEnv(): Promise<TestEnv> {
  // Reset module cache to ensure config is re-read with new env vars
  vi.resetModules();

  const tempDir = await mkdtemp(join(tmpdir(), 'ctxpkg-test-'));
  const projectDir = join(tempDir, 'project');
  const configDir = join(tempDir, 'config');

  await mkdir(projectDir, { recursive: true });
  await mkdir(configDir, { recursive: true });

  // Set environment variables BEFORE importing any modules that use config
  // Use in-memory database for speed and isolation (each test gets its own)
  process.env.CTXPKG_DATABASE_PATH = ':memory:';
  process.env.CTXPKG_GLOBAL_CONFIG_FILE = join(configDir, 'global-context.json');
  // Note: project config file is relative to cwd, so we set cwd in tests

  const cleanup = async () => {
    // Clear env vars
    delete process.env.CTXPKG_DATABASE_PATH;
    delete process.env.CTXPKG_GLOBAL_CONFIG_FILE;

    // Remove temp directory
    await rm(tempDir, { recursive: true, force: true });

    // Reset modules again for next test
    vi.resetModules();
  };

  return {
    tempDir,
    projectDir,
    configDir,
    cleanup,
  };
}

// ============================================================================
// Mock HTTP Server Setup
// ============================================================================

// Default handlers for common mocked endpoints
const defaultHandlers = [
  // Allow tiktoken tokenizer data through (used by embedding)
  http.get('https://tiktoken.pages.dev/*', () => {
    return passthrough();
  }),
  // Allow Hugging Face model downloads through
  http.get('https://huggingface.co/*', () => {
    return passthrough();
  }),
  http.get('https://cdn-lfs.huggingface.co/*', () => {
    return passthrough();
  }),
  http.get('https://cdn-lfs-us-1.huggingface.co/*', () => {
    return passthrough();
  }),
];

// Global MSW server instance
let server: SetupServer | null = null;

/**
 * Get the MSW server instance. Creates one if it doesn't exist.
 */
function getMswServer(): SetupServer {
  if (!server) {
    server = setupServer(...defaultHandlers);
  }
  return server;
}

/**
 * Add handlers to the MSW server for a test.
 * Handlers are reset after each test.
 */
function mockHttpRequests(handlers: Parameters<SetupServer['use']>): void {
  getMswServer().use(...handlers);
}

/**
 * Create an HTTP handler that returns JSON
 */
function mockJsonResponse(url: string, data: unknown) {
  return http.get(url, () => HttpResponse.json(data));
}

/**
 * Create an HTTP handler that returns text
 */
function mockTextResponse(url: string, text: string) {
  return http.get(url, () => HttpResponse.text(text));
}

/**
 * Create an HTTP handler that returns a binary file (for bundles)
 */
function mockBinaryResponse(url: string, buffer: Buffer) {
  return http.get(url, () => {
    return new HttpResponse(buffer, {
      headers: { 'Content-Type': 'application/gzip' },
    });
  });
}

// ============================================================================
// Fixture Helpers
// ============================================================================

const FIXTURE_DIR = join(import.meta.dirname, 'fixtures');

/**
 * Create a manifest.json file in a directory
 */
async function createManifest(
  dir: string,
  manifest: {
    name: string;
    version: string;
    description?: string;
    sources: { glob?: string[]; files?: (string | { path: string; hash?: string })[] };
    baseUrl?: string;
  },
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const manifestPath = join(dir, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return manifestPath;
}

/**
 * Create a document file in a directory
 */
async function createDocument(dir: string, relativePath: string, content: string): Promise<string> {
  const fullPath = join(dir, relativePath);
  const parentDir = join(fullPath, '..');
  await mkdir(parentDir, { recursive: true });
  await writeFile(fullPath, content);
  return fullPath;
}

/**
 * Create a context.json file in a directory
 */
async function createContextJson(dir: string, collections: Record<string, { url: string }>): Promise<string> {
  const contextPath = join(dir, 'context.json');
  await writeFile(contextPath, JSON.stringify({ collections }, null, 2));
  return contextPath;
}

// ============================================================================
// Global Setup/Teardown
// ============================================================================

beforeAll(() => {
  // Start MSW server
  getMswServer().listen({ onUnhandledRequest: 'warn' });
});

afterAll(() => {
  // Close MSW server
  getMswServer().close();
});

afterEach(() => {
  // Reset MSW handlers to defaults after each test
  getMswServer().resetHandlers();
});

// ============================================================================
// Exports
// ============================================================================

export type { TestEnv };
export {
  createTestEnv,
  getMswServer,
  mockHttpRequests,
  mockJsonResponse,
  mockTextResponse,
  mockBinaryResponse,
  FIXTURE_DIR,
  createManifest,
  createDocument,
  createContextJson,
  http,
  HttpResponse,
  passthrough,
};
