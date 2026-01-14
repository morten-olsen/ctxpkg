import { Command } from 'commander';

import { createConfigCli } from './cli.config.ts';
import { createInteractCli } from './cli.interact.ts';
import { createReferenceCli } from './cli.references.ts';

const createProgram = () => {
  const program = new Command();

  program.name('ai-assist').description('AI-powered assistant for software development').version('1.0.0');

  // Create subcommand groups
  createInteractCli(program.command('chat').description('Chat and prompt commands'));
  createConfigCli(program.command('config').alias('cfg').description('Manage configuration'));
  createReferenceCli(program.command('references').alias('ref').description('Manage reference documents'));

  // Add top-level shortcuts for common commands
  program
    .command('ask')
    .argument('<input>', 'The prompt/question to send')
    .description('Shortcut for "chat ask" - send a single prompt')
    .action(async (input: string) => {
      // Forward to chat ask command
      await program.parseAsync(['node', 'cli', 'chat', 'ask', input]);
    });

  program
    .command('session')
    .alias('s')
    .description('Shortcut for "chat session" - start interactive session')
    .action(async () => {
      await program.parseAsync(['node', 'cli', 'chat', 'session']);
    });

  return program;
};

export { createProgram };
