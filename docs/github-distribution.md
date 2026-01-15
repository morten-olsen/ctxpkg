# Distributing Collections via GitHub Releases

This guide explains how to build and distribute a ctxpkg collection package using GitHub Actions and GitHub Releases.

## Overview

You can publish your documentation as a ctxpkg collection that others can install. The workflow:

1. Create a repository with your documentation and a `manifest.json`
2. Use GitHub Actions to build a bundle (`.tar.gz`) on release
3. Publish the bundle as a GitHub Release asset
4. Users install via the release URL

## Repository Structure

Set up your documentation repository like this:

```
my-framework-docs/
├── manifest.json          # Package manifest (required)
├── docs/
│   ├── getting-started.md
│   ├── api/
│   │   ├── core.md
│   │   └── utilities.md
│   └── guides/
│       ├── authentication.md
│       └── deployment.md
└── .github/
    └── workflows/
        └── release.yml    # Build and publish workflow
```

## Creating the Manifest

Create a `manifest.json` at the repository root:

```json
{
  "name": "my-framework-docs",
  "version": "1.0.0",
  "description": "Official documentation for My Framework",
  "sources": {
    "glob": ["docs/**/*.md"]
  }
}
```

### Manifest Options

**Using glob patterns** (recommended for most cases):

```json
{
  "name": "my-framework-docs",
  "version": "1.0.0",
  "sources": {
    "glob": ["docs/**/*.md", "guides/**/*.md"]
  }
}
```

**Using explicit file list** (for precise control):

```json
{
  "name": "my-framework-docs",
  "version": "1.0.0",
  "sources": {
    "files": [
      "docs/getting-started.md",
      "docs/api/core.md",
      "docs/api/utilities.md"
    ]
  }
}
```

## GitHub Actions Workflow

Create `.github/workflows/release.yml`:

```yaml
name: Build and Release

on:
  release:
    types: [published]

permissions:
  contents: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install ctxpkg
        run: |
          git clone https://code.olsen.cloud/incubator/ctxpkg.git /tmp/ctxpkg
          cd /tmp/ctxpkg && npm install && npm link

      - name: Update manifest version
        run: |
          # Update version in manifest.json to match the release tag
          VERSION="${{ github.event.release.tag_name }}"
          VERSION="${VERSION#v}"  # Remove 'v' prefix if present
          jq --arg v "$VERSION" '.version = $v' manifest.json > manifest.tmp.json
          mv manifest.tmp.json manifest.json

      - name: Build bundle
        run: |
          VERSION="${{ github.event.release.tag_name }}"
          VERSION="${VERSION#v}"
          ctxpkg col pack --output "${{ github.event.repository.name }}-${VERSION}.tar.gz"

      - name: Upload release asset
        uses: softprops/action-gh-release@v2
        with:
          files: "*.tar.gz"
```

## Creating a Release

1. **Tag your release:**

   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

2. **Create the release on GitHub:**
   - Go to your repository's "Releases" page
   - Click "Draft a new release"
   - Select the tag you created
   - Add release notes
   - Click "Publish release"

3. **The workflow runs automatically** and attaches the bundle to the release.

## Consumer Usage

Users can install your published collection by referencing the release asset URL:

```bash
# Add to project
ctxpkg col add my-framework https://github.com/your-org/my-framework-docs/releases/download/v1.0.0/my-framework-docs-1.0.0.tar.gz

# Or using the manifest URL for latest
ctxpkg col add my-framework https://github.com/your-org/my-framework-docs/releases/latest/download/my-framework-docs.tar.gz
```

Or directly in `context.json`:

```json
{
  "collections": {
    "my-framework": {
      "type": "pkg",
      "url": "https://github.com/your-org/my-framework-docs/releases/download/v1.0.0/my-framework-docs-1.0.0.tar.gz"
    }
  }
}
```

## Advanced: Version-Agnostic Bundle Name

To support a "latest" URL that always points to the newest release, use a consistent bundle name:

```yaml
- name: Build bundle
  run: |
    ctxpkg col pack --output "${{ github.event.repository.name }}.tar.gz"
```

Users can then use:

```
https://github.com/your-org/my-framework-docs/releases/latest/download/my-framework-docs.tar.gz
```

## Advanced: Pre-release Validation

Add a workflow to validate your manifest on pull requests:

