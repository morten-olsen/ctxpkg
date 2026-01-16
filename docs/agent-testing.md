# Agent Testing

This guide covers ctxpkg's agent testing framework for validating agent performance against expected results.

## Overview

Agent testing lets you create repeatable test suites that verify your documentation is being searched and synthesized correctly. Define questions, expected answers, and validation criteria in YAML files, then run them against your collections.

**Use cases:**

- **Regression testing**: Ensure agent quality doesn't degrade as collections change
- **Quality benchmarks**: Measure answer quality across different models
- **CI integration**: Automated validation in deployment pipelines
- **Documentation validation**: Verify your docs contain the information users need

## Quick Start

### 1. Create a Test File

Create `tests/auth-tests.yaml`:

```yaml
name: Authentication Documentation Tests
description: Verify authentication docs are correctly indexed and searchable

collections:
  docs:
    url: file://./docs/manifest.json

options:
  validationMode: semantic
  passThreshold: 0.75

tests:
  - id: oauth-setup
    query: How do I set up OAuth authentication?
    useCase: Implementing social login for a web application
    expected: |
      Should explain OAuth2 flow including:
      - Registering an OAuth application
      - Configuring redirect URIs
      - Handling the authorization callback
      - Exchanging codes for tokens

  - id: jwt-validation
    query: How do I validate JWT tokens?
    useCase: Securing API endpoints
    expected: |
      Should cover JWT validation including:
      - Verifying signatures
      - Checking expiration
      - Validating claims
    keywords:
      - signature
      - expiration
      - claims
```

### 2. Run the Tests

```bash
# Run with progress output
ctxpkg agent test tests/auth-tests.yaml

# Verbose mode shows details
ctxpkg agent test tests/auth-tests.yaml --verbose

# JSON output for CI
ctxpkg agent test tests/auth-tests.yaml --json
```

### 3. Review Results

```
╭─────────────────────────────────────────────────────────────────────╮
│ Running: Authentication Documentation Tests                         │
╰─────────────────────────────────────────────────────────────────────╯
2 test(s) to run

✓ oauth-setup PASS (3.2s)
✓ jwt-validation PASS (2.8s)

╭─────────────────────────────────────────────────────────────────────╮
│ Summary                                                             │
╰─────────────────────────────────────────────────────────────────────╯
Total:   2
Passed:  2
Failed:  0
Skipped: 0
Time:    6.1s

✔ All tests passed!
```

## Test File Format

Test files use YAML format for readability with multi-line content.

### Complete Schema

```yaml
# Test suite name (required)
name: My Test Suite

# Description (optional)
description: What this test suite validates

# Collections to sync before running tests (required)
collections:
  alias-name:
    url: file://./path/to/manifest.json
  another-collection:
    url: https://example.com/docs/manifest.json

# Suite-level options (optional)
options:
  # Default validation mode: semantic, llm, or keywords
  validationMode: semantic
  
  # Pass threshold for semantic/llm modes (0-1)
  passThreshold: 0.75
  
  # Default validation instructions for LLM mode
  validationInstructions: |
    Focus on technical accuracy rather than exact wording.
    Consider partial answers as passing if they address the core question.
  
  # Timeout per test in milliseconds
  timeoutMs: 60000

# Test cases (required, at least one)
tests:
  - id: unique-test-id          # Required: unique identifier
    query: The question to ask   # Required: question for the agent
    useCase: Context for why     # Required: helps agent find relevant info
    expected: |                  # Required: expected answer or criteria
      Description of what the answer should contain.
      Can be a reference answer or acceptance criteria.
    
    # Optional fields
    keywords:                    # For keywords mode
      - must-have-word
      - another-keyword
    validationMode: llm          # Override suite default
    passThreshold: 0.8           # Override suite default
    validationInstructions: |    # Override for LLM mode
      Custom instructions for this specific test.
    skip: false                  # Skip this test
```

## Validation Modes

### Semantic Similarity (default)

Compares expected and actual answers using embedding similarity.

```yaml
options:
  validationMode: semantic
  passThreshold: 0.75  # 75% similarity required

tests:
  - id: example
    query: What is dependency injection?
    useCase: Learning design patterns
    expected: |
      Dependency injection is a design pattern where dependencies
      are provided to a class rather than created internally.
      This improves testability and modularity.
```

**Pros:** Fast, cheap, deterministic
**Cons:** May miss semantically equivalent but differently worded answers

### LLM Judge

Uses an LLM to evaluate answer quality against criteria.

```yaml
options:
  validationMode: llm
  passThreshold: 0.7
  validationInstructions: |
    Evaluate whether the answer correctly explains the concept.
    Ignore minor wording differences.

tests:
  - id: complex-concept
    query: Explain the CAP theorem
    useCase: Designing distributed systems
    expected: |
      Should explain:
      - Consistency: all nodes see the same data
      - Availability: every request receives a response
      - Partition tolerance: system works despite network failures
      - The trade-off: can only guarantee 2 of 3
```

**Pros:** Nuanced evaluation, handles paraphrasing
**Cons:** Slower, costs API tokens, non-deterministic

### Custom Validation Instructions

For LLM mode, you can provide custom instructions per test:

```yaml
tests:
  - id: format-check
    query: Show me a configuration example
    useCase: Setting up the application
    expected: Must include a valid YAML configuration block
    validationMode: llm
    validationInstructions: |
      Your task is NOT to validate correctness of the information.
      Instead, verify that the answer includes a properly formatted
      YAML code block with configuration syntax.
      
      Score 1.0 if valid YAML is present, 0.0 otherwise.
```

### Keyword Matching

Checks for presence of required keywords.

