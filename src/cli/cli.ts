import { Command } from 'commander';

import { createAgentCli } from './cli.agent.ts';
import { createChatCli } from './cli.chat.ts';
import { createCollectionsCli } from './cli.collections.ts';
import { createConfigCli } from './cli.config.ts';
import { createDaemonCli } from './cli.daemon.ts';
import { createDocumentsCli } from './cli.documents.ts';
import { createMcpCli } from './cli.mcp.ts';

const createProgram = () => {
  const program = new Command();

  program.name('ctxpkg').description('Context package manager - manage AI agent context collections').version('1.0.0');

  // Create subcommand groups
  createCollectionsCli(program.command('collections').alias('col').description('Manage collection packages'));
  createDocumentsCli(program.command('documents').alias('docs').description('Query indexed documents'));
  createConfigCli(program.command('config').alias('cfg').description('Manage configuration'));
  createDaemonCli(program.command('daemon').description('Manage the background daemon'));
  createMcpCli(program.command('mcp').description('Start MCP servers for tool integration'));
  createChatCli(program.command('chat').description('Chat with your documentation using AI'));
  createAgentCli(program.command('agent').description('Agent testing and evaluation tools'));

  return program;
};

export { createProgram };
