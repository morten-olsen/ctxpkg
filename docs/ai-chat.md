# AI Chat & Agent Mode

This guide covers ctxpkg's AI-powered chat features that let you have conversations with your documentation using natural language.

## Overview

While the standard MCP server exposes individual tools that AI agents call repeatedly, the **Agent Mode** consolidates this into a single, intelligent query. An internal AI agent searches your documentation, follows up on leads, and synthesizes a comprehensive answer — returning just the final result.

**Why use Agent Mode?**

- **Reduced token costs**: Only the synthesized answer goes back to the calling agent, not intermediate search results
- **Simpler integration**: One tool (`ask_documents`) instead of eight
- **Smarter search**: The internal agent decides when it has found enough information
- **CLI chat**: Query your docs directly from the terminal

**Trade-off**: Agent mode requires an LLM API key and incurs API costs for the internal reasoning.

## Quick Start

### 1. Configure Your LLM

```bash
# Set your API key (OpenAI or compatible provider)
ctxpkg config set llm.apiKey sk-...

# Optionally customize the model
ctxpkg config set llm.model gpt-4o
```

Or use environment variables:

```bash
export CTXPKG_LLM_API_KEY=sk-...
export CTXPKG_LLM_MODEL=gpt-4o
```

### 2. Chat from the CLI

```bash
# One-shot question
ctxpkg chat "How do I implement authentication?" \
  --use-case "Building a secure REST API"

# Interactive session
ctxpkg chat -i
```

### 3. Or Use Agent Mode MCP

Configure your AI editor to use agent mode:

```json
{
  "mcpServers": {
    "ctxpkg": {
      "command": "ctxpkg",
      "args": ["mcp", "agent"]
    }
  }
}
```

## CLI Chat Command

The `ctxpkg chat` command provides direct access to your documentation through conversation.

### One-Shot Mode

Ask a single question and get an answer:

```bash
ctxpkg chat "What are the best practices for error handling?" \
  --use-case "Building production Node.js services"
```

If you don't provide a use case, you'll be prompted for one:

```bash
ctxpkg chat "How do I configure logging?"
# → What is your use case? (helps find relevant information)
# → Setting up observability for my microservices
```

**Output:**

```
ℹ Searching documentation...

╭─────────────────────────────────────────────────────────────────────╮
│ Answer                                                              │
╰─────────────────────────────────────────────────────────────────────╯

To configure logging in your Node.js microservices, you should...

[Detailed answer with code examples]

╭─────────────────────────────────────────────────────────────────────╮
│ Sources                                                             │
╰─────────────────────────────────────────────────────────────────────╯

• project-docs: guides/logging.md → "Configuration"
• team-standards: observability/logging-standards.md

Confidence: high
```

### Interactive Mode

Start a conversation with follow-up questions:

```bash
ctxpkg chat -i
```

```
╭─────────────────────────────────────────────────────────────────────╮
│ ctxpkg Chat                                                         │
│ Type your questions. Commands: /help, /use-case, /clear, /verbose   │
╰─────────────────────────────────────────────────────────────────────╯

What are you trying to accomplish?
→ Building a React app with authentication

Use case: Building a React app with authentication

You: How do I set up OAuth?

ℹ Searching...

To set up OAuth in your React app, you'll need to...

Sources:
  • react-docs: authentication/oauth.md → "Setup Guide"

You: What about refresh tokens?

ℹ Searching...

For refresh token handling, the recommended approach is...
```

### Interactive Commands

| Command | Description |
|---------|-------------|
| `/help`, `/h` | Show available commands |
| `/use-case`, `/u` | View or change use case (clears history) |
| `/clear`, `/c` | Clear conversation history |
| `/verbose`, `/v` | Toggle verbose mode |
| `/quit`, `/q` | Exit chat |

### CLI Options

```bash
ctxpkg chat [query] [options]

Options:
  -i, --interactive           Start interactive chat session
  -u, --use-case <text>       Context for why you need this information
  -c, --collections <names>   Limit to specific collections
  --no-global                 Exclude global collections
  --model <model>             Override LLM model from config
  --verbose                   Show agent reasoning steps
```

### Verbose Mode

See what the agent is doing behind the scenes:

```bash
ctxpkg chat "How do caching work?" -u "Optimizing API performance" --verbose
```

```
ℹ Searching documentation...

  [thinking] Starting search...
  [tool] documents_search
    Input: {"query":"caching strategies API","collections":["project-docs"]}
  [result] Found 5 results about caching patterns...
  [tool] documents_get_section
    Input: {"collection":"project-docs","document":"performance/caching.md","section":"Redis Setup"}
  [result] ## Redis Setup\n\nTo configure Redis caching...

╭─────────────────────────────────────────────────────────────────────╮
│ Answer                                                              │
╰─────────────────────────────────────────────────────────────────────╯

For optimizing API performance with caching...
```

## Agent Mode MCP Server

For AI editors, agent mode exposes a single `ask_documents` tool instead of the eight individual tools.

### Starting Agent Mode

```bash
# Start with all collections
ctxpkg mcp agent

# Limit to specific collections
ctxpkg mcp agent -c project-docs api-docs

# Exclude global collections
ctxpkg mcp agent --no-global

# Override model
ctxpkg mcp agent --model gpt-4o
```

### The `ask_documents` Tool

**Parameters:**

- `query` (required): The question to answer
- `use_case` (required): Why you need this information — helps determine when enough info is found

**Returns:**

```json
{
  "answer": "Synthesized answer with code examples...",
  "sources": [
    {
      "collection": "project-docs",
      "document": "guides/auth.md",
      "section": "OAuth Setup"
    }
  ],
  "confidence": "high",
  "note": "Optional note about limitations"
}
```