```yaml
name: Validate

on:
  pull_request:
    branches: [main]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install ctxpkg
        run: |
          git clone https://code.olsen.cloud/incubator/ctxpkg.git /tmp/ctxpkg
          cd /tmp/ctxpkg && npm install && npm link

      - name: Validate manifest and build
        run: |
          # Attempt to build - will fail if manifest is invalid
          ctxpkg col pack --output test-bundle.tar.gz
          echo "Bundle built successfully"
          ls -lh test-bundle.tar.gz
```

## Advanced: Automated Version Bumping

For repositories that want automated versioning based on conventional commits:

```yaml
name: Build and Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install ctxpkg
        run: |
          git clone https://code.olsen.cloud/incubator/ctxpkg.git /tmp/ctxpkg
          cd /tmp/ctxpkg && npm install && npm link

      - name: Get version from tag
        id: version
        run: |
          VERSION="${GITHUB_REF_NAME#v}"
          echo "version=$VERSION" >> $GITHUB_OUTPUT

      - name: Update manifest version
        run: |
          jq --arg v "${{ steps.version.outputs.version }}" '.version = $v' manifest.json > manifest.tmp.json
          mv manifest.tmp.json manifest.json

      - name: Build bundle
        run: |
          ctxpkg col pack --output "${{ github.event.repository.name }}-${{ steps.version.outputs.version }}.tar.gz"

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          files: "*.tar.gz"
          generate_release_notes: true
```

## Advanced: Multiple Bundles from One Repository

A single repository can publish multiple collection bundles — useful for monorepos, tiered documentation, or multi-version APIs.

### Repository Structure

```
my-org-docs/
├── packages/
│   ├── core/
│   │   ├── manifest.json
│   │   └── docs/
│   │       ├── getting-started.md
│   │       └── api.md
│   ├── cli/
│   │   ├── manifest.json
│   │   └── docs/
│   │       ├── installation.md
│   │       └── commands.md
│   └── plugins/
│       ├── manifest.json
│       └── docs/
│           └── plugin-api.md
└── .github/
    └── workflows/
        └── release.yml
```

Each package has its own `manifest.json`:

```json
{
  "name": "my-org-core",
  "version": "1.0.0",
  "description": "Core library documentation",
  "sources": {
    "glob": ["docs/**/*.md"]
  }
}
```

### Workflow: Build All Packages

```yaml
name: Build and Release

on:
  release:
    types: [published]

permissions:
  contents: write

jobs:
  build:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        package: [core, cli, plugins]
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install ctxpkg
        run: |
          git clone https://code.olsen.cloud/incubator/ctxpkg.git /tmp/ctxpkg
          cd /tmp/ctxpkg && npm install && npm link

      - name: Get version from tag
        id: version
        run: |
          VERSION="${{ github.event.release.tag_name }}"
          VERSION="${VERSION#v}"
          echo "version=$VERSION" >> $GITHUB_OUTPUT

      - name: Update manifest version
        working-directory: packages/${{ matrix.package }}
        run: |
          jq --arg v "${{ steps.version.outputs.version }}" '.version = $v' manifest.json > manifest.tmp.json
          mv manifest.tmp.json manifest.json

      - name: Build bundle
        working-directory: packages/${{ matrix.package }}
        run: |
          PACKAGE_NAME=$(jq -r '.name' manifest.json)
          ctxpkg col pack --output "../../${PACKAGE_NAME}-${{ steps.version.outputs.version }}.tar.gz"

      - name: Upload release asset
        uses: softprops/action-gh-release@v2
        with:
          files: "*.tar.gz"
```

### Alternative: Dynamic Package Discovery

Automatically discover and build all packages without hardcoding:

