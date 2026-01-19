import { AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { ChatOpenAI } from '@langchain/openai';

import type {
  AgentResponse,
  AgentStep,
  AgentStepCallback,
  AskOptions,
  DocumentAgentOptions,
  LLMConfig,
  RetryConfig,
} from './agent.types.js';
import { AGENT_SYSTEM_PROMPT, formatCollectionRestriction, formatUserPrompt } from './agent.prompts.js';

import type { BackendClient } from '#root/client/client.js';
import { createDocumentToolDefinitions } from '#root/tools/documents/documents.js';
import { toLangchainTools } from '#root/tools/tools.langchain.js';

/** Default retry configuration */
const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

/**
 * Sleep for a given number of milliseconds
 */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Check if an error is retryable (rate limit, temporary failure, etc.)
 */
const isRetryableError = (error: unknown): boolean => {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    // Rate limit errors
    if (message.includes('rate limit') || message.includes('429') || message.includes('too many requests')) {
      return true;
    }
    // Temporary server errors
    if (message.includes('500') || message.includes('502') || message.includes('503') || message.includes('504')) {
      return true;
    }
    // Network errors
    if (message.includes('econnreset') || message.includes('etimedout') || message.includes('network')) {
      return true;
    }
  }
  return false;
};

/**
 * Execute a function with retry logic
 */
const withRetry = async <T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  onRetry?: (attempt: number, error: Error, delayMs: number) => void,
): Promise<T> => {
  let lastError: Error | undefined;
  let delayMs = config.initialDelayMs;

  for (let attempt = 1; attempt <= config.maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry non-retryable errors or on last attempt
      if (!isRetryableError(error) || attempt > config.maxRetries) {
        throw lastError;
      }

      // Notify about retry
      if (onRetry) {
        onRetry(attempt, lastError, delayMs);
      }

      // Wait before retrying
      await sleep(delayMs);

      // Exponential backoff
      delayMs = Math.min(delayMs * config.backoffMultiplier, config.maxDelayMs);
    }
  }

  throw lastError;
};

/**
 * Document search agent that uses LangChain tools to find and synthesize information.
 */
class DocumentAgent {
  #agent: ReturnType<typeof createReactAgent>;
  #maxIterations: number;
  #onStep?: AgentStepCallback;
  #collections?: string[];
  #conversationHistory: BaseMessage[];
  #systemPrompt: string;

