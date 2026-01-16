import * as z from 'zod';

/**
 * LLM configuration for the agent
 */
export type LLMConfig = {
  /** OpenAI-compatible API base URL */
  provider: string;
  /** Model identifier */
  model: string;
  /** API key */
  apiKey: string;
  /** Temperature (0-2) */
  temperature: number;
  /** Maximum tokens */
  maxTokens: number;
};

/**
 * Source reference for an answer
 */
export const sourceSchema = z.object({
  collection: z.string(),
  document: z.string(),
  section: z.string().optional(),
});

export type Source = z.infer<typeof sourceSchema>;

/**
 * Agent response
 */
export const agentResponseSchema = z.object({
  answer: z.string(),
  sources: z.array(sourceSchema),
  confidence: z.enum(['high', 'medium', 'low']),
  note: z.string().optional(),
});

export type AgentResponse = z.infer<typeof agentResponseSchema>;

/**
 * Callback for verbose mode - called when agent takes a step
 */
export type AgentStepCallback = (step: AgentStep) => void;

/**
 * Represents a step in the agent's reasoning
 */
export type AgentStep = {
  type: 'thinking' | 'tool_call' | 'tool_result' | 'error';
  content: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
};

/**
 * Options for creating a document agent
 */
export type DocumentAgentOptions = {
  /** LLM configuration */
  llmConfig: LLMConfig;
  /** LangChain tools to use */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: any[];
  /** Maximum iterations before stopping */
  maxIterations?: number;
  /** Callback for verbose mode */
  onStep?: AgentStepCallback;
  /** Collections to restrict searches to (instruction in system prompt) */
  collections?: string[];
};

/**
 * Options for asking a question
 */
export type AskOptions = {
  /** Callback for verbose mode */
  onStep?: AgentStepCallback;
};

/**
 * Retry configuration for LLM calls
 */
export type RetryConfig = {
  /** Maximum number of retry attempts */
  maxRetries: number;
  /** Initial delay in ms */
  initialDelayMs: number;
  /** Maximum delay in ms */
  maxDelayMs: number;
  /** Multiplier for exponential backoff */
  backoffMultiplier: number;
};
