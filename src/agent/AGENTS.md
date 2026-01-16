# Agent — Agent Guidelines

This document describes the agent module architecture for AI agents working on this codebase.

## Overview

The agent module provides a LangChain-based agent that uses document tools to search and synthesize information. It's designed to reduce token/context costs by consolidating multiple tool calls into a single, synthesized answer.

## File Structure

| File | Purpose |
|------|---------|
| `agent.ts` | Main agent implementation, factory, and retry logic |
| `agent.types.ts` | TypeScript types and Zod schemas |
| `agent.prompts.ts` | System prompts and templates |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        DocumentAgent                                │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    LangGraph React Agent                      │  │
│  │                                                               │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐   │  │
│  │  │   search    │  │ get_section │  │ get_document, etc.  │   │  │
│  │  └─────────────┘  └─────────────┘  └─────────────────────┘   │  │
│  │                                                               │  │
│  │  Uses configured LLM (OpenAI-compatible API)                  │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  Features:                                                          │
│  • Verbose mode with step callbacks                                 │
│  • Conversation history for multi-turn chat                         │
│  • Collection filtering via system prompt                           │
│  • Retry logic with exponential backoff                             │
└─────────────────────────────────────────────────────────────────────┘
```

## Usage

### Creating an Agent

```typescript
import { createDocumentAgent, getLLMConfigFromAppConfig } from '#root/agent/agent.ts';
import { createClient } from '#root/client/client.ts';

const client = await createClient({ mode: 'daemon' });
const llmConfig = await getLLMConfigFromAppConfig();

const agent = createDocumentAgent({
  client,
  llmConfig,
  aliasMap: new Map([['docs', 'pkg:file://./docs/manifest.json']]),
  collections: ['docs'],  // Optional: restrict to specific collections
  onStep: (step) => console.log(step),  // Optional: verbose callbacks
});

// One-shot query (stateless)
const response = await agent.ask(
  'How do I implement streaming?',
  'Building a chatbot that streams responses'
);

console.log(response.answer);
console.log(response.sources);
console.log(response.confidence);
```

### Multi-turn Conversation

```typescript
// First message
const response1 = await agent.chat(
  'What authentication methods are available?',
  'Building a secure API'
);

// Follow-up (maintains conversation context)
const response2 = await agent.chat(
  'How do I implement the OAuth2 option?',
  'Building a secure API'
);

// Clear history when starting new topic
agent.clearHistory();
```

### Verbose Mode

```typescript
const agent = createDocumentAgent({
  client,
  llmConfig,
  onStep: (step) => {
    switch (step.type) {
      case 'thinking':
        console.log(`[thinking] ${step.content}`);
        break;
      case 'tool_call':
        console.log(`[tool] ${step.toolName}`);
        console.log(`  Input: ${JSON.stringify(step.toolInput)}`);
        break;
      case 'tool_result':
        console.log(`[result] ${step.content}`);
        break;
      case 'error':
        console.log(`[retry] ${step.content}`);
        break;
    }
  },
});
```

### Agent Response Format

```typescript
type AgentResponse = {
  answer: string;           // Synthesized answer
  sources: Array<{          // References used
    collection: string;
    document: string;
    section?: string;
  }>;
  confidence: 'high' | 'medium' | 'low';
  note?: string;            // Optional note
};
```

## LLM Configuration

The agent uses configuration from `config.ts`:

```typescript
llm: {
  provider: string;    // OpenAI-compatible API base URL
  model: string;       // Model identifier
  apiKey: string;      // API key
  temperature: number; // 0-2
  maxTokens: number;   // Max response tokens
}
```

Configure via CLI:

```bash
ctxpkg config set llm.apiKey sk-...
ctxpkg config set llm.model gpt-4o
ctxpkg config set llm.provider https://api.openai.com/v1
```

Or via environment variables:

```bash
export CTXPKG_LLM_API_KEY=sk-...
export CTXPKG_LLM_MODEL=gpt-4o
```

## Agent Design

### Tool Selection

The agent uses LangGraph's React agent pattern with these tools:

- `documents_search` — Semantic search across collections
- `documents_list_documents` — Browse collection contents
- `documents_get_outline` — Get document structure
- `documents_get_section` — Get specific sections
- `documents_get_document` — Get full documents
- `documents_list_collections` — List available collections
- `documents_search_batch` — Batch searches
- `documents_find_related` — Find related content

### Termination

The agent stops when:

1. It has synthesized a complete answer (JSON response)
2. Maximum iterations reached (default: 15)
3. No more relevant information to find

### Response Parsing

The agent is prompted to respond in JSON format. The parser:

1. Looks for ```json code blocks
2. Tries to parse the whole content as JSON
3. Falls back to treating content as plain answer

### Retry Logic

The agent automatically retries on transient errors:

- **Rate limits**: 429 errors
- **Server errors**: 500, 502, 503, 504
- **Network errors**: ECONNRESET, ETIMEDOUT

Retry configuration:
- Max retries: 3
- Initial delay: 1000ms
- Max delay: 30000ms
- Backoff multiplier: 2x

```typescript
import { withRetry, isRetryableError } from '#root/agent/agent.ts';

// Use retry logic for custom async operations
const result = await withRetry(
  () => someAsyncOperation(),
  { maxRetries: 3, initialDelayMs: 1000, maxDelayMs: 30000, backoffMultiplier: 2 },
  (attempt, error, delayMs) => console.log(`Retry ${attempt}: ${error.message}`)
);
```

## Key Patterns

### Lazy Config Loading

Config is loaded dynamically to avoid circular imports:

```typescript
const getLLMConfigFromAppConfig = async (): Promise<LLMConfig> => {
  const { config } = await import('#root/config/config.ts');
  // ...
};
```

### Tool Conversion

Document tools are defined once and converted for LangChain:

```typescript
const toolDefinitions = createDocumentToolDefinitions({ client, aliasMap });
const langchainTools = toLangchainTools(toolDefinitions);
```

### Collection Filtering

Collections can be restricted via the `collections` option:

```typescript
const agent = createDocumentAgent({
  client,
  llmConfig,
  collections: ['my-docs', 'api-docs'],  // Only search these
});
```

This adds instructions to the system prompt telling the agent to pass these collections in all search calls.
