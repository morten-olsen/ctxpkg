import type { Command } from 'commander';

import { formatHeader, formatInfo, formatError, withErrorHandling, chalk } from './cli.utils.ts';

import { createDefaultAgent, prompt, startSession } from '#root/interact/interact.ts';

const createInteractCli = (command: Command) => {
  // Interactive session command
  command
    .command('session')
    .alias('s')
    .description('Start an interactive chat session')
    .action(
      withErrorHandling(async () => {
        formatHeader('Interactive Session');
        formatInfo('Starting interactive session...');
        formatInfo(`Type ${chalk.cyan('exit')} or press ${chalk.cyan('Ctrl+C')} to quit`);
        console.log();

        await startSession();
      }),
    );

  // One-shot prompt command
  command
    .command('ask')
    .alias('a')
    .argument('<input>', 'The prompt/question to send')
    .description('Send a single prompt and get a response')
    .action(
      withErrorHandling(async (input: string) => {
        if (!input.trim()) {
          formatError('Please provide a non-empty prompt');
          return;
        }

        const { agent, services } = await createDefaultAgent();
        try {
          await prompt(agent, input);
        } finally {
          await services.destroy();
        }
      }),
    );
};

export { createInteractCli };
