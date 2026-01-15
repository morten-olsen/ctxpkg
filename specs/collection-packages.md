# Collection Packages Specification

> **Status**: Draft  
> **Version**: 1.0  
> **Date**: 2026-01-14

This document specifies the design for evolving collections from static file snapshots into a "Package Manager for Context" — supporting local file collections, remote packages, versioning, and efficient sync.

## Overview

Collections provide contextual documents for AI-assisted workflows. This spec introduces two collection types:

| Type | Description | Source |
|------|-------------|--------|
| `file` | Ad-hoc, project-local indexing | Local filesystem path + glob |
| `pkg` | Structured, shareable packages | Manifest URL (local or remote) |

## Goals

1. **Simple start**: Index local docs with minimal config
2. **Shareable packages**: Distribute context as versioned packages
3. **Efficient sync**: Skip unchanged content via hashing
4. **Multi-project sharing**: Same package indexed once, used by many projects

## Non-Goals (This Iteration)

- File system watching / live sync (deferred)
- Package registry / discovery service
- Pre-embedded packages (always embed locally)

---

## Collection Identity

Each collection has a unique ID computed from its source:

| Type | ID Format | Example |
|------|-----------|---------|
| `file` | `file:{sha256(absolutePath + glob)}` | `file:a3f8c2d1e4b5...` |
| `pkg` | `pkg:{manifestUrl}` | `pkg:https://react.dev/context/v18/manifest.json` |

### Path Normalization (for `file` type)

- Relative paths resolved to absolute from project root
- Symlinks resolved to canonical path
- Paths normalized before hashing

### URL Normalization (for `pkg` type)

- Trailing slashes removed
- Standard URL normalization applied

---

## Project Configuration

Projects declare collections in a config file at the project root. The filename is configurable via `project.configFile` in the application config (default: `context.json`).

### Schema

```typescript
type ProjectConfig = {
  collections: Record<string, CollectionSpec>;
};

type CollectionSpec = FileSpec | PkgSpec;

type FileSpec = {
  type: 'file';
  path: string;    // Relative to project root
  glob: string;    // e.g., "**/*.md"
};

type PkgSpec = {
  type: 'pkg';
  url: string;     // file:// or https://, manifest or bundle
};
```

### Example

```json
{
  "collections": {
    "project-docs": {
      "type": "file",
      "path": "./docs",
      "glob": "**/*.md"
    },
    "org-standards": {
      "type": "pkg",
      "url": "file://../shared/standards/manifest.json"
    },
    "react": {
      "type": "pkg",
      "url": "https://react.dev/context/v18.2.0/manifest.json"
    },
    "lodash": {
      "type": "pkg",
      "url": "https://example.com/releases/lodash-docs-4.17.0.tar.gz"
    }
  }
}
```

### Alias Scope

The dictionary key (e.g., `"react"`) is a **project-local alias**. Different projects can use different aliases for the same collection. The alias is NOT stored in the database — only in the project's `context.json`.

---

## Package Manifest Format

Packages are defined by a `manifest.json` file.

### Schema

```typescript
type Manifest = {
  name: string;
  version: string;
  description?: string;
  baseUrl?: string;              // Base URL for relative file paths
  sources: GlobSources | FileSources;
  metadata?: Record<string, unknown>;
};

type GlobSources = {
  glob: string[];                // Only valid for file:// manifests
};

type FileSources = {
  files: FileEntry[];
};

type FileEntry = string | FileEntryObject;

type FileEntryObject = {
  path?: string;                 // Relative path (mutually exclusive with url)
  url?: string;                  // Fully qualified URL (mutually exclusive with path)
  hash?: string;                 // "sha256:..." for change detection
};
```

### Source Resolution

#### `glob` sources (file:// manifests only)

Glob patterns are expanded against the filesystem relative to the manifest location.

```json
{
  "name": "org-standards",
  "version": "2.1.0",
  "sources": {
    "glob": ["**/*.md", "api/**/*.mdx"]
  }
}
```

**Constraint**: `glob` sources are only valid for `file://` manifest URLs. HTTP does not support directory enumeration.

#### `files` sources

Explicit file list, works with any protocol.