```yaml
tests:
  - id: keyword-check
    query: What databases are supported?
    useCase: Choosing a database
    expected: Should mention supported databases
    validationMode: keywords
    keywords:
      - PostgreSQL
      - MySQL
      - SQLite
    passThreshold: 0.66  # At least 2 of 3 keywords
```

**Pros:** Deterministic, fast, no API costs
**Cons:** Brittle, doesn't understand context

## CLI Options

```bash
ctxpkg agent test <test-file> [options]

Options:
  --json                        Output results as JSON
  -v, --verbose                 Show detailed progress and results
  -m, --validation-mode <mode>  Override validation mode for all tests
  -t, --threshold <number>      Override pass threshold (0-1)
```

### Examples

```bash
# Basic run
ctxpkg agent test tests/suite.yaml

# Verbose output with details
ctxpkg agent test tests/suite.yaml --verbose

# Override to use LLM validation
ctxpkg agent test tests/suite.yaml -m llm

# Strict threshold
ctxpkg agent test tests/suite.yaml -t 0.9

# JSON output for CI
ctxpkg agent test tests/suite.yaml --json > results.json
```

## Programmatic Usage

The test runner can be used as a service:

```typescript
import { createTestRunner } from 'ctxpkg';

const runner = createTestRunner();

// Load test suite
const suite = await runner.loadTestSuite('./tests/my-tests.yaml');

// Run with progress callback
const result = await runner.runTestSuite(suite, {
  onProgress: (event) => {
    if (event.type === 'test_complete') {
      console.log(`${event.testId}: ${event.result.passed ? 'PASS' : 'FAIL'}`);
    }
  },
  validationMode: 'semantic',
  passThreshold: 0.8,
});

console.log(`Passed: ${result.summary.passed}/${result.summary.total}`);
```

### Progress Events

```typescript
type TestProgressEvent =
  | { type: 'suite_start'; suiteName: string; totalTests: number }
  | { type: 'sync_start' }
  | { type: 'sync_complete' }
  | { type: 'test_start'; testId: string; index: number }
  | { type: 'test_complete'; testId: string; result: TestResult }
  | { type: 'suite_complete'; result: TestRunResult };
```

### Test Results

```typescript
type TestResult = {
  id: string;
  passed: boolean;
  score?: number;           // 0-1 for semantic/llm
  actualAnswer: string;
  reasoning?: string;       // Validation explanation
  keywordsFound?: string[]; // For keywords mode
  keywordsMissing?: string[];
  durationMs: number;
  error?: string;
  skipped?: boolean;
};

type TestRunResult = {
  suiteName: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  results: TestResult[];
};
```

## CI Integration

### GitHub Actions Example

```yaml
name: Agent Tests

on:
  push:
    paths:
      - 'docs/**'
  pull_request:
    paths:
      - 'docs/**'

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - name: Install ctxpkg
        run: npm install -g ctxpkg
      
      - name: Configure LLM (for llm validation mode)
        run: |
          ctxpkg config set llm.apiKey ${{ secrets.OPENAI_API_KEY }}
      
      - name: Run agent tests
        run: |
          ctxpkg agent test tests/agent-tests.yaml --json > results.json
          
      - name: Upload results
        uses: actions/upload-artifact@v4
        with:
          name: test-results
          path: results.json
```

### Exit Codes

- `0`: All tests passed
- `1`: One or more tests failed

## Best Practices

### Writing Good Test Cases

1. **Specific queries**: Ask focused questions rather than broad ones
2. **Clear use cases**: Provide context that helps the agent find relevant info
3. **Measurable expectations**: Write expected answers that can be objectively evaluated
4. **Include keywords**: Even for semantic mode, keywords help verify key concepts

### Choosing Validation Mode

| Scenario | Recommended Mode |
|----------|-----------------|
| Checking specific facts are mentioned | `keywords` |
| Verifying conceptual accuracy | `semantic` |
| Evaluating answer quality/completeness | `llm` |
| CI with cost constraints | `semantic` or `keywords` |
| Detailed quality assessment | `llm` |

### Threshold Guidelines

| Threshold | When to use |
|-----------|-------------|
| 0.9+ | Exact answer expected, strict validation |
| 0.75-0.9 | Standard accuracy requirements |
| 0.6-0.75 | Lenient, partial answers acceptable |
| < 0.6 | Very lenient, basic relevance check |

### Organizing Test Suites

```
tests/
├── core-features.yaml      # Critical functionality
├── edge-cases.yaml         # Unusual queries
├── regression.yaml         # Previous bugs
└── collections/
    ├── auth-docs.yaml      # Per-collection tests
    └── api-docs.yaml
```

## Troubleshooting

### "No collections found"

The test creates a temporary environment. Ensure collection URLs are accessible:

```yaml
collections:
  docs:
    # Use absolute paths or URLs
    url: file:///absolute/path/to/manifest.json
    # Or relative to test file location
    url: file://./docs/manifest.json
```

### Low semantic similarity scores

- Make expected answers more specific
- Use keywords mode for fact-checking
- Try LLM mode for nuanced evaluation

### LLM validation inconsistent

- Lower temperature in config: `ctxpkg config set llm.temperature 0`
- Use more specific validation instructions
- Consider semantic mode for deterministic results

### Tests timing out

- Increase timeout: `options.timeoutMs: 120000`
- Check if collections sync is slow
- Verify LLM API is responsive

## See Also

- [AI Chat & Agent Mode](ai-chat.md) — Using the agent interactively
- [Configuration](configuration.md) — LLM and other settings
- [CLI Reference](cli-reference.md) — Complete command documentation
