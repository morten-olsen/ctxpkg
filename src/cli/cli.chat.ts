import { input } from '@inquirer/prompts';
import type { Command } from 'commander';

import { createDocumentAgent, getLLMConfigFromAppConfig } from '../agent/agent.js';
import type { AgentStep } from '../agent/agent.types.js';
import { CollectionsService } from '../collections/collections.js';
import { Services } from '../utils/utils.services.js';

import { createCliClient } from './cli.client.js';
import { chalk, formatError, formatHeader, formatInfo, withErrorHandling } from './cli.utils.js';

type ChatOptions = {
  interactive?: boolean;
  useCase?: string;
  collections?: string[];
  global: boolean;
  model?: string;
  verbose?: boolean;
};

/**
 * Create a verbose step callback that logs agent reasoning to console
 */
const createVerboseCallback = () => {
  return (step: AgentStep) => {
    switch (step.type) {
      case 'thinking':
        console.log(chalk.dim(`  [thinking] ${step.content}`));
        break;
      case 'tool_call':
        console.log(chalk.blue(`  [tool] ${step.toolName}`));
        if (step.toolInput) {
          const inputPreview = JSON.stringify(step.toolInput).slice(0, 100);
          console.log(chalk.dim(`    Input: ${inputPreview}${inputPreview.length >= 100 ? '...' : ''}`));
        }
        break;
      case 'tool_result':
        console.log(chalk.green(`  [result] ${step.content}`));
        break;
      case 'error':
        console.log(chalk.yellow(`  [retry] ${step.content}`));
        break;
    }
  };
};

/**
 * Resolve collection names to IDs, returning a list of resolved collection IDs
 */
const resolveCollectionIds = (
  collections: string[] | undefined,
  aliasMap: Map<string, string>,
): string[] | undefined => {
  if (!collections || collections.length === 0) return undefined;
  return collections.map((c) => aliasMap.get(c) ?? c);
};

/**
 * Run one-shot chat mode - ask a single question and get an answer.
 */
const runOneShotChat = async (query: string, options: ChatOptions) => {
  // Get LLM config
  const llmConfig = await getLLMConfigFromAppConfig();

  if (!llmConfig.apiKey) {
    formatError('LLM API key not configured. Set it with: ctxpkg config set llm.apiKey <key>');
    formatError('Or use environment variable: CTXPKG_LLM_API_KEY=<key>');
    process.exitCode = 1;
    return;
  }

  // Override model if specified
  if (options.model) {
    llmConfig.model = options.model;
  }

  // Prompt for use case if not provided
  let useCase = options.useCase;
  if (!useCase) {
    useCase = await input({
      message: 'What is your use case? (helps find relevant information)',
    });
  }

  if (!useCase) {
    formatError('Use case is required to help the agent find relevant information.');
    process.exitCode = 1;
    return;
  }

  const client = await createCliClient();
  const services = new Services();

  try {
    // Build alias map
    const aliasMap = new Map<string, string>();
    const collectionsService = services.get(CollectionsService);
    const includeGlobal = options.global !== false;

    if (includeGlobal) {
      const allCollections = collectionsService.getAllCollections();
      for (const [alias, { spec }] of allCollections) {
        const collectionId = collectionsService.computeCollectionId(spec);
        aliasMap.set(alias, collectionId);
      }
    } else if (collectionsService.projectConfigExists()) {
      const projectConfig = collectionsService.readProjectConfig();
      for (const [alias, spec] of Object.entries(projectConfig.collections)) {
        const collectionId = collectionsService.computeCollectionId(spec);
        aliasMap.set(alias, collectionId);
      }
    }

    // Resolve collection filtering
    const resolvedCollections = resolveCollectionIds(options.collections, aliasMap);

    // Create verbose callback if needed
    const onStep = options.verbose ? createVerboseCallback() : undefined;

    // Create agent with collection filtering
    const agent = createDocumentAgent({
      client,
      llmConfig,
      aliasMap,
      collections: resolvedCollections,
      onStep,
    });

    formatInfo('Searching documentation...\n');

    // Ask the question
    const response = await agent.ask(query, useCase);

    // Display answer
    formatHeader('Answer');
    console.log(response.answer);
    console.log();

    // Display sources
    if (response.sources.length > 0) {
      formatHeader('Sources');
      for (const source of response.sources) {
        const section = source.section ? ` → "${source.section}"` : '';
        console.log(`${chalk.dim('•')} ${chalk.cyan(source.collection)}: ${source.document}${section}`);
      }
      console.log();
    }

    // Display confidence and note
    const confidenceColor =
      response.confidence === 'high' ? chalk.green : response.confidence === 'medium' ? chalk.yellow : chalk.red;
    console.log(`Confidence: ${confidenceColor(response.confidence)}`);

    if (response.note) {
      console.log(`\n${chalk.dim('Note:')} ${response.note}`);
    }
  } finally {
    await client.disconnect();
    await services.destroy();
  }
};

/**
 * Run interactive chat mode - continuous conversation with the agent.
 */