```json
{
  "name": "react-docs",
  "version": "18.2.0",
  "baseUrl": "https://raw.githubusercontent.com/facebook/react/v18.2.0/docs/",
  "sources": {
    "files": [
      "getting-started.md",
      { "path": "hooks/use-state.md", "hash": "sha256:9f86d081..." },
      { "url": "https://cdn.example.com/shared/contributing.md" }
    ]
  }
}
```

### File Resolution Rules

1. If entry is a string → treat as `{ path: entry }`
2. If `url` is set → use as-is (fully qualified)
3. If `path` is set:
   - If `baseUrl` exists → `baseUrl + path`
   - Else → `dirname(manifestUrl) + path`

### Hash Format

Hashes use the format `{algorithm}:{hex}`:

```
sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
```

SHA256 is the standard algorithm.

---

## Bundle Format

Packages can be distributed as tar.gz bundles for simpler hosting and atomic downloads.

### Structure

```
react-docs-18.2.0.tar.gz
├── manifest.json          # Root-level manifest
├── getting-started.md
├── hooks/
│   ├── use-state.md
│   └── use-effect.md
└── api/
    └── components.md
```

### Detection

Bundle vs manifest is determined by URL extension:

| Extension | Mode |
|-----------|------|
| `.json` | Manifest (fetch files individually) |
| `.tar.gz`, `.tgz` | Bundle (download, extract, index) |

### Bundle Constraints

- `baseUrl` is ignored (files are relative to bundle root)
- Fully qualified `url` in file entries is ignored
- `glob` sources work (applied to extracted contents)

### Bundle Processing

Bundles are processed in-memory without caching:

1. Download bundle to memory (or temp file for large bundles)
2. Extract to temporary directory
3. Read manifest, index documents
4. Discard extracted contents

**Rationale**: Caching bundles adds complexity without benefit — we must re-download to detect changes anyway, and the manifest's name/version may not match the URL, causing cache key conflicts.

---

## Versioning

Versions are embedded in the URL path:

```
https://react.dev/context/v18.2.0/manifest.json
https://myorg.com/standards/2024.01/manifest.json
https://github.com/owner/repo/releases/download/v1.0.0/docs.tar.gz
```

The manifest's `version` field is for display/metadata. The URL is the source of truth for pinning.

To upgrade, update the URL in `context.json`.

---

## Sync Behavior

Sync reconciles local state to match the source. After sync, the index contains exactly what the manifest/glob declares.

### Sync Algorithm

```
1. Compute collection ID from spec
2. Fetch manifest (or expand glob for file type)
3. Get expected file list with hashes
4. Get current document IDs in collection from DB
5. Compute:
   - toAdd: files in source but not in DB
   - toUpdate: files in both, hash mismatch (or no hash)
   - toDelete: files in DB but not in source
6. Execute:
   - Delete orphaned documents + chunks
   - Fetch and index new/updated documents
7. Update collection sync metadata
```

### Change Detection

| Scenario | Action |
|----------|--------|
| File has hash in manifest, matches stored hash | Skip |
| File has hash in manifest, differs from stored | Fetch, re-index |
| File has no hash in manifest | Fetch, compute hash, compare, re-index if changed |
| File in DB but not in manifest | Delete from index |

### Manifest Change Detection

For `pkg` collections, the manifest content hash is stored. If unchanged since last sync, the entire sync can be skipped.

### Error Handling

| Scenario | Handling |
|----------|----------|
| Manifest fetch fails | Abort sync, keep existing state, surface error |
| Individual file fetch fails (404) | Log warning, skip file, do NOT delete existing (may be transient) |
| Sync interrupted mid-way | Partial state remains; next sync will reconcile |

---

## Database Schema

### New `collections` Table

```sql
CREATE TABLE collections (
  id TEXT PRIMARY KEY,              -- "file:{hash}" or "pkg:{url}"
  type TEXT NOT NULL,               -- "file" or "pkg"
  
  -- file type fields:
  path TEXT,                        -- absolute path (normalized)
  glob TEXT,                        -- glob pattern
  
  -- pkg type fields:
  url TEXT,                         -- manifest or bundle URL
  manifest_hash TEXT,               -- for change detection
  
  -- sync state:
  last_sync_at TEXT,                -- ISO timestamp
  
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### Existing Tables

No changes to `reference_documents` or `reference_document_chunks`. The `collection` column stores the collection ID.

### Migration

Update `migrations.001-init.ts` to include the new `collections` table. No backwards compatibility required (not yet released).

---

## CLI Commands

### `collections init`

Create a new `context.json` in the current directory.

```bash
ai-assist collections init [--force]
```

### `collections add <name>`

Add a collection to project config.

```bash
# File type
ai-assist collections add project-docs --type file --path ./docs --glob "**/*.md"

