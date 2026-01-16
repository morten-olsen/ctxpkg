import * as z from 'zod';

/**
 * Validation modes for test assertions
 */
export const validationModeSchema = z.enum(['semantic', 'llm', 'keywords']);
export type ValidationMode = z.infer<typeof validationModeSchema>;

/**
 * Individual test case
 */
export const testCaseSchema = z.object({
  /** Unique identifier for the test */
  id: z.string(),

  /** The question to ask the agent */
  query: z.string(),

  /** Use case context for the question */
  useCase: z.string(),

  /** Expected answer description or reference answer */
  expected: z.string(),

  /** Keywords that should appear in the answer (for keywords mode) */
  keywords: z.array(z.string()).optional(),

  /** Override validation mode for this specific test */
  validationMode: validationModeSchema.optional(),

  /** Custom validation instructions for LLM mode */
  validationInstructions: z.string().optional(),

  /** Override pass threshold for this specific test (0-1) */
  passThreshold: z.number().min(0).max(1).optional(),

  /** Whether this test is currently skipped */
  skip: z.boolean().optional(),
});

export type TestCase = z.infer<typeof testCaseSchema>;

/**
 * Collection specification (same as context.json format)
 */
export const collectionSpecSchema = z.object({
  url: z.string(),
});

export type CollectionSpec = z.infer<typeof collectionSpecSchema>;

/**
 * Test suite options
 */
export const testOptionsSchema = z.object({
  /** Default validation mode (default: semantic) */
  validationMode: validationModeSchema.optional().default('semantic'),

  /** Pass threshold for semantic similarity (0-1, default: 0.75) */
  passThreshold: z.number().min(0).max(1).optional().default(0.75),

  /** Default validation instructions for LLM mode */
  validationInstructions: z.string().optional(),

  /** Maximum time per test in milliseconds (default: 60000) */
  timeoutMs: z.number().optional().default(60000),
});

export type TestOptions = z.infer<typeof testOptionsSchema>;

/**
 * Complete test suite file structure
 */
export const testSuiteSchema = z.object({
  /** Name of the test suite */
  name: z.string(),

  /** Description of what this test suite covers */
  description: z.string().optional(),

  /** Collections to sync before running tests */
  collections: z.record(z.string(), collectionSpecSchema),

  /** Test suite options */
  options: testOptionsSchema.optional(),

  /** Test cases */
  tests: z.array(testCaseSchema).min(1),
});

export type TestSuite = z.infer<typeof testSuiteSchema>;

/**
 * Result of a single test case
 */
export const testResultSchema = z.object({
  /** Test case ID */
  id: z.string(),

  /** Whether the test passed */
  passed: z.boolean(),

  /** Score (0-1) for semantic/llm validation */
  score: z.number().optional(),

  /** The agent's actual answer */
  actualAnswer: z.string(),

  /** Validation reasoning (from LLM mode) or match details */
  reasoning: z.string().optional(),

  /** Keywords found (for keywords mode) */
  keywordsFound: z.array(z.string()).optional(),

  /** Keywords missing (for keywords mode) */
  keywordsMissing: z.array(z.string()).optional(),

  /** Time taken in milliseconds */
  durationMs: z.number(),

  /** Error message if the test failed to run */
  error: z.string().optional(),

  /** Whether the test was skipped */
  skipped: z.boolean().optional(),
});

export type TestResult = z.infer<typeof testResultSchema>;

/**
 * Complete test run results
 */
export const testRunResultSchema = z.object({
  /** Test suite name */
  suiteName: z.string(),

  /** When the test run started */
  startedAt: z.string(),

  /** When the test run completed */
  completedAt: z.string(),

  /** Total duration in milliseconds */
  durationMs: z.number(),

  /** Summary statistics */
  summary: z.object({
    total: z.number(),
    passed: z.number(),
    failed: z.number(),
    skipped: z.number(),
  }),

  /** Individual test results */
  results: z.array(testResultSchema),
});

export type TestRunResult = z.infer<typeof testRunResultSchema>;