  constructor(options: DocumentAgentOptions) {
    const { llmConfig, tools, maxIterations = 15, onStep, collections } = options;

    const llm = new ChatOpenAI({
      configuration: {
        baseURL: llmConfig.provider,
      },
      modelName: llmConfig.model,
      apiKey: llmConfig.apiKey,
      temperature: llmConfig.temperature,
      maxTokens: llmConfig.maxTokens,
    });

    this.#agent = createReactAgent({
      llm,
      tools,
    });

    this.#maxIterations = maxIterations;
    this.#onStep = onStep;
    this.#collections = collections;
    this.#conversationHistory = [];

    // Build system prompt with collection restriction if needed
    this.#systemPrompt = AGENT_SYSTEM_PROMPT;
    if (collections && collections.length > 0) {
      this.#systemPrompt += formatCollectionRestriction(collections);
    }
  }

  /**
   * Set the step callback for verbose mode
   */
  setOnStep(callback: AgentStepCallback | undefined): void {
    this.#onStep = callback;
  }

  /**
   * Clear conversation history for a fresh start
   */
  clearHistory(): void {
    this.#conversationHistory = [];
  }

  /**
   * Get current conversation history length
   */
  getHistoryLength(): number {
    return this.#conversationHistory.length;
  }

  /**
   * Ask a question and get a synthesized answer (stateless - doesn't use conversation history).
   */
  async ask(query: string, useCase: string, options?: AskOptions): Promise<AgentResponse> {
    const onStep = options?.onStep ?? this.#onStep;
    const userPrompt = formatUserPrompt(query, useCase, this.#collections);

    const messages: BaseMessage[] = [new SystemMessage(this.#systemPrompt), new HumanMessage(userPrompt)];

    return this.#runAgent(messages, onStep);
  }

  /**
   * Chat with conversation history (stateful - maintains context across calls).
   */
  async chat(message: string, useCase: string, options?: AskOptions): Promise<AgentResponse> {
    const onStep = options?.onStep ?? this.#onStep;

    // Add user message to history
    const userMessage = new HumanMessage(formatUserPrompt(message, useCase, this.#collections));
    this.#conversationHistory.push(userMessage);

    // Build full message list with system prompt
    const messages: BaseMessage[] = [new SystemMessage(this.#systemPrompt), ...this.#conversationHistory];

    const response = await this.#runAgent(messages, onStep);

    // Add assistant response to history
    this.#conversationHistory.push(new AIMessage(JSON.stringify(response)));

    return response;
  }

  /**
   * Run the agent with retry logic and step callbacks
   */
  async #runAgent(messages: BaseMessage[], onStep?: AgentStepCallback): Promise<AgentResponse> {
    // Notify about starting
    if (onStep) {
      onStep({ type: 'thinking', content: 'Starting search...' });
    }

    const result = await withRetry(
      async () => {
        return this.#agent.invoke(
          { messages },
          {
            recursionLimit: this.#maxIterations,
          },
        );
      },
      DEFAULT_RETRY_CONFIG,
      (attempt, error, delayMs) => {
        if (onStep) {
          onStep({
            type: 'error',
            content: `Retry attempt ${attempt} after error: ${error.message}. Waiting ${delayMs}ms...`,
          });
        }
      },
    );

    // Process messages for verbose output
    if (onStep) {
      this.#processMessagesForVerbose(result.messages, onStep);
    }

    // Extract the final message content
    const resultMessages = result.messages;
    const lastMessage = resultMessages[resultMessages.length - 1];
    const content = typeof lastMessage.content === 'string' ? lastMessage.content : JSON.stringify(lastMessage.content);

    // Try to parse as JSON response
    return this.#parseResponse(content);
  }

  /**
   * Process agent messages and emit verbose step callbacks
   */
  #processMessagesForVerbose(messages: BaseMessage[], onStep: AgentStepCallback): void {
    for (const message of messages) {
      if (message instanceof AIMessage) {
        // Check for tool calls
        const toolCalls = message.tool_calls;
        if (toolCalls && toolCalls.length > 0) {
          for (const toolCall of toolCalls) {
            const step: AgentStep = {
              type: 'tool_call',
              content: `Calling ${toolCall.name}`,
              toolName: toolCall.name,
              toolInput: toolCall.args as Record<string, unknown>,
            };
            onStep(step);
          }
        } else if (message.content) {
          // Regular AI message (thinking or final answer)
          const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
          if (content.trim()) {
            onStep({ type: 'thinking', content: content.slice(0, 200) + (content.length > 200 ? '...' : '') });
          }
        }
      } else if (message instanceof ToolMessage) {
        // Tool result
        const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
        const preview = content.slice(0, 150) + (content.length > 150 ? '...' : '');
        onStep({
          type: 'tool_result',
          content: preview,
          toolName: message.name,
        });
      }
    }
  }

  /**
   * Parse the agent's response, extracting JSON if present.
   */
  #parseResponse(content: string): AgentResponse {
    // Try to find JSON in the response
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        return {
          answer: parsed.answer ?? content,
          sources: parsed.sources ?? [],
          confidence: parsed.confidence ?? 'medium',
          note: parsed.note,
        };
      } catch {
        // Fall through to default
      }
    }

    // Try to parse the whole content as JSON
    try {
      const parsed = JSON.parse(content);
      if (parsed.answer) {
        return {
          answer: parsed.answer,
          sources: parsed.sources ?? [],
          confidence: parsed.confidence ?? 'medium',
          note: parsed.note,
        };
      }
    } catch {
      // Fall through to default
    }

    // Default: treat the whole content as the answer
    return {
      answer: content,
      sources: [],
      confidence: 'medium',
    };
  }
}

/**
 * Options for creating a document agent
 */
type CreateDocumentAgentOptions = {
  /** Backend client for API calls */
  client: BackendClient;
  /** LLM configuration */
  llmConfig: LLMConfig;
  /** Optional map of alias names to collection IDs */
  aliasMap?: Map<string, string>;
  /** Maximum agent iterations */
  maxIterations?: number;
  /** Callback for verbose mode */
  onStep?: AgentStepCallback;
  /** Collections to restrict searches to */
  collections?: string[];
};

/**
 * Create a document search agent.
 */
const createDocumentAgent = (options: CreateDocumentAgentOptions): DocumentAgent => {
  const { client, llmConfig, aliasMap, maxIterations, onStep, collections } = options;

  // Create document tool definitions and convert to LangChain tools
  const toolDefinitions = createDocumentToolDefinitions({ client, aliasMap });
  const langchainTools = toLangchainTools(toolDefinitions);
  const tools = Object.values(langchainTools);

  return new DocumentAgent({
    llmConfig,
    tools,
    maxIterations,
    onStep,
    collections,
  });
};

/**
 * Get LLM config from the application config.
 */
const getLLMConfigFromAppConfig = async (): Promise<LLMConfig> => {
  const { config } = await import('#root/config/config.js');

  // Use type assertion for dynamic config access
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = config as any;

  return {
    provider: c.get('llm.provider'),
    model: c.get('llm.model'),
    apiKey: c.get('llm.apiKey'),
    temperature: c.get('llm.temperature'),
    maxTokens: c.get('llm.maxTokens'),
  };
};

export { DocumentAgent, createDocumentAgent, getLLMConfigFromAppConfig, withRetry, isRetryableError };
export type { CreateDocumentAgentOptions };
