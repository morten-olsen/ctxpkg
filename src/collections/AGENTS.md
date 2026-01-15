# Collections — Agent Guidelines

This document describes the collections module architecture for AI agents working on this codebase.

## Overview

The collections module manages context packages — both local and remote manifest-based packages. It handles project configuration (`context.json`), collection syncing, and manifest resolution. Think of it as the "package manager" part of ctxpkg.

## File Structure

| File | Purpose |
|------|---------|
| `collections.ts` | `CollectionsService` — sync logic, project config, manifest handling |
| `collections.schemas.ts` | Zod schemas for specs, manifests, and database records |

## Core Concepts

### Collection Spec

All collections are manifest-based packages identified by URL:

```typescript
type CollectionSpec = { url: string };
```

Collection IDs are computed as `pkg:{normalized_url}`.

### Project Config (`context.json`)

Maps user-friendly names to collection specs:

```json
{
  "collections": {
    "my-docs": { "url": "file://./docs/manifest.json" },
    "langchain": { "url": "https://example.com/langchain/manifest.json" }
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
│  writeProjectConfig()  │  syncPkgCollection()               │
│  addToProjectConfig()  │  syncBundleCollection()            │
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
                    │ DocumentsService │  (stores documents)
                    └──────────────────┘
```

## Sync Flow

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

IDs are deterministic and computed from the URL:

```typescript
// Normalized URL (trailing slashes removed)
`pkg:${url.replace(/\/+$/, '')}`
```

This ensures the same spec always maps to the same collection ID.

## Key Patterns

### Manifest Source Resolution

The service handles multiple source formats:

- **Glob sources**: `{ glob: ['**/*.md'] }` — expanded relative to manifest directory
- **File sources**: `{ files: ['path.md', { url: '...' }] }` — resolved via `baseUrl` or manifest location

### Change Detection

- **Manifest hash**: Skip sync if manifest unchanged
- **Content hash**: Per-file content hash comparison for updates
- **Force sync**: `force: true` option bypasses hash checks