**Confidence levels:**

- `high`: Multiple sources agree or direct answer found
- `medium`: Relevant information but not comprehensive
- `low`: Extrapolating or tangentially related

### Editor Configuration

**Cursor** (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "ctxpkg-agent": {
      "command": "ctxpkg",
      "args": ["mcp", "agent"]
    }
  }
}
```

**Claude Desktop**:

```json
{
  "mcpServers": {
    "ctxpkg-agent": {
      "command": "ctxpkg",
      "args": ["mcp", "agent"]
    }
  }
}
```

### When to Use Agent Mode vs Documents Mode

| Use Agent Mode When | Use Documents Mode When |
|---------------------|------------------------|
| You want minimal context overhead | You need fine-grained control |
| Questions are self-contained | Multi-step research workflows |
| Token costs in parent agent matter | You want to see raw search results |
| You prefer synthesized answers | Agent needs to make its own decisions |

You can configure both and let users choose:

```json
{
  "mcpServers": {
    "ctxpkg-docs": {
      "command": "ctxpkg",
      "args": ["mcp", "documents"]
    },
    "ctxpkg-agent": {
      "command": "ctxpkg",
      "args": ["mcp", "agent"]
    }
  }
}
```

## LLM Configuration

### Available Settings

| Setting | Description | Default |
|---------|-------------|---------|
| `llm.provider` | OpenAI-compatible API base URL | `https://api.openai.com/v1` |
| `llm.model` | Model identifier | `gpt-4o-mini` |
| `llm.apiKey` | API key | (none) |
| `llm.temperature` | Response randomness (0-2) | `0` |
| `llm.maxTokens` | Max tokens per response | `4096` |

### Configuration Commands

```bash
# View current settings
ctxpkg config list

# Set values
ctxpkg config set llm.apiKey sk-...
ctxpkg config set llm.model gpt-4o
ctxpkg config set llm.provider https://api.openai.com/v1
ctxpkg config set llm.temperature 0
ctxpkg config set llm.maxTokens 4096
```

### Using Other Providers

Any OpenAI-compatible API works:

```bash
# Azure OpenAI
ctxpkg config set llm.provider https://your-resource.openai.azure.com
ctxpkg config set llm.model your-deployment-name

# Local LLM (e.g., Ollama with OpenAI compatibility)
ctxpkg config set llm.provider http://localhost:11434/v1
ctxpkg config set llm.model llama2

# Anthropic via proxy, Together AI, etc.
ctxpkg config set llm.provider https://api.together.xyz/v1
```

### Environment Variables

All settings can be overridden via environment variables:

```bash
export CTXPKG_LLM_API_KEY=sk-...
export CTXPKG_LLM_MODEL=gpt-4o
export CTXPKG_LLM_PROVIDER=https://api.openai.com/v1
export CTXPKG_LLM_TEMPERATURE=0
export CTXPKG_LLM_MAX_TOKENS=4096
```

## Error Handling & Reliability

### Automatic Retries

The agent automatically retries on transient errors:

- **Rate limits** (429): Backs off and retries
- **Server errors** (500, 502, 503, 504): Temporary failures
- **Network errors**: Connection resets, timeouts

Retry behavior:
- Maximum 3 retry attempts
- Exponential backoff: 1s → 2s → 4s
- Maximum delay: 30 seconds

In verbose mode, you'll see retry attempts:

```
  [retry] Retry attempt 1 after error: rate limit exceeded. Waiting 1000ms...
```

### Common Errors

**"LLM API key not configured"**

```bash
ctxpkg config set llm.apiKey sk-...
# or
export CTXPKG_LLM_API_KEY=sk-...
```

**"No document collections found"**

```bash
ctxpkg col list    # Check collections
ctxpkg col sync    # Sync if needed
```

**Poor answer quality**

- Provide a more specific use case
- Ensure relevant documentation is indexed
- Try a more capable model (`gpt-4o` vs `gpt-4o-mini`)

## Alternative: Subagent Delegation

Some AI tools (Claude Code, OpenCode, etc.) support subagent delegation where a parent agent can spawn a child agent for focused tasks. This achieves similar token savings without requiring agent mode.

If your tool supports subagents, you might prefer the standard `ctxpkg mcp documents` server and let the parent agent delegate documentation research to a subagent.

Agent mode provides a **tool-agnostic solution** that works with any MCP-compatible client, regardless of whether it supports subagents.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     AI Editor / Parent Agent                        │
│              (Cursor, Claude Desktop, Claude Code)                  │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ Single tool call: ask_documents
                                │ (query + use_case)
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Agent Mode MCP Server                          │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                 Internal LangChain Agent                      │  │
│  │                                                               │  │
│  │  Tools available to internal agent:                           │  │
│  │  • documents_search        • documents_get_document           │  │
│  │  • documents_list_documents • documents_get_section           │  │
│  │  • documents_get_outline   • documents_search_batch           │  │
│  │  • documents_find_related  • documents_list_collections       │  │
│  │                                                               │  │
│  │  The internal agent:                                          │  │
│  │  1. Searches for relevant content                             │  │
│  │  2. Retrieves specific sections as needed                     │  │
│  │  3. Synthesizes findings into a single answer                 │  │
│  │  4. Returns only the final answer + sources                   │  │
│  └───────────────────────────────────────────────────────────────┘  │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                    Synthesized answer only
                    (no intermediate tool calls)
```

## See Also

- [MCP Server Documentation](mcp-server.md) — Standard document tools mode
- [Configuration](configuration.md) — Full configuration reference
- [CLI Reference](cli-reference.md) — Complete command documentation
