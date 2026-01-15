# Collections — Agent Guidelines

This document describes the collections module architecture for AI agents working on this codebase.

## Overview

The collections module manages context packages — local files, remote URLs, and git repositories. It handles project configuration (`context.json`), collection syncing, and manifest resolution. Think of it as the "package manager" part of ctxpkg.

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

Maps user-friendly names to collection specs (local to a project):

```json
{
  "collections": {
    "my-docs": { "url": "file://./docs/manifest.json" },
    "langchain": { "url": "https://example.com/langchain/manifest.json" },
    "react": { "url": "git+https://github.com/facebook/react#v18.2.0?manifest=docs/manifest.json" }
  }
}
```

### URL Formats

| Protocol | Format | Example |
|----------|--------|---------|
| Local file | `file://path/to/manifest.json` | `file://./docs/manifest.json` |
| HTTPS | `https://host/path/manifest.json` | `https://example.com/pkg/manifest.json` |
| Git HTTPS | `git+https://host/repo#ref?manifest=path` | `git+https://github.com/owner/repo#v1.0?manifest=docs/manifest.json` |
| Git SSH | `git+ssh://git@host/repo#ref?manifest=path` | `git+ssh://git@github.com/org/repo#main?manifest=manifest.json` |
| Git local | `git+file:///path/repo?manifest=path` | `git+file:///tmp/repo?manifest=manifest.json` |
| Bundle | `*.tar.gz` or `*.tgz` | `https://example.com/pkg.tar.gz` |

### Global Config (`~/.config/ctxpkg/global-context.json`)

Same structure as project config, but user-level (available across all projects):

```json
{
  "collections": {
    "typescript-docs": { "url": "https://example.com/ts-docs/manifest.json" }
  }
}
```

When resolving collection aliases, local takes precedence over global.

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
│  Project Config        │  Global Config                     │
│  ─────────────────     │  ─────────────────                 │
│  readProjectConfig()   │  readGlobalConfig()                │
│  writeProjectConfig()  │  writeGlobalConfig()               │
│  projectConfigExists() │  globalConfigExists()              │
├────────────────────────┼────────────────────────────────────┤
│  Unified Config Ops    │  Sync Operations                   │
│  ─────────────────     │  ────────────────                  │
│  addToConfig()         │  syncCollection()                  │
│  removeFromConfig()    │  syncPkgCollection()               │
│  getFromConfig()       │  syncBundleCollection()            │
│  getAllCollections()   │  syncGitCollection()               │
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

**Unified Config Operations:**
- `addToConfig(name, spec, { global })` - Add to project or global config
- `removeFromConfig(name, { global })` - Remove from project or global config
- `getFromConfig(name, { global })` - Get spec (if global undefined, searches local then global)
- `getAllCollections()` - Get all collections from both configs with source indicators

## Sync Flow

### Package Collections (file://, https://)

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

### Git Collections

1. Parse git URL to extract clone URL, ref, and manifest path
2. Clone to cwd-relative temp directory (`.ctxpkg/tmp/git-*`)
   - Uses shallow clone (`--depth 1`) when possible
   - Disables git hooks for security
   - Preserves user's git config (includeIf directives, SSH keys, etc.)
3. Checkout specific ref (branch/tag/commit)
4. Load manifest from specified path in repo
5. Process as local package collection
6. Clean up temp directory

**Git URL Components:**
- `git+https://` or `git+ssh://` — protocol prefix
- `#ref` — optional branch, tag, or commit SHA (defaults to default branch)
- `?manifest=path` — required path to manifest.json in repo

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
