# Agent Mode Specification

This document specifies an "agent mode" for the MCP server and a new `ctxpkg chat` CLI command. The goal is to reduce token/context costs when using ctxpkg with AI assistants by consolidating multiple tool calls into a single, precise answer.

## Problem Statement

The current MCP server exposes multiple document tools (`documents_search`, `documents_get_document`, `documents_get_section`, etc.). When an AI agent uses these tools:

1. **Tool call accumulation**: Each search, retrieval, and follow-up becomes part of the conversation context
2. **Token overhead**: All intermediate tool calls remain in context for subsequent turns, even though only the final answer matters
3. **Compounding costs**: A question requiring 3-4 tool calls carries that overhead for the entire conversation

This is a common issue with MCPs — the agent arrives at the correct answer, but the path to get there (tool calls, intermediate results) inflates context permanently.

### Alternative Approaches

Some tools (Claude Code, OpenCode, etc.) support subagent delegation where a parent agent can spawn a child agent for focused tasks. This achieves similar token savings but requires tool-specific support. The agent mode proposed here provides a **tool-agnostic solution** that works with any MCP-compatible client.

## Goals

1. **Minimize context impact**: Expose a single tool that returns only the synthesized answer
2. **Preserve functionality**: The internal agent has full access to all document tools
3. **Require intent clarity**: Both query AND use case must be specified to guide the agent
4. **Support CLI usage**: Provide interactive and one-shot chat modes via CLI
5. **Configurable LLM**: Allow users to configure their preferred OpenAI-compatible provider

## Architecture

### Agent Mode MCP Server

```
┌─────────────────────────────────────────────────────────────────────┐
│                     AI Editor / Parent Agent                        │
│              (Cursor, Claude Desktop, Claude Code, etc.)            │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ Single tool call
                                │ (query + use_case)
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Agent Mode MCP Server                          │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    ask_documents Tool                         │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                │                                    │
│  ┌─────────────────────────────▼─────────────────────────────────┐  │
│  │              Internal LangChain Agent                         │  │
│  │                                                               │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐   │  │
│  │  │   search    │  │ get_section │  │ get_document, etc.  │   │  │
│  │  └─────────────┘  └─────────────┘  └─────────────────────┘   │  │
│  │                                                               │  │
│  │  Uses configured LLM (OpenAI-compatible API)                  │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                │                                    │
│                    Synthesized answer only                          │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │
                                  ▼
                        Single response to parent
```

### CLI Chat Command

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ctxpkg chat                                 │
│                                                                     │
│  One-shot:      ctxpkg chat "How do I configure X?" --use-case "..."│
│  Interactive:   ctxpkg chat -i                                      │
└───────────────────────────────────┬─────────────────────────────────┘
                                    │
                                    ▼
                        Same internal agent
```

## Configuration

### New Config Options

Add to `src/config/config.ts`:

```typescript
const config = convict({
  // ... existing config ...
  
  llm: {
    provider: {
      doc: 'OpenAI-compatible API base URL',
      format: String,
      default: 'https://api.openai.com/v1',
      env: 'CTXPKG_LLM_PROVIDER',
    },
    model: {
      doc: 'Model identifier to use for agent reasoning',
      format: String,
      default: 'gpt-4o-mini',
      env: 'CTXPKG_LLM_MODEL',
    },
    apiKey: {
      doc: 'API key for the LLM provider',
      format: String,
      default: '',
      env: 'CTXPKG_LLM_API_KEY',
      sensitive: true,
    },
    temperature: {
      doc: 'Temperature for LLM responses (0-2)',
      format: Number,
      default: 0,
      env: 'CTXPKG_LLM_TEMPERATURE',
    },
    maxTokens: {
      doc: 'Maximum tokens for LLM responses',
      format: 'nat',
      default: 4096,
      env: 'CTXPKG_LLM_MAX_TOKENS',
    },
  },
});
```

### Configuration Commands

```bash
# Set provider (OpenAI, Azure, local LLM, etc.)
ctxpkg config set llm.provider https://api.openai.com/v1

