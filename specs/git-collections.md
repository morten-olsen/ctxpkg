# Git Collections Specification

> **Status**: Draft  
> **Version**: 1.0  
> **Date**: 2026-01-15

This document specifies support for fetching collections from git repositories, enabling seamless integration with existing documentation workflows that are version-controlled in git.

## Overview

Git collections allow fetching context packages directly from git repositories (via SSH or HTTPS), cloning them to a temporary location, and reading a manifest file from within the repository.

### Motivation

- Many teams already maintain documentation in git repositories
- Enables pinning to specific commits, tags, or branches
- Respects user's local git configuration (SSH keys, credentials, etc.)
- Works with private repositories without additional authentication configuration

## URL Format

### Basic Format

```
git+<protocol>://<host>/<path>[#<ref>]?manifest=<path>
```

### Components

| Component | Required | Description |
|-----------|----------|-------------|
| `git+` | Yes | Protocol prefix indicating git source |
| `protocol` | Yes | `https`, `ssh`, or `file` (for local repos) |
| `host/path` | Yes | Repository location |
| `#ref` | No | Git ref (branch, tag, commit SHA) — defaults to default branch |
| `manifest=` | Yes | Path to manifest.json within the repo |

### Examples

```
# HTTPS with tag and manifest path
git+https://github.com/facebook/react#v18.2.0?manifest=docs/manifest.json

# SSH with branch
git+ssh://git@github.com/myorg/private-docs#main?manifest=manifest.json

# GitHub shorthand SSH
git+ssh://git@github.com:myorg/private-docs.git#v2.0.0?manifest=context/manifest.json

# GitLab HTTPS with specific commit
git+https://gitlab.com/company/standards#a1b2c3d?manifest=manifest.json

# Default branch (no ref specified)
git+https://github.com/owner/repo?manifest=docs/manifest.json

# Local git repo (useful for testing)
git+file:///path/to/local/repo?manifest=manifest.json
```

## Project Configuration

### Schema Extension

```typescript
type CollectionSpec = {
  url: string;  // Can now be git+https:// or git+ssh:// URLs
};
```

The existing `url` field is extended to support git URLs. No new fields are required.

### Example `context.json`

```json
{
  "collections": {
    "react-docs": {
      "url": "git+https://github.com/facebook/react#v18.2.0?manifest=docs/manifest.json"
    },
    "internal-standards": {
      "url": "git+ssh://git@github.com/myorg/standards#main?manifest=manifest.json"
    },
    "typescript": {
      "url": "git+https://github.com/microsoft/TypeScript#v5.3.0?manifest=docs/context/manifest.json"
    }
  }
}
```

## Collection ID

Git collections use the same `pkg:` prefix as other package collections:

```
pkg:git+https://github.com/facebook/react#v18.2.0?manifest=docs/manifest.json
```

The full URL (including ref and manifest path) is used for the ID. This means:
- Different refs = different collection IDs
- Different manifest paths = different collection IDs

This is intentional — pinning to `v18.2.0` vs `v19.0.0` should be distinct collections.

## Sync Behavior

### Sync Algorithm

```
1. Parse git URL to extract:
   - Clone URL (without git+ prefix)
   - Ref (branch/tag/commit or null for default)
   - Manifest path within repo
2. Create temporary directory
3. Clone repository:
   - If ref specified: shallow clone at ref
   - If no ref: shallow clone default branch
4. Locate manifest file at specified path
5. Process manifest as local file collection:
   - Glob sources: expand relative to manifest directory
   - File sources: resolve paths relative to manifest or baseUrl
6. Sync documents to database
7. Clean up temporary directory
```

### Clone Strategy

| Scenario | Git Command |
|----------|-------------|
| Tag/branch ref | `git clone --depth 1 --branch <ref> <url> <tmpdir>` |
| Commit SHA | `git clone <url> <tmpdir>` + `git checkout <sha>` |
| Default branch | `git clone --depth 1 <url> <tmpdir>` |

Shallow clones (`--depth 1`) are used when possible to minimize download time and disk usage.

### Clone Directory Location

**Important**: The temporary clone directory must be relative to the working directory (`cwd`), not in the system temp directory (`/tmp` or `os.tmpdir()`).

**Rationale**: Git's `includeIf` directive allows path-based config overrides:

```gitconfig
[includeIf "gitdir:~/Projects/work/"]
    path = ~/.gitconfig-work
```

If a user has work-specific SSH keys or credentials configured via `includeIf`, cloning to `/tmp` would bypass these settings and potentially fail authentication.

**Implementation**:

```typescript
// Use a hidden directory relative to cwd
const tempDir = join(cwd, '.ctxpkg', 'tmp', `git-${randomId()}`);
```

Directory structure:
```
project/
├── context.json
├── .ctxpkg/
│   └── tmp/
│       └── git-abc123/     # Temporary clone (cleaned up after sync)
└── ...
```

**Cleanup**: The temp directory is removed after sync completes (success or failure). The `.ctxpkg/tmp/` directory can be added to `.gitignore`.

