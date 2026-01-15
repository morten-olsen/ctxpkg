# Configuration Guide

This guide covers all configuration options for ctxpkg: project configuration, global configuration, and package manifests.

## Project Configuration

Projects use a `context.json` file to declare their local collections. Create one with:

```bash
ctxpkg col init
```

### File Location

The `context.json` file lives in your project root, alongside your code.

### Format

```json
{
  "collections": {
    "<alias>": {
      "url": "<manifest-url>"
    }
  }
}
```

### Example

```json
{
  "collections": {
    "project-docs": {
      "url": "file://./docs/manifest.json"
    },
    "react": {
      "url": "git+https://github.com/facebook/react#v18.2.0?manifest=docs/manifest.json"
    },
    "org-standards": {
      "url": "git+ssh://git@github.com/myorg/standards#main?manifest=manifest.json"
    },
    "lodash": {
      "url": "https://example.com/lodash-docs.tar.gz"
    }
  }
}
```

### URL Formats

| Format | Example | Description |
|--------|---------|-------------|
| Relative path | `./docs/manifest.json` | Local manifest relative to `context.json` |
| `file://` URL | `file://../shared/manifest.json` | Explicit local file reference |
| `file://` absolute | `file:///Users/me/docs/manifest.json` | Absolute local path |
| Git HTTPS | `git+https://github.com/org/repo#ref?manifest=path` | Git repo via HTTPS |
| Git SSH | `git+ssh://git@github.com/org/repo#ref?manifest=path` | Git repo via SSH (private repos) |
| HTTP/HTTPS | `https://example.com/manifest.json` | Remote manifest |
| Bundle URL | `https://example.com/docs.tar.gz` | Pre-packaged bundle |

### Git URL Format

Git URLs follow the pattern: `git+<protocol>://<host>/<repo>#<ref>?manifest=<path>`

| Component | Required | Description |
|-----------|----------|-------------|
| `git+` | Yes | Protocol prefix |
| `protocol` | Yes | `https` or `ssh` |
| `#ref` | No | Branch, tag, or commit SHA (defaults to default branch) |
| `manifest=` | Yes | Path to `manifest.json` within the repo |

**Examples:**
```
git+https://github.com/facebook/react#v18.2.0?manifest=docs/manifest.json
git+ssh://git@github.com/myorg/private-docs#main?manifest=manifest.json
git+https://gitlab.com/company/standards#a1b2c3d?manifest=manifest.json
```

Git collections use your local git configuration — SSH keys, credential helpers, and `includeIf` directives all work as expected.

## Global Configuration

Global collections are available across all your projects — perfect for personal notes, company standards, or commonly-used library documentation.

### File Location

- **Linux/macOS:** `~/.config/ctxpkg/global-context.json`
- **Windows:** `%APPDATA%\ctxpkg\global-context.json`

The file is auto-created when you first add a global collection.

### Format

Same as project configuration:

```json
{
  "collections": {
    "typescript-docs": {
      "url": "git+https://github.com/microsoft/TypeScript#v5.3.0?manifest=docs/manifest.json"
    },
    "personal-notes": {
      "url": "file:///Users/me/notes/manifest.json"
    },
    "company-standards": {
      "url": "git+ssh://git@github.com/myorg/standards#main?manifest=manifest.json"
    }
  }
}
```

### Adding Global Collections

```bash
ctxpkg col add -g <alias> <url>
```

### Resolution Order

When both project and global configs have a collection with the same alias, **the project collection takes precedence**. This lets you override global defaults per-project.

## Package Manifest

A manifest (`manifest.json`) describes the contents of a documentation package.

### Basic Structure