# Set model
ctxpkg config set llm.model gpt-4o

# Set API key (sensitive - consider using env var instead)
ctxpkg config set llm.apiKey sk-...

# Or use environment variables
export CTXPKG_LLM_API_KEY=sk-...
export CTXPKG_LLM_MODEL=gpt-4o
```

## MCP Agent Mode

### Command

```bash
# Start agent mode MCP server
ctxpkg mcp agent

# With collection filtering
ctxpkg mcp agent -c langchain-docs react-docs

# Exclude global collections
ctxpkg mcp agent --no-global
```

### Single Exposed Tool: `ask_documents`

**Purpose**: Answer questions about documentation using an internal agent that searches and synthesizes information. Returns only the final answer, not intermediate search results.

**Schema**:
```typescript
{
  query: z.string().describe(
    'The question to answer. Be specific about what information you need.'
  ),
  use_case: z.string().describe(
    'Why you need this information and how it will be used. ' +
    'This helps the agent determine when it has found sufficient information. ' +
    'Example: "I need to understand authentication flow to implement login in my app"'
  ),
  collections: z.array(z.string()).optional().describe(
    'Limit search to specific collections. If not provided, searches all available collections.'
  ),
}
```

**Return**:
```typescript
{
  answer: string;           // Synthesized answer addressing the query
  sources: Array<{          // References used to construct the answer
    collection: string;
    document: string;
    section?: string;       // Section heading if applicable
  }>;
  confidence: 'high' | 'medium' | 'low';  // Agent's confidence in the answer
  note?: string;            // Optional note about limitations or suggestions
}
```

**Example Interaction**:

```json
// Tool call from parent agent
{
  "tool": "ask_documents",
  "arguments": {
    "query": "How do I implement streaming responses with LangChain?",
    "use_case": "I'm building a chatbot and need to stream tokens to the UI as they're generated"
  }
}

// Response (only this goes back to parent)
{
  "answer": "To implement streaming with LangChain, use the `stream()` method on your model...\n\n```typescript\nconst stream = await model.stream(messages);\nfor await (const chunk of stream) {\n  // Process each token\n}\n```\n\nFor UI integration, LangChain provides callback handlers...",
  "sources": [
    { "collection": "langchain", "document": "streaming.md", "section": "Basic Streaming" },
    { "collection": "langchain", "document": "callbacks.md", "section": "Streaming Callbacks" }
  ],
  "confidence": "high"
}
```

### Internal Agent Design

The internal agent uses LangChain's tool-calling agent with access to all document tools:

```typescript
// Conceptual implementation
const createDocumentAgent = (options: AgentOptions) => {
  const { client, aliasMap, llmConfig } = options;
  
  // Create LLM instance
  const llm = new ChatOpenAI({
    configuration: { baseURL: llmConfig.provider },
    modelName: llmConfig.model,
    apiKey: llmConfig.apiKey,
    temperature: llmConfig.temperature,
    maxTokens: llmConfig.maxTokens,
  });
  
  // Get all document tools
  const toolDefinitions = createDocumentToolDefinitions({ client, aliasMap });
  const tools = toLangchainTools(toolDefinitions);
  
  // Create agent with system prompt emphasizing efficiency
  const agent = createToolCallingAgent({
    llm,
    tools: Object.values(tools),
    prompt: AGENT_SYSTEM_PROMPT,
  });
  
  return new AgentExecutor({ agent, tools: Object.values(tools) });
};
```

### Agent System Prompt

```
You are a documentation search agent. Your task is to find and synthesize information 
from technical documentation to answer user questions.

## Guidelines

1. **Start broad, then narrow**: Begin with a semantic search, then drill into specific 
   sections or documents as needed.

2. **Use the right tool for the job**:
   - `documents_search` — Find relevant content across collections
   - `documents_list_documents` — Browse what's available in a collection
   - `documents_get_outline` — Understand document structure before diving in
   - `documents_get_section` — Get specific section content efficiently
   - `documents_get_document` — Only when you need the full document

