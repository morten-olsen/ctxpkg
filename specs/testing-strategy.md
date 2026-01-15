# Testing Strategy

This spec describes the approach for comprehensive testing of ctxpkg functionality using vitest.

## Overview

Add integration tests that verify the functionality documented in README.md. Tests will operate at the service/client level (not spawning CLI processes) to ensure proper code coverage while still validating the documented user workflows.

## Goals

1. **Validate README documentation**: Ensure all documented CLI commands work as described
2. **Code coverage**: Tests must execute actual code paths (no subprocess spawning for CLI tests)
3. **Isolation**: Each test runs with isolated database and filesystem state
4. **HTTP mocking**: Remote package distribution is mocked but validates actual fetch/parsing logic
5. **No daemon testing**: Daemon functionality is out of scope for this phase

## Testing Architecture

### Why Service-Level Testing

The CLI commands are thin wrappers around the `BackendClient` (in direct mode) which calls service methods. Testing at the service/client level:

- ✅ Executes the same code paths as CLI usage
- ✅ Counts toward code coverage correctly
- ✅ Avoids subprocess complexity and flaky process spawning
- ✅ Allows proper mocking and isolation
- ✅ Runs faster than spawning processes

### Test Structure

```
tests/
├── setup.ts              # Global test setup (temp dirs, mock fetch)
├── fixtures/             # Test fixtures (manifests, documents)
│   ├── manifests/
│   └── docs/
├── collections.test.ts   # Collection management tests
├── documents.test.ts     # Document search tests
├── sync.test.ts          # Sync operations tests
├── publishing.test.ts    # Pack/manifest tests
└── config.test.ts        # Config command tests
```

### Test Infrastructure

#### Isolated Environment Per Test

Each test suite creates:
- Temporary directory for `context.json` and local collections
- Isolated database file (SQLite in temp directory)
- Fresh `Services` container

```typescript
// Example test setup pattern (tests/collections.test.ts)
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Services } from '../src/utils/utils.services.ts';
import { CollectionsService } from '../src/collections/collections.ts';

describe('collections', () => {
  let tempDir: string;
  let services: Services;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ctxpkg-test-'));
    services = new Services();
    
    // Configure services to use temp paths
    // (implementation details in setup.ts)
  });

  afterEach(async () => {
    await services.destroy();
    await rm(tempDir, { recursive: true, force: true });
  });
});
```

#### HTTP Mocking Strategy

Use `msw` (Mock Service Worker) for HTTP mocking because:
- Works with native `fetch` 
- Intercepts at network level (coverage counted correctly)
- Declarative request/response patterns
- Well-maintained and battle-tested

```typescript
// Example mock setup
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

const server = setupServer(
  // Mock manifest endpoint
  http.get('https://example.com/react-docs/manifest.json', () => {
    return HttpResponse.json({
      name: 'react-docs',
      version: '18.0.0',
      sources: { files: ['getting-started.md', 'hooks.md'] }
    });
  }),
  
  // Mock document content
  http.get('https://example.com/react-docs/getting-started.md', () => {
    return HttpResponse.text('# Getting Started\n\nWelcome to React...');
  }),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

#### Config Overrides for Tests

The `config` module uses `convict`. Tests need to override:
- `project.configFile` → temp directory path
- `global.configFile` → temp directory path  
- `database.path` → temp directory path

```typescript
// Test helper to create isolated config
const createTestConfig = (tempDir: string) => {
  process.env.CTXPKG_PROJECT_CONFIG_FILE = join(tempDir, 'context.json');
  process.env.CTXPKG_GLOBAL_CONFIG_FILE = join(tempDir, 'global-context.json');
  process.env.CTXPKG_DATABASE_PATH = join(tempDir, 'test.db');
};
```

## Test Cases by Feature

### 1. Collection Commands (`collections.test.ts`)

#### `collections init`

| Test | Description |
|------|-------------|
| creates context.json | `init` creates a valid context.json file |
| fails if exists | `init` without --force fails when file exists |
| force overwrites | `init --force` overwrites existing file |

#### `collections add`

| Test | Description |
|------|-------------|
| add local manifest | `add project-docs ./docs/manifest.json` adds to config |
| add remote manifest | `add react https://example.com/manifest.json` adds to config |
| add with file:// prefix | `add lib file://../shared/manifest.json` normalizes URL |
| add global | `add -g typescript-docs https://...` adds to global config |
| add creates global config | First `add -g` auto-creates global config |
| fail without init | `add` fails if no context.json (without -g) |
| fail duplicate name | `add` fails for existing collection name |

#### `collections remove`

| Test | Description |
|------|-------------|
| remove from local | `remove react` removes from project config |
| remove from global | `remove -g typescript-docs` removes from global config |
| remove with --drop | `remove react --drop` also deletes indexed data |
| fail not found | `remove nonexistent` fails gracefully |

#### `collections list`

| Test | Description |
|------|-------------|
| list empty | `list` shows helpful message when no collections |
| list local only | `list --no-global` shows only local collections |
| list global only | `list -g` shows only global collections |
| list combined | `list` (default) shows both with source indicators |
| shows sync status | Each collection shows synced/not-synced status |

#### `collections sync`

| Test | Description |
|------|-------------|
| sync local manifest | Syncs file:// manifest, indexes documents |
| sync remote manifest | Syncs https:// manifest (mocked), indexes documents |
| sync bundle | Syncs .tar.gz bundle, extracts and indexes |
| sync specific | `sync react` syncs only named collection |
| sync --force | Re-indexes all documents ignoring cache |
| sync global | `sync -g` syncs only global collections |
| sync no-global | `sync --no-global` syncs only local collections |
| incremental sync | Second sync detects unchanged files |
| sync removes deleted | Files removed from manifest are unindexed |