**Note on bundle collections**: The existing `downloadAndExtractBundle()` method uses `os.tmpdir()`. While this doesn't affect bundles (they don't use git), for consistency the implementation may want to migrate all temp operations to the cwd-relative `.ctxpkg/tmp/` directory.

**Alternative approaches considered**:

1. **System temp with `GIT_DIR` override**: Git doesn't support overriding the config lookup path independently of the working directory.

2. **Symlink from cwd to temp**: Adds complexity, potential permission issues.

3. **Configurable temp location**: Possible future enhancement, but cwd-relative default is safest.

### Change Detection

For git collections, change detection uses:

1. **Ref resolution**: Resolve refs to commit SHAs before comparison
2. **Manifest hash**: After clone, hash manifest content as with other packages

| Ref Type | Behavior |
|----------|----------|
| Tag | Stable — only re-clone if manifest hash not stored |
| Branch | Resolve to HEAD commit — re-clone if commit changed |
| Commit SHA | Immutable — skip clone if manifest hash matches |

**Note**: Branch tracking requires network access to check for updates. The `--force` flag always re-clones.

### Error Handling

| Scenario | Handling |
|----------|----------|
| Clone fails (auth, network, repo not found) | Abort sync, surface error, preserve existing state |
| Ref not found | Abort sync, surface error |
| Manifest not found at path | Abort sync, surface error (show available files?) |
| Individual file fetch fails | Log warning, skip file (transient issues) |

## Implementation

### New Dependencies

```json
{
  "dependencies": {
    "simple-git": "^3.x"
  }
}
```

`simple-git` is recommended because:
- Pure JavaScript, no native dependencies
- Respects user's git configuration (SSH keys, credential helpers)
- Well-maintained with good TypeScript support
- Supports all required operations (clone, checkout, ls-remote)

### URL Parsing

```typescript
type ParsedGitUrl = {
  protocol: 'git';
  cloneUrl: string;      // URL without git+ prefix, without query params
  ref: string | null;    // Branch, tag, or commit SHA
  manifestPath: string;  // Path to manifest within repo
};

function parseGitUrl(url: string): ParsedGitUrl | null {
  if (!url.startsWith('git+')) return null;
  
  // Extract ref from fragment
  const [urlWithoutRef, ref] = url.slice(4).split('#');
  
  // Extract manifest path from query
  const urlObj = new URL(urlWithoutRef);
  const manifestPath = urlObj.searchParams.get('manifest');
  
  if (!manifestPath) {
    throw new Error('Git URL must specify manifest path: ?manifest=<path>');
  }
  
  // Remove query params from clone URL
  urlObj.search = '';
  
  return {
    protocol: 'git',
    cloneUrl: urlObj.toString(),
    ref: ref || null,
    manifestPath,
  };
}
```

### CollectionsService Extensions

Add to `parseManifestUrl` return type:

```typescript
type ParsedUrl = {
  protocol: 'file' | 'https' | 'git';
  path: string;
  isBundle: boolean;
  // Git-specific fields (only when protocol === 'git')
  cloneUrl?: string;
  ref?: string | null;
  manifestPath?: string;
};
```

New method for git sync:

```typescript
public syncGitCollection = async (
  name: string,
  spec: CollectionSpec,
  cwd: string,
  options: { force?: boolean; onProgress?: (message: string) => void }
): Promise<SyncResult> => {
  const parsed = parseGitUrl(spec.url);
  let tempDir: string | null = null;
  
  try {
    // 1. Clone to cwd-relative temp directory (preserves includeIf git config)
    const tmpBase = join(cwd, '.ctxpkg', 'tmp');
    await mkdir(tmpBase, { recursive: true });
    tempDir = await mkdtemp(join(tmpBase, 'git-'));
    onProgress?.(`Cloning ${parsed.cloneUrl}...`);
    
    const git = simpleGit();
    const cloneOptions = ['--depth', '1'];
    if (parsed.ref) {
      cloneOptions.push('--branch', parsed.ref);
    }
    
    await git.clone(parsed.cloneUrl, tempDir, cloneOptions);
    
    // 2. Handle commit SHA (can't use --branch)
    if (parsed.ref && isCommitSha(parsed.ref)) {
      await simpleGit(tempDir).checkout(parsed.ref);
    }
    
    // 3. Locate and process manifest
    const manifestPath = join(tempDir, parsed.manifestPath);
    if (!existsSync(manifestPath)) {
      throw new Error(`Manifest not found: ${parsed.manifestPath}`);
    }
    
    // 4. Delegate to local manifest sync logic
    // ... (reuse existing syncPkgCollection logic for local manifests)
    
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
};
```

## CLI Commands

### Existing Commands

The existing `collections add` command works with git URLs:

```bash
# Add git collection
ctxpkg collections add react \
  "git+https://github.com/facebook/react#v18.2.0?manifest=docs/manifest.json"

# Add private repo via SSH
ctxpkg collections add internal \
  "git+ssh://git@github.com/myorg/docs#main?manifest=manifest.json"
```

### Sync Output

