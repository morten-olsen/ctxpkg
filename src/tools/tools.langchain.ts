import { tool } from 'langchain';

import type { ToolDefinition, ToolDefinitions } from './tools.types.js';

/**
 * Convert a common tool definition to a Langchain tool
 */
const toLangchainTool = <T extends ToolDefinition>(definition: T) => {
  return tool(
    async (input) => {
      const result = await definition.handler(input);
      // Langchain tools expect string output
      if (typeof result === 'string') {
        return result;
      }
      return JSON.stringify(result, null, 2);
    },
    {
      name: definition.name,
      description: definition.description,
      schema: definition.schema,
    },
  );
};

/**
 * Convert a collection of tool definitions to Langchain tools
 */
const toLangchainTools = <T extends ToolDefinitions>(definitions: T) => {
  const result: Record<string, ReturnType<typeof toLangchainTool>> = {};
  for (const [key, definition] of Object.entries(definitions)) {
    result[key] = toLangchainTool(definition);
  }
  return result;
};

export { toLangchainTool, toLangchainTools };