```yaml
name: Build and Release

on:
  release:
    types: [published]

permissions:
  contents: write

jobs:
  discover:
    runs-on: ubuntu-latest
    outputs:
      packages: ${{ steps.find.outputs.packages }}
    steps:
      - uses: actions/checkout@v4

      - name: Find packages
        id: find
        run: |
          # Find all directories containing manifest.json
          PACKAGES=$(find packages -name manifest.json -printf '%h\n' | sed 's|packages/||' | jq -R -s -c 'split("\n") | map(select(length > 0))')
          echo "packages=$PACKAGES" >> $GITHUB_OUTPUT

  build:
    needs: discover
    runs-on: ubuntu-latest
    strategy:
      matrix:
        package: ${{ fromJson(needs.discover.outputs.packages) }}
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install ctxpkg
        run: |
          git clone https://code.olsen.cloud/incubator/ctxpkg.git /tmp/ctxpkg
          cd /tmp/ctxpkg && npm install && npm link

      - name: Get version from tag
        id: version
        run: |
          VERSION="${{ github.event.release.tag_name }}"
          VERSION="${VERSION#v}"
          echo "version=$VERSION" >> $GITHUB_OUTPUT

      - name: Update manifest and build
        working-directory: packages/${{ matrix.package }}
        run: |
          jq --arg v "${{ steps.version.outputs.version }}" '.version = $v' manifest.json > manifest.tmp.json
          mv manifest.tmp.json manifest.json
          PACKAGE_NAME=$(jq -r '.name' manifest.json)
          ctxpkg col pack --output "../../${PACKAGE_NAME}-${{ steps.version.outputs.version }}.tar.gz"

      - name: Upload release asset
        uses: softprops/action-gh-release@v2
        with:
          files: "*.tar.gz"
```

### Alternative: Tiered Documentation

Release different subsets of the same documentation (e.g., public vs internal):

```
my-framework-docs/
├── manifests/
│   ├── public.json       # Public API docs only
│   ├── full.json         # All documentation
│   └── internal.json     # Internal/contributor docs
├── docs/
│   ├── public/
│   │   └── ...
│   ├── internal/
│   │   └── ...
│   └── contributor/
│       └── ...
└── .github/
    └── workflows/
        └── release.yml
```

Manifest examples:

```json
// manifests/public.json
{
  "name": "my-framework-public",
  "version": "1.0.0",
  "sources": {
    "glob": ["docs/public/**/*.md"]
  }
}
```

```json
// manifests/full.json
{
  "name": "my-framework-full",
  "version": "1.0.0",
  "sources": {
    "glob": ["docs/**/*.md"]
  }
}
```

Workflow:

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        manifest: [public, full, internal]
    steps:
      # ... setup steps ...

      - name: Build bundle
        run: |
          VERSION="${{ github.event.release.tag_name }}"
          VERSION="${VERSION#v}"
          
          # Update version
          jq --arg v "$VERSION" '.version = $v' manifests/${{ matrix.manifest }}.json > manifest.json
          
          PACKAGE_NAME=$(jq -r '.name' manifest.json)
          ctxpkg col pack --output "${PACKAGE_NAME}-${VERSION}.tar.gz"

      - name: Upload release asset
        uses: softprops/action-gh-release@v2
        with:
          files: "*.tar.gz"
```

### Consumer Usage for Multi-Bundle Repos

Users pick the specific bundle they need:

```json
{
  "collections": {
    "my-org-core": {
      "type": "pkg",
      "url": "https://github.com/my-org/docs/releases/download/v1.0.0/my-org-core-1.0.0.tar.gz"
    },
    "my-org-cli": {
      "type": "pkg",
      "url": "https://github.com/my-org/docs/releases/download/v1.0.0/my-org-cli-1.0.0.tar.gz"
    }
  }
}
```

Or install all packages at once:

```bash
VERSION="1.0.0"
for pkg in core cli plugins; do
  ctxpkg col add "my-org-${pkg}" "https://github.com/my-org/docs/releases/download/v${VERSION}/my-org-${pkg}-${VERSION}.tar.gz"
done
```

## Tips

- **Keep documentation focused**: Each collection should cover a specific topic or framework
- **Use semantic versioning**: Follow semver (major.minor.patch) for version numbers
- **Document your collection**: Add a README explaining what documentation is included
- **Test locally first**: Run `ctxpkg col pack` locally before pushing to verify the manifest works
- **Pin versions for stability**: Consumers should pin to specific versions in production

## Troubleshooting

### Bundle is empty or missing files

Check that your glob patterns in `manifest.json` match your file structure:

```bash
# Test your glob patterns locally
ctxpkg col pack --output test.tar.gz
tar -tzf test.tar.gz
```

### GitHub Actions can't find ctxpkg

Ensure the ctxpkg installation step completed successfully. The install step should be:

```yaml
- name: Install ctxpkg
  run: |
    git clone https://code.olsen.cloud/incubator/ctxpkg.git /tmp/ctxpkg
    cd /tmp/ctxpkg && npm install && npm link
```

If cloning fails, check that the repository URL is correct and accessible.

### Release asset URL returns 404

- Verify the release is published (not draft)
- Check the asset filename matches exactly (case-sensitive)
- Ensure the repository is public, or use a token for private repos