3. **Stop when sufficient**: The user has provided a use case. Once you have enough 
   information to address their specific use case, synthesize and respond. Don't 
   over-research.

4. **Cite sources**: Track which documents/sections you used. The user needs references.

5. **Acknowledge uncertainty**: If you can't find sufficient information, say so. 
   Suggest what additional documentation might help.

## Response Format

Provide a clear, actionable answer that directly addresses the query and use case.
Include code examples when relevant. Keep the response focused and practical.
```

### Agent Termination Conditions

The agent should stop searching when:

1. **Direct answer found**: A search result or document section directly answers the query
2. **Sufficient coverage**: Multiple sources converge on the same answer
3. **Use case satisfied**: Enough information exists to address the stated use case
4. **Max iterations**: Safety limit (default: 10 tool calls)
5. **No more leads**: Searches return no relevant results

## CLI Chat Command

### Command Structure

```bash
ctxpkg chat [query] [options]
```

### Options

| Option | Description |
|--------|-------------|
| `-i, --interactive` | Start interactive chat session |
| `-u, --use-case <text>` | Use case context (required for one-shot, prompted in interactive) |
| `-c, --collections <names...>` | Limit to specific collections |
| `--no-global` | Exclude global collections |
| `--model <model>` | Override configured model |
| `--temperature <n>` | Override configured temperature |
| `--verbose` | Show agent reasoning steps |

### One-Shot Mode

```bash
# Simple question (will prompt for use case)
ctxpkg chat "How do I configure authentication?"

# With use case
ctxpkg chat "How do I configure authentication?" \
  --use-case "Implementing OAuth2 login in my Express app"

# Filtered to specific collections
ctxpkg chat "What are the best practices for error handling?" \
  -c langchain-docs \
  --use-case "Building production-ready chatbot"
```

Output format:
```
╭─────────────────────────────────────────────────────────────────────╮
│ Answer                                                              │
╰─────────────────────────────────────────────────────────────────────╯

To configure authentication with OAuth2 in Express...

[Code examples, explanations, etc.]

╭─────────────────────────────────────────────────────────────────────╮
│ Sources                                                             │
╰─────────────────────────────────────────────────────────────────────╯

• langchain-docs: authentication/oauth.md → "OAuth2 Setup"
• langchain-docs: middleware/auth.md → "Express Integration"

Confidence: high
```

### Interactive Mode

```bash
ctxpkg chat -i
```

```
╭─────────────────────────────────────────────────────────────────────╮
│ ctxpkg Chat                                                         │
│ Type your questions. Use /help for commands. Ctrl+C to exit.        │
╰─────────────────────────────────────────────────────────────────────╯

Use case: Building a RAG application with LangChain

You: How do I implement document chunking?

[Agent searches and responds...]

You: What about overlapping chunks?

[Agent searches with conversation context...]

You: /collections
Active collections: langchain-docs, chroma-docs

You: /use-case
Current: Building a RAG application with LangChain
New use case: [enter new use case or press enter to keep]

You: /quit
```

### Interactive Commands

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/collections` | List active collections |
| `/use-case` | View or change use case |
| `/clear` | Clear conversation history |
| `/verbose` | Toggle verbose mode |
| `/quit` or `/exit` | Exit chat |

## Implementation Plan

### Phase 1: Configuration

1. **Add LLM config to convict schema**
   - `llm.provider` — Base URL
   - `llm.model` — Model name
   - `llm.apiKey` — API key
   - `llm.temperature` — Temperature
   - `llm.maxTokens` — Max tokens

2. **Add config validation**
   - Validate URL format for provider
   - Warn if apiKey not set when using agent features

### Phase 2: Agent Core

1. **Create `src/agent/` module**

   ```
   src/agent/
   ├── AGENTS.md           # Module documentation
   ├── agent.ts            # Main agent implementation
   ├── agent.prompts.ts    # System prompts and templates
   ├── agent.schemas.ts    # Zod schemas for agent I/O
   └── agent.types.ts      # TypeScript types
   ```

