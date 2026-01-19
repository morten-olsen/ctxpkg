import * as z from 'zod';

import type { DocumentAgent } from '#root/agent/agent.js';
import { defineTool, type ToolDefinitions } from '#root/tools/tools.types.js';

type AgentToolOptions = {
  /** Document agent instance */
  agent: DocumentAgent;
};

/**
 * Creates the ask_documents tool definition for agent mode MCP.
 * This exposes a single tool that uses an internal agent to search and synthesize.
 */
const createAgentToolDefinitions = (options: AgentToolOptions): ToolDefinitions => {
  const { agent } = options;

  const askDocuments = defineTool({
    name: 'ask_documents',
    description:
      'Ask a question about the indexed documentation. An internal agent will search, ' +
      'read relevant sections, and synthesize a comprehensive answer. Returns only the ' +
      'final answer, not intermediate search results. Requires both a query and a use case ' +
      'to help determine when sufficient information has been found.',
    schema: z.object({
      query: z.string().describe('The question to answer. Be specific about what information you need.'),
      use_case: z
        .string()
        .describe(
          'Why you need this information and how it will be used. ' +
            'This helps determine when enough information has been found. ' +
            'Example: "I need to understand authentication flow to implement login in my app"',
        ),
    }),
    handler: async ({ query, use_case }) => {
      const response = await agent.ask(query, use_case);
      return response;
    },
  });

  return { askDocuments };
};

export { createAgentToolDefinitions };
export type { AgentToolOptions };
