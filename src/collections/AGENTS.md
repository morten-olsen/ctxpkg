# Collections — Agent Guidelines

This document describes the collections module architecture for AI agents working on this codebase.

## Overview

The collections module manages context packages — both local file collections and remote packages. It handles project configuration (`context.json`), collection syncing, and manifest resolution. Think of it as the "package manager" part of ctxpkg.

## File Structure

| File | Purpose |
|------|---------|
| `collections.ts` | `CollectionsService` — sync logic, project config, manifest handling |
| `collections.schemas.ts` | Zod schemas for specs, manifests, and database records |

## Core Concepts

### Collection Types

| Type | Spec | ID Format | Use Case |
|------|------|-----------|----------|
| `file` | `{ type: 'file', path, glob }` | `file:{sha256}` | Local files matching a glob |
| `pkg` | `{ type: 'pkg', url }` | `pkg:{url}` | Remote packages with manifest |

### Project Config (`context.json`)

Maps user-friendly names to collection specs:

```json
{
  "collections": {
    "my-docs": { "type": "file", "path": "./docs", "glob": "**/*.md" },
    "langchain": { "type": "pkg", "url": "https://example.com/langchain/manifest.json" }
  }
}
```

### Package Manifests

Remote packages have a `manifest.json`:

```json
{
  "name": "my-package",
  "version": "1.0.0",
  "baseUrl": "https://example.com/files/",
  "sources": {
    "files": [
      "intro.md",
      { "path": "guide.md", "hash": "abc123..." }
    ]
  }
}
```

Sources can be `{ glob: [...] }` (local only) or `{ files: [...] }`.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   CollectionsService                        │
├─────────────────────────────────────────────────────────────┤
│  Project Config        │  Sync Operations                   │
│  ─────────────────     │  ────────────────                  │
│  readProjectConfig()   │  syncCollection()                  │
│  writeProjectConfig()  │  syncFileCollection()              │
│  addToProjectConfig()  │  syncPkgCollection()               │
│                        │  syncBundleCollection()            │
├────────────────────────┼────────────────────────────────────┤
│  Collection IDs        │  Manifest Handling                 │
│  ─────────────────     │  ────────────────────              │
│  computeCollectionId() │  loadLocalManifest()               │
│  normalizePath()       │  loadRemoteManifest()              │
│                        │  resolveManifestSources()          │
│                        │  downloadAndExtractBundle()        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │ ReferencesService│  (stores documents)
                    └─────────────────┘
```

## Sync Flow

### File Collections

1. Glob for files in `spec.path` matching `spec.glob`
2. Hash each file's content
3. Compare with existing documents in database
4. Add/update/remove documents as needed
5. Update collection record with `last_sync_at`

### Package Collections

1. Parse manifest URL (file:// or https://)
2. Load and parse `manifest.json`
3. Check manifest hash — skip if unchanged
4. Resolve sources to file entries (expand globs or resolve paths)
5. Fetch and hash each file
6. Sync to database, update collection record

### Bundle Collections (.tar.gz)

1. Download and extract to temp directory
2. Find `manifest.json` in extracted content
3. Process as local package collection
4. Clean up temp directory

## Collection ID Computation

IDs are deterministic and computed from the spec:

```typescript
// File: hash of normalized path + glob
`file:${sha256(normalizedPath + ':' + glob)}`

// Package: normalized URL
`pkg:${url.replace(/\/+$/, '')}`
```

This ensures the same spec always maps to the same collection ID.

## Key Patterns

### Adding a New Source Type

1. Add schema in `collections.schemas.ts`:

```typescript
const mySpecSchema = z.object({
  type: z.literal('mytype'),
  // ... fields
});

// Add to discriminated union
const collectionSpecSchema = z.discriminatedUnion('type', [
  fileSpecSchema,
  pkgSpecSchema,
  mySpecSchema,
]);
```

2. Add type guard:

```typescript
const isMySpec = (spec: CollectionSpec): spec is MySpec => {
  return spec.type === 'mytype';
};
```

3. Implement sync method in `CollectionsService`:

```typescript
public syncMyCollection = async (name, spec, cwd, options): Promise<SyncResult> => {
  // ... implementation
};
```

4. Add case to `syncCollection()` dispatcher.

### Manifest Source Resolution

The service handles multiple source formats:

- **Glob sources**: `{ glob: ['**/*.md'] }` — expanded relative to manifest directory
- **File sources**: `{ files: ['path.md', { url: '...' }] }` — resolved via `baseUrl` or manifest location

### Change Detection

- **File collections**: Content hash comparison
- **Package collections**: Manifest hash for skip-if-unchanged, then per-file content hash
- **Force sync**: `force: true` option bypasses hash checks