2. **Implement `DocumentAgent` class**

   ```typescript
   class DocumentAgent {
     #executor: AgentExecutor;
     #tools: ToolDefinitions;
     
     constructor(options: DocumentAgentOptions);
     
     async ask(query: string, useCase: string): Promise<AgentResponse>;
     
     // For interactive mode - maintains conversation
     async chat(message: string): Promise<AgentResponse>;
     clearHistory(): void;
   }
   ```

3. **Create agent factory function**

   ```typescript
   const createDocumentAgent = async (options: {
     client: BackendClient;
     aliasMap?: Map<string, string>;
     collections?: string[];
     llmConfig?: Partial<LLMConfig>;
   }): Promise<DocumentAgent>;
   ```

### Phase 3: MCP Agent Mode

1. **Create `ask_documents` tool definition**

   ```typescript
   // src/tools/agent/agent.ts
   const createAgentToolDefinitions = (options: AgentToolOptions): ToolDefinitions => {
     const { agent, aliasMap } = options;
     
     const askDocuments = defineTool({
       name: 'ask_documents',
       description: '...',
       schema: askDocumentsSchema,
       handler: async ({ query, use_case, collections }) => {
         return agent.ask(query, use_case, { collections });
       },
     });
     
     return { askDocuments };
   };
   ```

2. **Create agent MCP server factory**

   ```typescript
   // src/mcp/mcp.ts
   const createAgentMcpServer = async (options: AgentMcpServerOptions) => {
     const { client, aliasMap, llmConfig, name = 'ctxpkg-agent' } = options;
     
     const agent = await createDocumentAgent({ client, aliasMap, llmConfig });
     const server = new McpServer({ name, version: '1.0.0' });
     
     const tools = createAgentToolDefinitions({ agent, aliasMap });
     registerMcpTools(server, tools);
     
     return server;
   };
   ```

3. **Add CLI command**

   ```typescript
   // src/cli/cli.mcp.ts
   command
     .command('agent')
     .description('Start an MCP server with agent mode (single ask_documents tool)')
     .option('-c, --collections <names...>', 'Limit to specific collections')
     .option('--no-global', 'Exclude global collections')
     .option('--model <model>', 'Override LLM model')
     .action(withErrorHandling(async (options) => {
       // Validate LLM config exists
       const llmConfig = getLLMConfig();
       if (!llmConfig.apiKey) {
         throw new Error('LLM API key not configured. Run: ctxpkg config set llm.apiKey <key>');
       }
       
       const client = await createCliClient();
       const server = await createAgentMcpServer({ client, llmConfig, ... });
       await runMcpServer(server);
     }));
   ```

### Phase 4: CLI Chat Command

1. **Create `src/cli/cli.chat.ts`**

   ```typescript
   const createChatCli = (command: Command) => {
     command.description('Chat with your documentation using AI');
     
     command
       .argument('[query]', 'Question to ask (starts one-shot mode)')
       .option('-i, --interactive', 'Start interactive chat session')
       .option('-u, --use-case <text>', 'Context for why you need this information')
       .option('-c, --collections <names...>', 'Limit to specific collections')
       .option('--no-global', 'Exclude global collections')
       .option('--model <model>', 'Override LLM model')
       .option('--verbose', 'Show agent reasoning')
       .action(withErrorHandling(async (query, options) => {
         if (options.interactive) {
           await runInteractiveChat(options);
         } else if (query) {
           await runOneShotChat(query, options);
         } else {
           // No query and not interactive - prompt for input
           await runInteractiveChat(options);
         }
       }));
   };
   ```

