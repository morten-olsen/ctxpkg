import { Command } from 'commander';

import { createAgentCli } from './cli.agent.js';
import { createChatCli } from './cli.chat.js';
import { createCollectionsCli } from './cli.collections.js';
import { createConfigCli } from './cli.config.js';
import { createDaemonCli } from './cli.daemon.js';
import { createDocumentsCli } from './cli.documents.js';
import { createMcpCli } from './cli.mcp.js';

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
