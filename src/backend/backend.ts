import { z } from 'zod';

import {
  requestSchema,
  ErrorCodes,
  createSuccessResponse,
  createErrorResponse,
  type Request,
  type Response,
  type Procedure,
} from './backend.protocol.js';
import { createBackendServices, type BackendServices } from './backend.services.js';

import { Services, destroy } from '#root/utils/utils.services.js';

type BackendOptions = {
  services?: Services;
};

class Backend {
  #services: Services;
  #backendServices: BackendServices;
  #startTime: number;
  #connectionCount = 0;

  constructor(options?: BackendOptions) {
    this.#services = options?.services ?? new Services();
    this.#startTime = Date.now();
    this.#backendServices = createBackendServices(this.#services, () => ({
      uptime: Date.now() - this.#startTime,
      connections: this.#connectionCount,
    }));
  }

  // Update connection count (called by daemon)
  setConnectionCount(count: number) {
    this.#connectionCount = count;
  }

  // Get the services definition for type inference
  getServices(): BackendServices {
    return this.#backendServices;
  }

  // Handle incoming request
  async handleRequest(raw: unknown): Promise<Response> {
    // Parse request
    const parseResult = requestSchema.safeParse(raw);
    if (!parseResult.success) {
      return createErrorResponse(
        'unknown',
        ErrorCodes.ParseError,
        'Invalid request format',
        parseResult.error.format(),
      );
    }

    const request = parseResult.data;
    return this.#routeRequest(request);
  }

  async #routeRequest(request: Request): Promise<Response> {
    const { id, method, params } = request;

    // Parse method as "service.method"
    const [serviceName, methodName] = method.split('.');
    if (!serviceName || !methodName) {
      return createErrorResponse(id, ErrorCodes.MethodNotFound, `Invalid method format: ${method}`);
    }

    // Get procedure using explicit lookup
    const procedure = this.#getProcedure(serviceName, methodName);
    if (!procedure) {
      return createErrorResponse(id, ErrorCodes.MethodNotFound, `Unknown method: ${method}`);
    }

    // Validate input
    const inputResult = procedure.input.safeParse(params ?? {});
    if (!inputResult.success) {
      return createErrorResponse(id, ErrorCodes.InvalidParams, 'Invalid parameters', inputResult.error.format());
    }

    // Execute handler
    try {
      const result = await procedure.handler(inputResult.data);
      return createSuccessResponse(id, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return createErrorResponse(id, ErrorCodes.ServiceError, message);
    }
  }

  #getProcedure(serviceName: string, methodName: string): Procedure<z.ZodTypeAny, unknown> | null {
    const services = this.#backendServices;
    if (!(serviceName in services)) {
      return null;
    }
    const service = services[serviceName as keyof typeof services];
    if (!(methodName in service)) {
      return null;
    }

    return service[methodName as keyof typeof service] as unknown as Procedure<z.ZodTypeAny, unknown>;
  }

  [destroy] = async () => {
    await this.#services.destroy();
  };
}

export { Backend };
