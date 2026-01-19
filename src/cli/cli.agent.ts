import type { Command } from 'commander';

import { createTestRunner, type TestProgressEvent } from '../agent/agent.test-runner.ts';
import type { ValidationMode } from '../agent/agent.test-runner.schemas.ts';

import {
  chalk,
  formatError,
  formatHeader,
  formatInfo,
  formatSuccess,
  formatWarning,
  withErrorHandling,
} from './cli.utils.ts';

type TestOptions = {
  json?: boolean;
  verbose?: boolean;
  validationMode?: ValidationMode;
  threshold?: number;
  model?: string;
};

/**
 * Format duration in human-readable form
 */
const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
};

/**
 * Progress callback for verbose mode
 */
const createProgressCallback = (verbose: boolean) => {
  return (event: TestProgressEvent) => {
    switch (event.type) {
      case 'suite_start':
        formatHeader(`Running: ${event.suiteName}`);
        console.log(`${event.totalTests} test(s) to run\n`);
        break;

      case 'sync_start':
        if (verbose) {
          formatInfo('Syncing collections...');
        }
        break;

      case 'sync_complete':
        if (verbose) {
          formatSuccess('Collections synced');
          console.log();
        }
        break;

      case 'test_start':
        if (verbose) {
          console.log(chalk.dim(`[${event.index + 1}] Running: ${event.testId}`));
        }
        break;

      case 'test_complete': {
        const { result } = event;
        const icon = result.skipped ? chalk.yellow('○') : result.passed ? chalk.green('✓') : chalk.red('✗');
        const status = result.skipped ? chalk.yellow('SKIP') : result.passed ? chalk.green('PASS') : chalk.red('FAIL');
        const duration = chalk.dim(`(${formatDuration(result.durationMs)})`);

        console.log(`${icon} ${result.id} ${status} ${duration}`);

        if (verbose && !result.skipped) {
          if (result.score !== undefined) {
            console.log(chalk.dim(`  Score: ${(result.score * 100).toFixed(1)}%`));
          }
          if (result.reasoning) {
            console.log(chalk.dim(`  ${result.reasoning}`));
          }
          if (result.error) {
            console.log(chalk.red(`  Error: ${result.error}`));
          }
          if (result.keywordsFound?.length || result.keywordsMissing?.length) {
            if (result.keywordsFound?.length) {
              console.log(chalk.dim(`  Found: ${result.keywordsFound.join(', ')}`));
            }
            if (result.keywordsMissing?.length) {
              console.log(chalk.dim(`  Missing: ${result.keywordsMissing.join(', ')}`));
            }
          }
        }
        break;
      }

      case 'suite_complete':
        // Summary is handled separately
        break;
    }
  };
};

const createAgentCli = (command: Command) => {
  command.description('Agent testing and evaluation tools');

  command
    .command('test')
    .description('Run agent tests from a YAML test file')
    .argument('<test-file>', 'Path to YAML test file')
    .option('--json', 'Output results as JSON')
    .option('-v, --verbose', 'Show detailed progress and results')
    .option('-m, --validation-mode <mode>', 'Override validation mode (semantic, llm, keywords)')
    .option('-t, --threshold <number>', 'Override pass threshold (0-1)', parseFloat)
    .option('--model <model>', 'Model to use for LLM validation (defaults to configured model)')
    .action(
      withErrorHandling(async (testFile: string, options: TestOptions) => {
        const runner = createTestRunner();

        try {
          // Load test suite
          const { suite, baseDir } = await runner.loadTestSuite(testFile);

          // Validate options
          if (options.validationMode && !['semantic', 'llm', 'keywords'].includes(options.validationMode)) {
            formatError(`Invalid validation mode: ${options.validationMode}. Use: semantic, llm, or keywords`);
            process.exitCode = 1;
            return;
          }

          if (options.threshold !== undefined && (options.threshold < 0 || options.threshold > 1)) {
            formatError('Threshold must be between 0 and 1');
            process.exitCode = 1;
            return;
          }

          // Run tests
          const result = await runner.runTestSuite(suite, {
            onProgress: options.json ? undefined : createProgressCallback(options.verbose ?? false),
            validationMode: options.validationMode as ValidationMode | undefined,
            passThreshold: options.threshold,
            validationModel: options.model,
            baseDir,
          });

          // Output results
          if (options.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            // Summary
            console.log();
            formatHeader('Summary');
            console.log(`Total:   ${result.summary.total}`);
            console.log(`Passed:  ${chalk.green(result.summary.passed)}`);
            console.log(
              `Failed:  ${result.summary.failed > 0 ? chalk.red(result.summary.failed) : result.summary.failed}`,
            );
            console.log(
              `Skipped: ${result.summary.skipped > 0 ? chalk.yellow(result.summary.skipped) : result.summary.skipped}`,
            );
            console.log(`Time:    ${formatDuration(result.durationMs)}`);
            console.log();

            // Show failed test details if not verbose (verbose already shows them)
            if (!options.verbose && result.summary.failed > 0) {
              formatHeader('Failed Tests');
              for (const testResult of result.results) {
                if (!testResult.passed && !testResult.skipped) {
                  console.log(chalk.red(`✗ ${testResult.id}`));
                  if (testResult.score !== undefined) {
                    console.log(chalk.dim(`  Score: ${(testResult.score * 100).toFixed(1)}%`));
                  }
                  if (testResult.reasoning) {
                    console.log(chalk.dim(`  ${testResult.reasoning}`));
                  }
                  if (testResult.error) {
                    console.log(chalk.red(`  Error: ${testResult.error}`));
                  }
                  console.log();
                }
              }
            }

            // Final status
            if (result.summary.failed === 0) {
              formatSuccess('All tests passed!');
            } else {
              formatWarning(`${result.summary.failed} test(s) failed`);
              process.exitCode = 1;
            }
          }
        } finally {
          // Clean up - TypeScript doesn't know about the destroy symbol
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (runner as any)[Symbol.for('destroy')]?.();
        }
      }),
    );
};

export { createAgentCli };