2. **Implement one-shot mode**

   ```typescript
   const runOneShotChat = async (query: string, options: ChatOptions) => {
     // Validate config
     const llmConfig = getLLMConfig();
     
     // Prompt for use case if not provided
     let useCase = options.useCase;
     if (!useCase) {
       useCase = await input({
         message: 'What is your use case? (helps find relevant information)',
       });
     }
     
     const client = await createCliClient();
     const agent = await createDocumentAgent({ client, llmConfig, ... });
     
     formatHeader('Searching...');
     const response = await agent.ask(query, useCase);
     
     formatHeader('Answer');
     console.log(response.answer);
     
     formatHeader('Sources');
     for (const source of response.sources) {
       console.log(`• ${source.collection}: ${source.document}`);
     }
     
     console.log(`\nConfidence: ${response.confidence}`);
   };
   ```

3. **Implement interactive mode**

   ```typescript
   const runInteractiveChat = async (options: ChatOptions) => {
     const client = await createCliClient();
     const agent = await createDocumentAgent({ client, ... });
     
     // Get initial use case
     const useCase = await input({
       message: 'What are you trying to accomplish?',
     });
     agent.setUseCase(useCase);
     
     formatHeader('ctxpkg Chat');
     console.log('Type your questions. Use /help for commands. Ctrl+C to exit.\n');
     
     while (true) {
       const message = await input({ message: 'You:' });
       
       if (message.startsWith('/')) {
         await handleCommand(message, agent);
         continue;
       }
       
       const response = await agent.chat(message);
       console.log('\n' + response.answer + '\n');
     }
   };
   ```

4. **Mount in CLI**

   ```typescript
   // src/cli/cli.ts
   import { createChatCli } from './cli.chat.ts';
   
   // In createProgram():
   createChatCli(program.command('chat'));
   ```

### Phase 5: Testing

1. **Unit tests**
   - Agent response formatting
   - Config validation
   - Prompt template rendering

2. **Integration tests**
   - Mock LLM responses
   - Test tool selection logic
   - Test termination conditions

3. **Manual testing**
   - Test with real LLM
   - Test MCP in Cursor/Claude Desktop
   - Test CLI chat modes

### Phase 6: Documentation

1. **Update README.md**
   - Add chat command documentation
   - Add agent MCP configuration example
   - Document LLM configuration options

2. **Update ARCHITECTURE.md**
   - Add agent module description
   - Document data flow

3. **Create `src/agent/AGENTS.md`**
   - Module overview
   - Agent design patterns
   - Prompt engineering guidelines

4. **Update `src/mcp/AGENTS.md`**
   - Add agent mode section
   - Document `ask_documents` tool

## File Changes Summary

### New Files

```
src/agent/
├── AGENTS.md
├── agent.ts
├── agent.prompts.ts
├── agent.schemas.ts
└── agent.types.ts

src/cli/cli.chat.ts

src/tools/agent/
└── agent.ts
```

### Modified Files

```
src/config/config.ts          # Add llm.* config options
src/cli/cli.ts                # Mount chat command
src/cli/cli.mcp.ts            # Add agent subcommand
src/mcp/mcp.ts                # Add createAgentMcpServer
src/mcp/AGENTS.md             # Document agent mode
README.md                     # Document new features
ARCHITECTURE.md               # Add agent module
```

## Security Considerations

1. **API Key Storage**
   - API key stored in user config file
   - Support environment variable override (`CTXPKG_LLM_API_KEY`)
   - Never log or display API keys

2. **Prompt Injection**
   - User queries are passed to LLM — standard prompt injection risks apply
   - Agent only has access to read-only document tools
   - No ability to modify files or execute code

3. **Token Limits**
   - Configurable max tokens prevents runaway costs
   - Max iterations limit on agent prevents infinite loops

## Performance Considerations

1. **Cold Start**
   - LLM client initialization adds latency
   - Consider lazy initialization in MCP server

2. **Token Usage**
   - Internal agent calls consume tokens
   - System prompt is ~500 tokens
   - Each tool call adds context
   - Target: answer most queries in 3-5 tool calls

3. **Caching**
   - Consider caching common queries (future enhancement)
   - Document tool results could be cached within a session

## Future Enhancements

Not in scope for initial implementation:

