import * as z from 'zod';

/**
 * Common tool definition format that can be converted to Langchain or MCP tools.
 *
 * This provides a framework-agnostic way to define tools that can then
 * be adapted to different tool runtime environments.
 */
type ToolDefinition<TInput extends z.ZodType = z.ZodType, TOutput = unknown> = {
  /** Unique name for the tool */
  name: string;
  /** Description of what the tool does */
  description: string;
  /** Zod schema for input validation */
  schema: TInput;
  /** The handler function that executes the tool */
  handler: (input: z.infer<TInput>) => Promise<TOutput>;
};

/**
 * A collection of tool definitions - using eslint-disable for any here since
 * the specific tool types are erased when collecting into a record
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ToolDefinitions = Record<string, ToolDefinition<any, any>>;

/**
 * Helper to create a type-safe tool definition
 */
const defineTool = <TInput extends z.ZodType, TOutput>(
  definition: ToolDefinition<TInput, TOutput>,
): ToolDefinition<TInput, TOutput> => definition;

export { defineTool };
export type { ToolDefinition, ToolDefinitions };