const runInteractiveChat = async (options: ChatOptions) => {
  // Get LLM config
  const llmConfig = await getLLMConfigFromAppConfig();

  if (!llmConfig.apiKey) {
    formatError('LLM API key not configured. Set it with: ctxpkg config set llm.apiKey <key>');
    formatError('Or use environment variable: CTXPKG_LLM_API_KEY=<key>');
    process.exitCode = 1;
    return;
  }

  // Override model if specified
  if (options.model) {
    llmConfig.model = options.model;
  }

  const client = await createCliClient();
  const services = new Services();

  try {
    // Build alias map
    const aliasMap = new Map<string, string>();
    const collectionsService = services.get(CollectionsService);
    const includeGlobal = options.global !== false;

    if (includeGlobal) {
      const allCollections = collectionsService.getAllCollections();
      for (const [alias, { spec }] of allCollections) {
        const collectionId = collectionsService.computeCollectionId(spec);
        aliasMap.set(alias, collectionId);
      }
    } else if (collectionsService.projectConfigExists()) {
      const projectConfig = collectionsService.readProjectConfig();
      for (const [alias, spec] of Object.entries(projectConfig.collections)) {
        const collectionId = collectionsService.computeCollectionId(spec);
        aliasMap.set(alias, collectionId);
      }
    }

    // Resolve collection filtering
    const resolvedCollections = resolveCollectionIds(options.collections, aliasMap);

    // Track verbose mode state
    let verbose = options.verbose ?? false;

    // Create agent with collection filtering
    const agent = createDocumentAgent({
      client,
      llmConfig,
      aliasMap,
      collections: resolvedCollections,
    });

    // Display header
    formatHeader('ctxpkg Chat');
    console.log('Type your questions. Commands: /help, /use-case, /clear, /verbose, /quit');
    console.log();

    // Get initial use case
    let useCase = options.useCase;
    if (!useCase) {
      useCase = await input({
        message: 'What are you trying to accomplish?',
      });
    }

    if (!useCase) {
      formatError('Use case is required.');
      process.exitCode = 1;
      return;
    }

    console.log();
    console.log(chalk.dim(`Use case: ${useCase}`));
    if (verbose) {
      console.log(chalk.dim('Verbose mode: on'));
    }
    console.log();

    // Chat loop
    while (true) {
      let message: string;
      try {
        message = await input({ message: chalk.cyan('You:') });
      } catch {
        // Handle Ctrl+C
        console.log('\nGoodbye!');
        break;
      }

      if (!message.trim()) {
        continue;
      }

      // Handle commands
      if (message.startsWith('/')) {
        const cmd = message.toLowerCase().trim();

        if (cmd === '/quit' || cmd === '/exit' || cmd === '/q') {
          console.log('Goodbye!');
          break;
        }

        if (cmd === '/help' || cmd === '/h') {
          console.log('\nCommands:');
          console.log('  /help, /h       Show this help');
          console.log('  /use-case, /u   Change use case');
          console.log('  /clear, /c      Clear conversation history');
          console.log('  /verbose, /v    Toggle verbose mode');
          console.log('  /quit, /q       Exit chat\n');
          continue;
        }

        if (cmd === '/use-case' || cmd === '/u') {
          console.log(chalk.dim(`Current use case: ${useCase}`));
          const newUseCase = await input({ message: 'New use case (or press enter to keep current):' });
          if (newUseCase.trim()) {
            useCase = newUseCase;
            agent.clearHistory(); // Clear history when use case changes
            console.log(chalk.dim(`Use case updated: ${useCase}`));
            console.log(chalk.dim('Conversation history cleared.\n'));
          }
          continue;
        }

        if (cmd === '/clear' || cmd === '/c') {
          agent.clearHistory();
          console.log(chalk.dim('Conversation history cleared.\n'));
          continue;
        }

        if (cmd === '/verbose' || cmd === '/v') {
          verbose = !verbose;
          console.log(chalk.dim(`Verbose mode: ${verbose ? 'on' : 'off'}\n`));
          continue;
        }

        console.log(chalk.yellow(`Unknown command: ${message}. Type /help for available commands.\n`));
        continue;
      }

      // Ask the question using chat (maintains history)
      console.log();
      formatInfo('Searching...');

      try {
        const onStep = verbose ? createVerboseCallback() : undefined;
        const response = await agent.chat(message, useCase, { onStep });

        console.log();
        console.log(response.answer);
        console.log();

        if (response.sources.length > 0) {
          console.log(chalk.dim('Sources:'));
          for (const source of response.sources) {
            const section = source.section ? ` → "${source.section}"` : '';
            console.log(chalk.dim(`  • ${source.collection}: ${source.document}${section}`));
          }
          console.log();
        }

        // Show conversation length in verbose mode
        if (verbose) {
          console.log(chalk.dim(`[${agent.getHistoryLength()} messages in history]\n`));
        }
      } catch (error) {
        const errMessage = error instanceof Error ? error.message : String(error);
        formatError(`Error: ${errMessage}`);
        console.log();
      }
    }
  } finally {
    await client.disconnect();
    await services.destroy();
  }
};

const createChatCli = (command: Command) => {
  command
    .description('Chat with your documentation using AI')
    .argument('[query]', 'Question to ask (starts one-shot mode)')
    .option('-i, --interactive', 'Start interactive chat session')
    .option('-u, --use-case <text>', 'Context for why you need this information')
    .option('-c, --collections <names...>', 'Limit to specific collections')
    .option('--no-global', 'Exclude global collections')
    .option('--model <model>', 'Override LLM model from config')
    .option('--verbose', 'Show agent reasoning (not yet implemented)')
    .action(
      withErrorHandling(async (query: string | undefined, options: ChatOptions) => {
        if (options.interactive) {
          await runInteractiveChat(options);
        } else if (query) {
          await runOneShotChat(query, options);
        } else {
          // No query and not interactive - start interactive mode
          await runInteractiveChat(options);
        }
      }),
    );
};

export { createChatCli };
