import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createDocumentAgent, type CreateDocumentAgentOptions } from '#root/agent/agent.js';
import type { LLMConfig } from '#root/agent/agent.types.js';
import type { BackendClient } from '#root/client/client.js';
import { createAgentToolDefinitions } from '#root/tools/agent/agent.js';
import { createDocumentToolDefinitions } from '#root/tools/documents/documents.js';
import { registerMcpTools } from '#root/tools/tools.mcp.js';

type McpServerOptions = {
  /** Name of the MCP server */
  name?: string;
  /** Version of the MCP server */
  version?: string;
};

type DocumentsMcpServerOptions = McpServerOptions & {
  /** Backend client for accessing the documents service */
  client: BackendClient;
  /** Collections to limit searches to (optional, uses cwd and default collections if not specified) */
  collections?: string[];
  /** Optional map of project aliases to collection IDs */
  aliasMap?: Map<string, string>;
};

type AgentMcpServerOptions = McpServerOptions & {
  /** Backend client for accessing the documents service */
  client: BackendClient;
  /** LLM configuration for the agent */
  llmConfig: LLMConfig;
  /** Optional map of project aliases to collection IDs */
  aliasMap?: Map<string, string>;
  /** Maximum agent iterations */
  maxIterations?: number;
};

/**
 * Create an MCP server with document tools.
 */
const createDocumentsMcpServer = (options: DocumentsMcpServerOptions) => {
  const { client, aliasMap, name = 'ctxpkg-documents', version = '1.0.0' } = options;

  const server = new McpServer({
    name,
    version,
  });

  // Create and register document tools
  const documentTools = createDocumentToolDefinitions({ client, aliasMap });
  registerMcpTools(server, documentTools);

  return server;
};

/**
 * Create an MCP server with agent mode (single ask_documents tool).
 * The internal agent uses LLM to search and synthesize answers.
 */
const createAgentMcpServer = (options: AgentMcpServerOptions) => {
  const { client, aliasMap, llmConfig, maxIterations, name = 'ctxpkg-agent', version = '1.0.0' } = options;

  const server = new McpServer({
    name,
    version,
  });

  // Create document agent
  const agentOptions: CreateDocumentAgentOptions = {
    client,
    llmConfig,
    aliasMap,
    maxIterations,
  };
  const agent = createDocumentAgent(agentOptions);

  // Create and register agent tools (just ask_documents)
  const agentTools = createAgentToolDefinitions({ agent });
  registerMcpTools(server, agentTools);

  return server;
};

/**
 * Run an MCP server over stdio transport.
 * This is the main entry point for running as a standalone MCP server.
 */
const runMcpServer = async (server: McpServer) => {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    await server.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await server.close();
    process.exit(0);
  });
};

export { createAgentMcpServer, createDocumentsMcpServer, runMcpServer };
export type { AgentMcpServerOptions, DocumentsMcpServerOptions, McpServerOptions };
