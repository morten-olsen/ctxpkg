import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import type { BackendClient } from '#root/client/client.ts';
import { createReferenceToolDefinitions } from '#root/tools/references/references.ts';
import { registerMcpTools } from '#root/tools/tools.mcp.ts';

type McpServerOptions = {
  /** Name of the MCP server */
  name?: string;
  /** Version of the MCP server */
  version?: string;
};

type ReferencesMcpServerOptions = McpServerOptions & {
  /** Backend client for accessing the references service */
  client: BackendClient;
  /** Collections to limit searches to (optional, uses cwd and default collections if not specified) */
  collections?: string[];
  /** Optional map of project aliases to collection IDs */
  aliasMap?: Map<string, string>;
};

/**
 * Create an MCP server with reference document tools.
 */
const createReferencesMcpServer = (options: ReferencesMcpServerOptions) => {
  const { client, aliasMap, name = 'ctxpkg-references', version = '1.0.0' } = options;

  const server = new McpServer({
    name,
    version,
  });

  // Create and register reference tools
  const referenceTools = createReferenceToolDefinitions({ client, aliasMap });
  registerMcpTools(server, referenceTools);

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

export { createReferencesMcpServer, runMcpServer };
export type { McpServerOptions, ReferencesMcpServerOptions };
