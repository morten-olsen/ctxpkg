import { z } from 'zod';

// Request/Response protocol (JSON-RPC 2.0 inspired)
const requestSchema = z.object({
  id: z.string(),
  method: z.string(),
  params: z.unknown().optional(),
});

type Request = z.infer<typeof requestSchema>;

const responseSchema = z.object({
  id: z.string(),
  result: z.unknown().optional(),
  error: z
    .object({
      code: z.number(),
      message: z.string(),
      data: z.unknown().optional(),
    })
    .optional(),
});

type Response = z.infer<typeof responseSchema>;

// Standard error codes
const ErrorCodes = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  // Custom codes
  ServiceError: -32000,
  NotConnected: -32001,
  Timeout: -32002,
} as const;

type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

// Procedure definition for type-safe handlers
type Procedure<TInput extends z.ZodTypeAny, TOutput> = {
  input: TInput;
  handler: (params: z.infer<TInput>) => Promise<TOutput>;
};

// Helper to create procedures with type inference
const procedure = <TInput extends z.ZodTypeAny, TOutput>(
  input: TInput,
  handler: (params: z.infer<TInput>) => Promise<TOutput>,
): Procedure<TInput, TOutput> => ({
  input,
  handler,
});

// Service definition type - maps method names to procedures
type ServiceDefinition = Record<string, Procedure<z.ZodTypeAny, unknown>>;

// Extract input type from a procedure
type ProcedureInput<T> = T extends Procedure<infer TInput, unknown> ? z.infer<TInput> : never;

// Extract output type from a procedure
type ProcedureOutput<T> = T extends Procedure<z.ZodTypeAny, infer TOutput> ? TOutput : never;

// Create response helpers
const createSuccessResponse = (id: string, result: unknown): Response => ({
  id,
  result,
});

const createErrorResponse = (id: string, code: ErrorCode, message: string, data?: unknown): Response => ({
  id,
  error: { code, message, data },
});

export type { Request, Response, Procedure, ServiceDefinition, ProcedureInput, ProcedureOutput, ErrorCode };
export { requestSchema, responseSchema, ErrorCodes, procedure, createSuccessResponse, createErrorResponse };
