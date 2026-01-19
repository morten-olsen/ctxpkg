import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ZodObject, ZodRawShape } from 'zod';

import type { ToolDefinition, ToolDefinitions } from './tools.types.js';

/**
 * Register a common tool definition on an MCP server
 */
const registerMcpTool = <T extends ToolDefinition>(server: McpServer, definition: T) => {
  // MCP SDK expects the Zod schema shape directly (the inner part of z.object())
  // Extract the shape from ZodObject if available
  const schema = definition.schema;
  const shape = 'shape' in schema ? (schema as ZodObject<ZodRawShape>).shape : {};

  server.tool(definition.name, definition.description, shape, async (args) => {
    try {
      // Parse and validate input through Zod schema
      const validatedInput = definition.schema.parse(args);
      const result = await definition.handler(validatedInput);

      // Format result for MCP
      const content = typeof result === 'string' ? result : JSON.stringify(result, null, 2);

      return {
        content: [{ type: 'text' as const, text: content }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text' as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  });
};

/**
 * Register a collection of tool definitions on an MCP server
 */
const registerMcpTools = <T extends ToolDefinitions>(server: McpServer, definitions: T) => {
  for (const definition of Object.values(definitions)) {
    registerMcpTool(server, definition);
  }
};

export { registerMcpTool, registerMcpTools };
