/**
 * Shared type definitions for backend services.
 * These types define the contract between backend and client.
 */

import type { BackendServices } from './backend.services.js';
import type { ProcedureToFunction } from './backend.protocol.js';

/**
 * Complete backend API definition.
 * This is the main interface that clients use.
 */
export type BackendAPI = {
  [Namespace in keyof BackendServices]: {
    [Method in keyof BackendServices[Namespace]]: ProcedureToFunction<BackendServices[Namespace][Method]>;
  };
};

/**
 * Extract the parameter type for a specific API method.
 * Returns the first parameter type, or undefined if the method takes no parameters.
 */
export type GetBackendAPIParams<
  Namespace extends keyof BackendAPI,
  Method extends keyof BackendAPI[Namespace],
> = Parameters<BackendAPI[Namespace][Method]>[0];

/**
 * Extract the response type (unwrapped from Promise) for a specific API method.
 */
export type GetBackendAPIResponse<
  Namespace extends keyof BackendAPI,
  Method extends keyof BackendAPI[Namespace],
> = Awaited<ReturnType<BackendAPI[Namespace][Method]>>;