# Pkg type
ai-assist collections add react --type pkg --url https://react.dev/context/v18/manifest.json

# Shorthand (type inferred)
ai-assist collections add project-docs ./docs
ai-assist collections add react https://react.dev/context/v18/manifest.json
```

**Options:**

| Option | Description |
|--------|-------------|
| `--type <file\|pkg>` | Collection type |
| `--path <path>` | Local path (file type) |
| `--glob <pattern>` | Glob pattern (file type, default: `**/*.md`) |
| `--url <url>` | Manifest or bundle URL (pkg type) |

### `collections remove <name>`

Remove a collection from project config.

```bash
ai-assist collections remove react [--drop]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--drop` | Also drop indexed data from database |

### `collections list`

Show configured collections and sync status.

```bash
ai-assist collections list
```

**Output:**

```
┌─────────────────┬──────┬─────────────────────────────────┬──────────────┐
│ Name            │ Type │ Source                          │ Status       │
├─────────────────┼──────┼─────────────────────────────────┼──────────────┤
│ project-docs    │ file │ ./docs (**/*.md)                │ ✓ synced     │
│ react           │ pkg  │ https://react.dev/.../v18/...   │ ⚠ not synced │
└─────────────────┴──────┴─────────────────────────────────┴──────────────┘
```

### `collections sync [name]`

Sync collection(s) from config.

```bash
# Sync all
ai-assist collections sync

# Sync specific collection
ai-assist collections sync react
```

**Options:**

| Option | Description |
|--------|-------------|
| `--force` | Re-index all documents (ignore hash cache) |
| `--dry-run` | Show what would happen without making changes |

**Output:**

```
Syncing project-docs (file)...
  ✓ 12 documents (0 added, 0 updated, 0 removed)

Syncing react (pkg)...
  ↓ Fetching manifest...
  + adding: new-guide.md
  ~ updating: api/core.md
  - removing: deprecated/old-api.md
  ✓ 45 documents (1 added, 1 updated, 1 removed)
```

### `collections pack`

Create a distributable bundle from a local manifest. Automatically resolves globs and computes file hashes for the bundled manifest.

```bash
ai-assist collections pack [--manifest <path>] [--output <path>]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--manifest <path>` | Path to manifest (default: `./manifest.json`) |
| `--output <path>` | Output path (default: `./{name}-{version}.tar.gz`) |

### `collections manifest init`

Scaffold a `manifest.json` for publishing.

```bash
ai-assist collections manifest init
```

---

## Existing `ref` Commands

| Command | Status |
|---------|--------|
| `ref list-collections` / `ref ls` | Unchanged — lists indexed collections from DB |
| `ref search` | Unchanged — searches across synced collections |
| `ref drop` | Unchanged — drops from index (not from config) |
| `ref update` | **Deprecated** — use `collections add` + `sync` |

### Querying with Aliases

When searching with `--collection <alias>`:

1. Read project's `context.json`
2. Look up alias → get spec
3. Compute collection ID
4. Query database with ID

---

## Multi-Project Sharing

Collections are stored globally in the database, keyed by ID (not alias).

**Example:**

```
Project A context.json: { "react": { "type": "pkg", "url": "https://..." } }
Project B context.json: { "react-docs": { "type": "pkg", "url": "https://..." } }
```

Both resolve to the same collection ID. Documents are stored once. If Project A syncs first, Project B's sync is instant.

---

## Application Configuration

Add to `src/config/config.ts`:

```typescript
project: {
  configFile: {
    doc: 'Filename for project configuration file',
    format: String,
    default: 'context.json',
    env: 'AI_ASSIST_PROJECT_CONFIG_FILE',
  },
},
```

This allows the project config filename to be changed globally without code changes. Using `project` as the namespace allows for future project-level settings beyond just collections.

---

## Implementation Plan

### Phase 1: Foundation

- [ ] Add `project.configFile` to `src/config/config.ts`
- [ ] Create Zod schemas for project config and manifest (`src/collections/collections.schemas.ts`)
- [ ] Update `migrations.001-init.ts` to add `collections` table
- [ ] Create `CollectionsService` class (`src/collections/collections.ts`)
  - [ ] Project config read/write (find and parse `context.json`)
  - [ ] Collection ID computation (hashing for file type, URL for pkg type)
  - [ ] Path normalization utilities

### Phase 2: File Type Collections

- [ ] Implement `file` type sync in `CollectionsService`
  - [ ] Glob expansion
  - [ ] Document hash comparison
  - [ ] Add/update/delete reconciliation
- [ ] Integrate with existing `ReferencesService` for document indexing

### Phase 3: Pkg Type Collections (Local Manifests)

- [ ] Implement manifest parsing and validation
- [ ] Implement `file://` manifest sync
  - [ ] Glob source resolution
  - [ ] Files source resolution