```json
{
  "name": "package-name",
  "version": "1.0.0",
  "description": "Human-readable description",
  "sources": {
    // One of: glob, files
  }
}
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Package identifier (used in bundle filenames) |
| `version` | Yes | Semantic version string |
| `description` | No | Shown in collection listings |
| `baseUrl` | No | Base URL for relative file paths |
| `sources` | Yes | Document sources (see below) |

### Source Types

#### Glob Patterns

Include files matching glob patterns:

```json
{
  "name": "my-docs",
  "version": "1.0.0",
  "sources": {
    "glob": ["**/*.md"]
  }
}
```

Multiple patterns:

```json
{
  "sources": {
    "glob": [
      "docs/**/*.md",
      "guides/**/*.md",
      "!**/draft-*.md"
    ]
  }
}
```

Patterns starting with `!` exclude files.

#### Explicit File List

For precise control over included files:

```json
{
  "name": "my-docs",
  "version": "1.0.0",
  "sources": {
    "files": [
      "getting-started.md",
      "api/core.md",
      "api/utilities.md"
    ]
  }
}
```

With hashes for integrity verification:

```json
{
  "sources": {
    "files": [
      { "path": "api/core.md", "hash": "sha256:9f86d081..." },
      { "path": "api/utils.md", "hash": "sha256:a1b2c3d4..." }
    ]
  }
}
```

With custom URLs per file:

```json
{
  "sources": {
    "files": [
      "local-file.md",
      { "url": "https://other-cdn.com/shared/contributing.md" }
    ]
  }
}
```

### Using baseUrl

The `baseUrl` field provides a base for relative file paths when distributing via HTTP:

```json
{
  "name": "my-framework-docs",
  "version": "2.0.0",
  "baseUrl": "https://cdn.example.com/docs/v2/",
  "sources": {
    "files": [
      "getting-started.md",
      "api/core.md"
    ]
  }
}
```

Files are fetched from:
- `https://cdn.example.com/docs/v2/getting-started.md`
- `https://cdn.example.com/docs/v2/api/core.md`

### Complete Example

```json
{
  "name": "acme-framework",
  "version": "3.1.0",
  "description": "Complete documentation for ACME Framework",
  "baseUrl": "https://docs.acme.com/v3.1/",
  "sources": {
    "files": [
      "index.md",
      "getting-started.md",
      { "path": "api/core.md", "hash": "sha256:abc123..." },
      { "path": "api/utils.md", "hash": "sha256:def456..." },
      { "url": "https://shared.acme.com/common/security.md" }
    ]
  }
}
```

## Application Settings

ctxpkg stores application-level settings separately from collection configuration.

### View Settings

```bash
ctxpkg config list
```

### Get/Set Settings

```bash
ctxpkg config get <key>
ctxpkg config set <key> <value>
```

### Config File Location

```bash
ctxpkg config path
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CTXPKG_DATA_DIR` | Override data directory (database location) |
| `CTXPKG_CONFIG_DIR` | Override config directory |

## Authentication for Private Packages

### Git Repositories (Recommended)

For private git repositories, use SSH URLs — ctxpkg respects your local git configuration:

```bash
# Uses your SSH keys from ~/.ssh/
ctxpkg col add private-docs "git+ssh://git@github.com/myorg/docs#main?manifest=manifest.json"
```

This works with:
- SSH keys and ssh-agent
- Git credential helpers
- `includeIf` directives for directory-specific configs

If you can `git clone` a repository from your terminal, ctxpkg can index it.

### HTTP URLs with netrc

For private packages served via HTTP, ctxpkg supports netrc-based authentication.

### Using netrc

Create or edit `~/.netrc`:

```
machine github.com
  login your-username
  password ghp_your_personal_access_token

machine code.example.com
  login your-username
  password your-token
```

Secure the file:

```bash
chmod 600 ~/.netrc
```

ctxpkg automatically uses these credentials when fetching packages from matching hosts.

### GitHub Tokens

For GitHub private repositories:

1. Go to **Settings > Developer settings > Personal access tokens**
2. Create a token with `repo` scope (or `Contents: Read-only` for fine-grained)
3. Add to `~/.netrc` as shown above

See [Distributing Collections via GitHub](./github-distribution.md#private-repositories) for more details.

## See Also

- [Getting Started](./getting-started.md) — First-time setup tutorial
- [CLI Reference](./cli-reference.md) — Full command documentation
- [Publishing Packages](./github-distribution.md) — Creating and distributing packages