### 2. Document Commands (`documents.test.ts`)

#### `documents list-collections` / `docs ls`

| Test | Description |
|------|-------------|
| list synced collections | Shows collections with document counts |
| empty state | Shows message when no collections synced |

#### `documents search`

| Test | Description |
|------|-------------|
| basic search | Returns relevant results for query |
| search with -c | Limits to specified collections |
| search with --no-global | Excludes global collections |
| search with -l limit | Respects result limit |
| search with --max-distance | Filters by distance threshold |
| search hybrid disabled | `--no-hybrid` uses vector-only search |
| empty results | Returns empty array for no matches |
| resolves aliases | `-c react` resolves to collection ID |

#### `documents drop-collection` / `docs drop`

| Test | Description |
|------|-------------|
| drop by name | Removes collection from index |
| drop with -f | Skips confirmation (tested via service) |
| drop not found | Fails gracefully for unknown collection |

### 3. Publishing Commands (`publishing.test.ts`)

#### `collections manifest init`

| Test | Description |
|------|-------------|
| creates manifest.json | Creates valid manifest with defaults |
| uses directory name | Default name is current directory basename |
| custom name/version | Respects --name and --version options |
| fails if exists | Does not overwrite existing manifest |

#### `collections pack`

| Test | Description |
|------|-------------|
| creates bundle | Produces .tar.gz with manifest and sources |
| custom output | `--output custom.tar.gz` uses specified name |
| glob sources | Includes files matching glob patterns |
| file sources | Includes explicitly listed files |
| bundle extractable | Produced bundle can be extracted and synced |

### 4. Config Commands (`config.test.ts`)

| Test | Description |
|------|-------------|
| config list | Lists all configuration values |
| config get | Gets specific config value |
| config set | Sets config value |
| config path | Shows config file location |

### 5. Integration Scenarios (`integration.test.ts`)

End-to-end workflows combining multiple operations:

| Test | Description |
|------|-------------|
| full local workflow | init → add local → sync → search |
| remote package workflow | add remote → sync → search → remove |
| global + local workflow | add global → add local → sync → search both |
| bundle workflow | manifest init → pack → add bundle → sync |
| precedence test | Local collection shadows global with same name |

## Fixtures

### Local Test Collections

```
tests/fixtures/
├── docs/
│   ├── manifest.json
│   ├── getting-started.md
│   ├── api/
│   │   ├── core.md
│   │   └── utils.md
│   └── guides/
│       └── authentication.md
└── manifests/
    ├── glob-sources.json    # Uses glob patterns
    ├── file-sources.json    # Uses explicit file list
    └── with-base-url.json   # Uses baseUrl
```

### Mock Remote Packages

Configured via MSW handlers:

```typescript
// Remote manifest package
https://example.com/react-docs/v18/manifest.json
https://example.com/react-docs/v18/getting-started.md
https://example.com/react-docs/v18/hooks.md

// Remote bundle
https://example.com/typescript-docs.tar.gz

// CDN-style with baseUrl
https://cdn.example.com/docs/lodash/manifest.json
  → baseUrl: "https://cdn.example.com/docs/lodash/content/"
```

## Implementation Plan

### Phase 1: Test Infrastructure

1. Add `msw` to devDependencies
2. Create `tests/setup.ts` with:
   - Temp directory creation/cleanup utilities
   - Config override helpers
   - MSW server setup
3. Create `tests/fixtures/` with test documents and manifests
4. Update `vitest.config.ts` (if needed) for setup file and coverage

### Phase 2: Collection Tests

1. `collections.test.ts` - init, add, remove, list commands
2. `sync.test.ts` - sync operations (local, remote, bundle)

### Phase 3: Document Tests

1. `documents.test.ts` - list, search, drop commands

### Phase 4: Publishing Tests

1. `publishing.test.ts` - manifest init, pack commands

### Phase 5: Config and Integration

1. `config.test.ts` - config commands
2. `integration.test.ts` - end-to-end workflows

## Dependencies to Add

```json
{
  "devDependencies": {
    "msw": "^2.x"
  }
}
```

## Vitest Configuration

```typescript
// vitest.config.ts (if not using package.json config)
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['tests/**'],
    },
    // Increase timeout for embedding operations
    testTimeout: 60000,
  },
});
```

## Mocking Considerations

### Embedding Model

The embedding model (`mixedbread-ai/mxbai-embed-large-v1`) is slow to initialize. Options:

1. **Use real embeddings**: More realistic but slower (60s+ per test suite)
2. **Mock embedder**: Fast but less realistic
3. **Hybrid**: Use real embeddings for search tests, mock for other tests

**Recommendation**: Start with real embeddings but add mocking option if tests become too slow. The embedder loads once per test file if Services is reused properly.

### Database

SQLite with `better-sqlite3` is fast enough to use real database operations. Each test uses an isolated temp database file.

## Coverage Targets

Initial coverage targets (can be adjusted):

| Area | Target |
|------|--------|
| Collections service | 80% |
| Documents service | 80% |
| Backend services | 70% |
| Client adapters | 60% |
| CLI commands | 50% (tested indirectly) |

## Notes

- **Interactive commands** (`isearch`, drop prompts): Tested at service level, bypassing prompts
- **MCP server**: Tested separately if needed, uses same backend services
- **Daemon**: Explicitly out of scope for this testing phase
- **Performance**: Embedding operations are slow; consider test parallelization carefully
- **Flakiness**: Avoid time-dependent tests; use deterministic fixtures
