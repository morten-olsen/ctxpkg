import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { parse as parseYaml } from 'yaml';

import { createDocumentAgent, getLLMConfigFromAppConfig } from './agent.ts';
import type { LLMConfig } from './agent.types.ts';
import {
  testSuiteSchema,
  type TestCase,
  type TestResult,
  type TestRunResult,
  type TestSuite,
  type ValidationMode,
} from './agent.test-runner.schemas.ts';

import type { BackendClient } from '#root/client/client.ts';
import { createClient } from '#root/client/client.ts';
import { EmbedderService } from '#root/embedder/embedder.ts';
import { Services, destroy } from '#root/utils/utils.services.ts';

/**
 * Callback for test progress updates
 */
type TestProgressCallback = (event: TestProgressEvent) => void;

type TestProgressEvent =
  | { type: 'suite_start'; suiteName: string; totalTests: number }
  | { type: 'sync_start' }
  | { type: 'sync_complete' }
  | { type: 'test_start'; testId: string; index: number }
  | { type: 'test_complete'; testId: string; result: TestResult }
  | { type: 'suite_complete'; result: TestRunResult };

/**
 * Options for running a test suite
 */
type TestRunnerOptions = {
  /** LLM configuration (defaults to app config) */
  llmConfig?: LLMConfig;
  /** Progress callback */
  onProgress?: TestProgressCallback;
  /** Override validation mode for all tests */
  validationMode?: ValidationMode;
  /** Override pass threshold for all tests */
  passThreshold?: number;
  /** Base directory for resolving relative URLs in the test file (defaults to test file's directory) */
  baseDir?: string;
};

/**
 * LLM validation prompt
 */
const LLM_VALIDATION_PROMPT = `You are evaluating an AI agent's answer against expected criteria.

## Expected Answer / Criteria
{expected}

## Actual Answer
{actual}

## Validation Instructions
{instructions}

## Task
Evaluate how well the actual answer meets the expected criteria. Consider:
- Does it address the key points?
- Is the information accurate (based on what was expected)?
- Is it appropriately detailed?

Respond with a JSON object:
\`\`\`json
{
  "score": <0.0 to 1.0>,
  "passed": <true if score >= threshold>,
  "reasoning": "<brief explanation of your evaluation>"
}
\`\`\``;

const DEFAULT_VALIDATION_INSTRUCTIONS = `Evaluate whether the actual answer adequately addresses the expected criteria. 
Focus on factual correctness and completeness rather than exact wording.`;

/**
 * Test runner service for validating agent performance
 */
class AgentTestRunner {
  #services: Services;
  #embedder: EmbedderService;

  constructor() {
    this.#services = new Services();
    this.#embedder = this.#services.get(EmbedderService);
  }