1. **Streaming responses**: Stream agent output as it generates
2. **Multi-turn memory**: Persist conversation across CLI sessions
3. **Custom prompts**: Allow users to customize agent behavior
4. **Cost tracking**: Track and display token usage
5. **Multiple agents**: Specialized agents for different tasks
6. **Hybrid mode**: MCP server with both agent tool and raw tools

## Testing Checklist

- [ ] LLM configuration saves and loads correctly
- [ ] Config validation catches missing API key
- [ ] Agent creates and initializes without error
- [ ] Agent searches documentation correctly
- [ ] Agent synthesizes answers appropriately
- [ ] Agent terminates after finding sufficient information
- [ ] Sources are tracked and returned
- [ ] Confidence scoring works
- [ ] MCP agent server starts correctly
- [ ] `ask_documents` tool works via MCP
- [ ] CLI one-shot mode works
- [ ] CLI interactive mode works
- [ ] Interactive commands work (/help, /clear, etc.)
- [ ] Collection filtering works
- [ ] Model override works
- [ ] Verbose mode shows reasoning
- [ ] Error handling works gracefully

---

## Implementation Status

**Implemented:**

- [x] LLM configuration in `config.ts` (`llm.provider`, `llm.model`, `llm.apiKey`, `llm.temperature`, `llm.maxTokens`)
- [x] Agent module (`src/agent/`) with `DocumentAgent` class
- [x] Agent tool definitions (`src/tools/agent/agent.ts`)
- [x] MCP agent server (`createAgentMcpServer` in `mcp.ts`)
- [x] CLI command: `ctxpkg mcp agent`
- [x] CLI command: `ctxpkg chat` (one-shot and interactive modes)
- [x] Module documentation (`src/agent/AGENTS.md`)
- [x] Verbose mode with step callbacks (shows tool calls, results, and retries)
- [x] Conversation history for multi-turn chat (`chat()` method)
- [x] Collection filtering via system prompt instructions
- [x] Error handling with retry logic (exponential backoff for rate limits, server errors)
- [x] Unit tests for agent module (`tests/agent.test.ts` - 22 tests)

**Features:**

1. **Verbose Mode**: Use `--verbose` flag or `/verbose` command in interactive mode to see:
   - Tool calls being made
   - Tool results (truncated preview)
   - Retry attempts with delays

2. **Conversation History**: 
   - `ask()` - Stateless, one-shot queries
   - `chat()` - Maintains conversation context across calls
   - `clearHistory()` - Reset conversation
   - `/clear` command in interactive mode

3. **Collection Filtering**:
   - Pass `-c collection1 collection2` to restrict searches
   - Agent system prompt instructs it to use only specified collections

4. **Retry Logic**:
   - Automatically retries on rate limits (429)
   - Retries on server errors (500, 502, 503, 504)
   - Retries on network errors (ECONNRESET, ETIMEDOUT)
   - Exponential backoff: 1s → 2s → 4s (max 30s)
   - Maximum 3 retries before failing

5. **Interactive Commands**:
   - `/help` - Show available commands
   - `/use-case` - View or change use case
   - `/clear` - Clear conversation history
   - `/verbose` - Toggle verbose mode
   - `/quit` - Exit chat

**Remaining Notes:**

1. **LangChain API**: The implementation uses `@langchain/langgraph`'s `createReactAgent`. If APIs change:
   - Verify import paths: `@langchain/langgraph/prebuilt`
   - Check `ChatOpenAI` configuration in `@langchain/openai`

2. **Response Parsing**: The agent is prompted to respond in JSON format. Parsing handles:
   - JSON in markdown code blocks
   - Raw JSON responses
   - Fallback to plain text
   
   Different models may format responses differently.

3. **Token Limits**: Long conversations may exceed context limits. Consider adding:
   - Automatic history truncation
   - Token counting before requests

**Dependencies Used:**

- `@langchain/openai` - ChatOpenAI model
- `@langchain/langgraph` - React agent from prebuilt module
- `@langchain/core` - Message types (HumanMessage, SystemMessage, AIMessage, ToolMessage)

All dependencies were already in `package.json`.
