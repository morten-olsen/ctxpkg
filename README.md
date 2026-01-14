# mortens-ai-assist

An AI-powered assistant for software development with reference document management and semantic search capabilities.

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd ai-assist

# Install dependencies
pnpm install

# Build the project
pnpm run build
```

## Configuration

Before using the tool, configure your OpenAI-compatible API credentials:

```bash
# Set your API key
mortens-ai-assist config set openai.apiKey sk-your-key-here

# Optional: Use a different provider (default: https://api.openai.com/v1)
mortens-ai-assist config set openai.baseUrl https://api.your-provider.com/v1

# Optional: Change the model (default: gpt-4o)
mortens-ai-assist config set openai.model gpt-4o-mini
```

Configuration is stored in your system's config directory and persists across sessions.

## CLI Usage

```
mortens-ai-assist <command> [options]
```

### Chat Commands

Interactive AI assistant with access to file and git tools.

```bash
# Start an interactive chat session
mortens-ai-assist chat session
mortens-ai-assist chat s
mortens-ai-assist session      # shortcut

# Send a single prompt
mortens-ai-assist chat ask "What files are in the src directory?"
mortens-ai-assist chat a "Summarize the recent commits"
mortens-ai-assist ask "..."    # shortcut
```

### Configuration Commands

Manage application settings.

```bash
# List all configuration values
mortens-ai-assist config list
mortens-ai-assist config ls
mortens-ai-assist config ls --all    # include sensitive values

# Get a specific value
mortens-ai-assist config get openai.model

# Set a value
mortens-ai-assist config set openai.temperature 0.7

# Interactive editor
mortens-ai-assist config edit
mortens-ai-assist config edit openai.model

# Reset to default
mortens-ai-assist config reset openai.temperature

# Show config file location
mortens-ai-assist config path
```

### Reference Document Commands

Manage collections of reference documents with semantic search.

```bash
# List all collections
mortens-ai-assist ref ls
mortens-ai-assist references list-collections

# Add/update documents from files
mortens-ai-assist ref update -p "**/*.md" -c my-docs
mortens-ai-assist ref update --pattern "docs/**/*.md" --cwd ./project --collection project-docs

# Search documents
mortens-ai-assist ref search "how to configure authentication"
mortens-ai-assist ref search "error handling" -c my-docs -l 5
mortens-ai-assist ref search "query" --collections docs guides --limit 20

# Interactive search
mortens-ai-assist ref isearch

# Drop a collection
mortens-ai-assist ref drop              # interactive selection
mortens-ai-assist ref drop my-docs      # specific collection
mortens-ai-assist ref drop my-docs -f   # skip confirmation
```

### Command Aliases

| Full Command | Alias |
|--------------|-------|
| `chat session` | `session`, `s` |
| `chat ask` | `ask`, `a` |
| `config` | `cfg` |
| `config list` | `config ls` |
| `references` | `ref` |
| `references list-collections` | `ref ls` |
| `references drop-collection` | `ref drop` |
| `references update-collection` | `ref update` |
| `references interactive-search` | `ref isearch` |

## Features

### AI Chat Assistant

The chat assistant uses LangChain with OpenAI-compatible models and has access to:

- **File tools**: Read files, glob patterns, search file contents, get file stats
- **Git tools**: Repository status, diffs, commit history
- **Reference tools**: List collections, semantic search across indexed documents

The assistant can search your indexed reference documentation during conversations to provide context-aware answers.

### Reference Documents

Store and search documentation using semantic embeddings:

- Documents are chunked and embedded using the `mxbai-embed-large-v1` model
- Vector similarity search powered by SQLite with `sqlite-vec`
- Organize documents into named collections
- Update collections from glob patterns

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | API key for OpenAI-compatible provider | - |
| `OPENAI_BASE_URL` | Base URL for the API | `https://api.openai.com/v1` |
| `OPENAI_MODEL` | Model to use | `gpt-4o` |

Environment variables take precedence over config file values.

## Development

```bash
# Run linting
pnpm run test:lint

# Run tests
pnpm run test:unit

# Build
pnpm run build
```

## License

MIT