  /**
   * Compute collection ID from spec URL (mirrors CollectionsService.computeCollectionId)
   */
  #computeCollectionId(url: string): string {
    const normalizedUrl = url.replace(/\/+$/, '');
    return `pkg:${normalizedUrl}`;
  }

  /**
   * Load and parse a test suite from a YAML file
   */
  async loadTestSuite(filePath: string): Promise<{ suite: TestSuite; baseDir: string }> {
    const content = await readFile(filePath, 'utf-8');
    const parsed = parseYaml(content);
    const suite = testSuiteSchema.parse(parsed);
    const baseDir = dirname(resolve(filePath));
    return { suite, baseDir };
  }

  /**
   * Run a complete test suite
   */
  async runTestSuite(suite: TestSuite, options: TestRunnerOptions = {}): Promise<TestRunResult> {
    const { onProgress, llmConfig: providedLlmConfig, baseDir = process.cwd() } = options;
    const startedAt = new Date().toISOString();
    const startTime = Date.now();

    // Get LLM config
    const llmConfig = providedLlmConfig ?? (await getLLMConfigFromAppConfig());

    onProgress?.({ type: 'suite_start', suiteName: suite.name, totalTests: suite.tests.length });

    const results: TestResult[] = [];

    // Create client using direct mode (uses existing database)
    const client = await createClient({ mode: 'direct' });

    try {
      // Sync collections from test suite
      onProgress?.({ type: 'sync_start' });

      // Build alias map for test suite collections only
      const aliasMap = new Map<string, string>();

      for (const [alias, spec] of Object.entries(suite.collections)) {
        // Compute collection ID (same as CollectionsService.computeCollectionId)
        const collectionId = this.#computeCollectionId(spec.url);
        aliasMap.set(alias, collectionId);

        // Sync the collection
        await client.collections.sync({
          name: alias,
          spec,
          cwd: baseDir,
        });
      }

      onProgress?.({ type: 'sync_complete' });

      // Create agent with only the test suite's collections
      const agent = createDocumentAgent({
        client,
        llmConfig,
        aliasMap,
        // Restrict searches to only the test suite's collections
        collections: Array.from(aliasMap.values()),
      });

      // Run each test
      for (let i = 0; i < suite.tests.length; i++) {
        const testCase = suite.tests[i];
        onProgress?.({ type: 'test_start', testId: testCase.id, index: i });

        const result = await this.#runSingleTest(testCase, agent, client, llmConfig, suite.options, options);
        results.push(result);

        onProgress?.({ type: 'test_complete', testId: testCase.id, result });
      }
    } finally {
      await client.disconnect();
    }

    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - startTime;

    const summary = {
      total: results.length,
      passed: results.filter((r) => r.passed && !r.skipped).length,
      failed: results.filter((r) => !r.passed && !r.skipped).length,
      skipped: results.filter((r) => r.skipped).length,
    };

    const runResult: TestRunResult = {
      suiteName: suite.name,
      startedAt,
      completedAt,
      durationMs,
      summary,
      results,
    };

    onProgress?.({ type: 'suite_complete', result: runResult });

    return runResult;
  }

  /**
   * Run a single test case
   */
  async #runSingleTest(
    testCase: TestCase,
    agent: ReturnType<typeof createDocumentAgent>,
    client: BackendClient,
    llmConfig: LLMConfig,
    suiteOptions: TestSuite['options'],
    runnerOptions: TestRunnerOptions,
  ): Promise<TestResult> {
    const startTime = Date.now();

    // Check if skipped
    if (testCase.skip) {
      return {
        id: testCase.id,
        passed: false,
        skipped: true,
        actualAnswer: '',
        durationMs: 0,
      };
    }

    try {
      // Get the agent's answer
      const response = await agent.ask(testCase.query, testCase.useCase);
      const actualAnswer = response.answer;

      // Determine validation mode
      const validationMode =
        runnerOptions.validationMode ?? testCase.validationMode ?? suiteOptions?.validationMode ?? 'semantic';

      // Determine pass threshold
      const passThreshold =
        runnerOptions.passThreshold ?? testCase.passThreshold ?? suiteOptions?.passThreshold ?? 0.75;

      // Validate based on mode
      let result: TestResult;

      switch (validationMode) {
        case 'keywords':
          result = await this.#validateKeywords(testCase, actualAnswer, passThreshold);
          break;
        case 'llm':
          result = await this.#validateWithLLM(testCase, actualAnswer, passThreshold, llmConfig, suiteOptions);
          break;
        case 'semantic':
        default:
          result = await this.#validateSemantic(testCase, actualAnswer, passThreshold);
          break;
      }

      result.durationMs = Date.now() - startTime;
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        id: testCase.id,
        passed: false,
        actualAnswer: '',
        error: message,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Validate using semantic similarity
   */
  async #validateSemantic(testCase: TestCase, actualAnswer: string, passThreshold: number): Promise<TestResult> {
    // Embed both expected and actual as documents (not queries)
    const embeddings = await this.#embedder.createDocumentEmbeddings([testCase.expected, actualAnswer]);
    const [expectedEmbedding, actualEmbedding] = embeddings;

    // Compute cosine similarity
    const similarity = this.#cosineSimilarity(expectedEmbedding, actualEmbedding);

    return {
      id: testCase.id,
      passed: similarity >= passThreshold,
      score: similarity,
      actualAnswer,
      reasoning: `Semantic similarity: ${(similarity * 100).toFixed(1)}% (threshold: ${(passThreshold * 100).toFixed(1)}%)`,
      durationMs: 0,
    };
  }

  /**
   * Validate using keyword matching
   */
  async #validateKeywords(testCase: TestCase, actualAnswer: string, passThreshold: number): Promise<TestResult> {
    const keywords = testCase.keywords ?? [];

    if (keywords.length === 0) {
      return {
        id: testCase.id,
        passed: false,
        actualAnswer,
        error: 'No keywords specified for keywords validation mode',
        durationMs: 0,
      };
    }

    const lowerAnswer = actualAnswer.toLowerCase();
    const found: string[] = [];
    const missing: string[] = [];

    for (const keyword of keywords) {
      if (lowerAnswer.includes(keyword.toLowerCase())) {
        found.push(keyword);
      } else {
        missing.push(keyword);
      }
    }

    const score = found.length / keywords.length;

    return {
      id: testCase.id,
      passed: score >= passThreshold,
      score,
      actualAnswer,
      keywordsFound: found,
      keywordsMissing: missing,
      reasoning: `Found ${found.length}/${keywords.length} keywords (${(score * 100).toFixed(1)}%)`,
      durationMs: 0,
    };
  }

  /**
   * Validate using LLM as judge
   */
  async #validateWithLLM(
    testCase: TestCase,
    actualAnswer: string,
    passThreshold: number,
    llmConfig: LLMConfig,
    suiteOptions: TestSuite['options'],
  ): Promise<TestResult> {
    const { ChatOpenAI } = await import('@langchain/openai');
    const { HumanMessage } = await import('@langchain/core/messages');

    const llm = new ChatOpenAI({
      configuration: { baseURL: llmConfig.provider },
      modelName: llmConfig.model,
      apiKey: llmConfig.apiKey,
      temperature: 0,
    });

    const instructions =
      testCase.validationInstructions ?? suiteOptions?.validationInstructions ?? DEFAULT_VALIDATION_INSTRUCTIONS;

    const prompt = LLM_VALIDATION_PROMPT.replace('{expected}', testCase.expected)
      .replace('{actual}', actualAnswer)
      .replace('{instructions}', instructions)
      .replace('{threshold}', passThreshold.toString());

    const response = await llm.invoke([new HumanMessage(prompt)]);
    const content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

    // Parse JSON response
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/) ?? content.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1] ?? jsonMatch[0]);
        const score = Number(parsed.score) || 0;

        return {
          id: testCase.id,
          passed: score >= passThreshold,
          score,
          actualAnswer,
          reasoning: parsed.reasoning ?? 'No reasoning provided',
          durationMs: 0,
        };
      } catch {
        // Fall through
      }
    }

    return {
      id: testCase.id,
      passed: false,
      actualAnswer,
      error: 'Failed to parse LLM validation response',
      reasoning: content,
      durationMs: 0,
    };
  }

  /**
   * Compute cosine similarity between two vectors
   */
  #cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Clean up resources
   */
  async [destroy](): Promise<void> {
    await this.#services.destroy();
  }
}

/**
 * Create a test runner instance
 */
const createTestRunner = (): AgentTestRunner => {
  return new AgentTestRunner();
};

export { AgentTestRunner, createTestRunner };
export type { TestProgressCallback, TestProgressEvent, TestRunnerOptions };