```
Syncing react (git)...
  ↓ Cloning github.com/facebook/react @ v18.2.0...
  ↓ Reading manifest from docs/manifest.json...
  + adding: getting-started.md
  + adding: hooks/use-state.md
  ✓ 45 documents (45 added, 0 updated, 0 removed)
```

## Security Considerations

### Git Configuration

`simple-git` respects the user's git configuration:

- **SSH keys**: Uses `~/.ssh/` keys and ssh-agent
- **Credential helpers**: Works with `git credential-osxkeychain`, `git-credential-manager`, etc.
- **Custom SSH commands**: Respects `GIT_SSH_COMMAND` environment variable
- **Proxy settings**: Respects `http.proxy` and `https.proxy` git config

### Private Repositories

No special configuration needed — if the user can `git clone` the repo from their terminal, ctxpkg can clone it too.

### Arbitrary Code Execution

**Risk**: Malicious repositories could potentially exploit git hooks.

**Mitigation**: 
- Use `--config core.hooksPath=/dev/null` or equivalent to disable hooks
- Or use `--no-checkout` followed by manual file extraction

Recommend: Disable hooks during clone:

```typescript
await git.clone(url, dir, ['--depth', '1', '--config', 'core.hooksPath=/dev/null']);
```

## Alternatives Considered

### 1. Separate Fields Instead of URL Format

```json
{
  "git": {
    "repo": "https://github.com/owner/repo",
    "ref": "v1.0.0",
    "manifest": "docs/manifest.json"
  }
}
```

**Rejected**: Breaks the unified `url` field pattern. Harder to copy/paste and share. More schema complexity.

### 2. GitHub/GitLab-Specific APIs

Use platform APIs to download tarballs instead of git clone.

**Rejected**: 
- Doesn't work with self-hosted git servers
- Different auth mechanisms per platform
- Doesn't leverage user's existing git credentials

### 3. Git Submodules / Git Archive

Use `git archive` or submodules for fetching.

**Rejected**: Less portable, more complex, limited ref support.

## Implementation Plan

### Phase 1: URL Parsing

- [ ] Add `parseGitUrl()` function in `collections.ts`
- [ ] Update `parseManifestUrl()` to detect and delegate git URLs
- [ ] Add unit tests for URL parsing edge cases

### Phase 2: Clone Infrastructure

- [ ] Add `simple-git` dependency
- [ ] Implement `ensureTempDir(cwd)` helper for cwd-relative temp directories
- [ ] Implement `cloneRepository()` helper with:
  - Shallow clone support
  - Ref checkout (branch/tag/commit)
  - Hook disabling for security
  - Progress callbacks
  - Clone to cwd-relative temp (preserves `includeIf` git config)
- [ ] Add tests with mock git repos
- [ ] (Optional) Migrate `downloadAndExtractBundle()` to use cwd-relative temp for consistency

### Phase 3: Sync Integration

- [ ] Implement `syncGitCollection()` method
- [ ] Wire into main `syncCollection()` dispatch
- [ ] Refactor shared logic with `syncBundleCollection()` (both use temp directories)
- [ ] Update collection record with git-specific metadata

### Phase 4: Change Detection

- [ ] Implement ref resolution (branch → commit SHA)
- [ ] Store resolved commit SHA in collection record
- [ ] Implement efficient update checking for branches

### Phase 5: Documentation

- [ ] Update README.md with git collection examples
- [ ] Update ARCHITECTURE.md with git sync flow
- [ ] Add troubleshooting section for SSH issues

## Future Considerations

### Sparse Checkout

For large repositories, only checkout the manifest directory:

```bash
git clone --filter=blob:none --sparse <url>
git sparse-checkout set docs/
```

### Monorepo Support

Multiple manifests from the same repo:

```json
{
  "react-core": {
    "url": "git+https://github.com/facebook/react#v18?manifest=packages/react/docs/manifest.json"
  },
  "react-dom": {
    "url": "git+https://github.com/facebook/react#v18?manifest=packages/react-dom/docs/manifest.json"
  }
}
```

This already works with the proposed format (different manifest paths = different collections).

### Git LFS

Large file storage support may be needed for repos with binary documentation assets. Initial implementation can skip LFS files and add support later if needed.

### Caching Clones

For frequently-synced branches, consider keeping a bare clone cache:

```
~/.cache/ctxpkg/git/github.com/owner/repo.git
```

This would allow `git fetch` + `git worktree` instead of full clones. Deferred for now due to complexity.

---

## Appendix: Full Type Definitions

```typescript
// URL parsing result
type ParsedGitUrl = {
  protocol: 'git';
  cloneUrl: string;
  ref: string | null;
  manifestPath: string;
};

// Extended parse result (from parseManifestUrl)
type ParsedManifestUrl = 
  | { protocol: 'file'; path: string; isBundle: boolean }
  | { protocol: 'https'; path: string; isBundle: boolean }
  | { protocol: 'git'; cloneUrl: string; ref: string | null; manifestPath: string; isBundle: false };

// Collection record extension (optional)
type CollectionRecord = {
  // ... existing fields ...
  git_commit?: string;  // Resolved commit SHA (for branch change detection)
};
```