- [ ] File hash comparison for skip optimization

### Phase 4: Pkg Type Collections (Remote Manifests)

- [ ] Implement `https://` manifest fetch
- [ ] Implement file fetching with URL resolution
  - [ ] Relative to manifest
  - [ ] Relative to baseUrl
  - [ ] Fully qualified URLs
- [ ] Manifest hash caching for skip optimization

### Phase 5: Bundle Support

- [ ] Implement bundle detection (by URL extension)
- [ ] Implement bundle download and extraction
- [ ] Process extracted contents using existing manifest logic
- [ ] Cleanup temp files after indexing

### Phase 6: CLI Commands

- [ ] Create `src/cli/cli.collections.ts`
- [ ] Implement `collections init`
- [ ] Implement `collections add`
  - [ ] Explicit `--type`, `--path`, `--glob`, `--url` options
  - [ ] Shorthand inference from arguments
- [ ] Implement `collections remove`
  - [ ] `--drop` flag for index cleanup
- [ ] Implement `collections list`
  - [ ] Show sync status
- [ ] Implement `collections sync`
  - [ ] All collections / single collection
  - [ ] `--force` and `--dry-run` flags
  - [ ] Progress output
- [ ] Implement `collections manifest init`
- [ ] Implement `collections pack`
  - [ ] Glob resolution
  - [ ] Hash computation
  - [ ] tar.gz creation
- [ ] Mount in `src/cli/cli.ts`

### Phase 7: Backend Integration

- [ ] Add collections procedures to `src/backend/backend.services.ts`
- [ ] Add types to `src/backend/backend.types.ts`
- [ ] Update `BackendClient` with collections API

### Phase 8: Update Existing Commands

- [ ] Update `ref search` to resolve aliases from project config
- [ ] Deprecate `ref update` (point users to `collections sync`)
- [ ] Update `ref ls` output to show collection type

### Phase 9: Documentation

- [ ] Update `README.md` with collections CLI usage
- [ ] Update `ARCHITECTURE.md` with collections service
- [ ] Add examples for common workflows

---

## Future Considerations

Items deferred from this iteration:

1. **File watching**: Daemon watches local collections, auto-syncs on change
2. **Pre-embedded packages**: Ship vectors instead of raw text
3. **Package registry**: Discovery and search for public packages
4. **Version constraints**: Semver ranges (`^18.0.0`) with resolution
5. **Lock file**: `context.lock` for reproducible installs
6. **Authentication**: Private package access

---

## Appendix: Full Type Definitions

```typescript
// === Project Config (context.json) ===

type ProjectConfig = {
  collections: Record<string, CollectionSpec>;
};

type CollectionSpec = FileSpec | PkgSpec;

type FileSpec = {
  type: 'file';
  path: string;
  glob: string;
};

type PkgSpec = {
  type: 'pkg';
  url: string;
};

// === Package Manifest (manifest.json) ===

type Manifest = {
  name: string;
  version: string;
  description?: string;
  baseUrl?: string;
  sources: GlobSources | FileSources;
  metadata?: Record<string, unknown>;
};

type GlobSources = {
  glob: string[];
};

type FileSources = {
  files: FileEntry[];
};

type FileEntry = string | FileEntryObject;

type FileEntryObject = {
  path?: string;
  url?: string;
  hash?: string;
};

// === Database Record ===

type CollectionRecord = {
  id: string;
  type: 'file' | 'pkg';
  path: string | null;
  glob: string | null;
  url: string | null;
  manifest_hash: string | null;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
};
```
