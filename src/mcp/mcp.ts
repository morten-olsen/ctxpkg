import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import type { BackendClient } from '#root/client/client.ts';
import { createDocumentToolDefinitions } from '#root/tools/documents/documents.ts';
import { registerMcpTools } from '#root/tools/tools.mcp.ts';

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

export { createDocumentsMcpServer, runMcpServer };
export type { McpServerOptions, DocumentsMcpServerOptions };
