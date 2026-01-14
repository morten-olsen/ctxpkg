import { Command } from 'commander';

import { createCollectionsCli } from './cli.collections.ts';
import { createConfigCli } from './cli.config.ts';
import { createDaemonCli } from './cli.daemon.ts';
import { createMcpCli } from './cli.mcp.ts';
import { createReferenceCli } from './cli.references.ts';

const createProgram = () => {
  const program = new Command();

  program
    .name('ctxpkg')
    .description('Context package manager - manage AI agent context collections')
    .version('1.0.0');

  // Create subcommand groups
  createCollectionsCli(program.command('collections').alias('col').description('Manage collection packages'));
  createReferenceCli(program.command('references').alias('ref').description('Query indexed reference documents'));
  createConfigCli(program.command('config').alias('cfg').description('Manage configuration'));
  createDaemonCli(program.command('daemon').description('Manage the background daemon'));
  createMcpCli(program.command('mcp').description('Start MCP servers for tool integration'));

  return program;
};

export { createProgram };
