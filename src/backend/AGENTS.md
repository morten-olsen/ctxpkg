# Backend Service — Agent Guidelines

This document describes the backend service architecture for AI agents working on this module.

## Overview

The backend service is a JSON-RPC 2.0 inspired request handler that provides the core API for ctxpkg. It exposes procedures for managing reference documents, collections, and system operations. The daemon runs this backend and exposes it via Unix socket.

## File Structure

| File | Purpose |
|------|---------|
| `backend.ts` | Main `Backend` class — request routing and lifecycle |
| `backend.protocol.ts` | JSON-RPC protocol types, error codes, procedure helpers |
| `backend.schemas.ts` | Zod schemas for all API parameters and responses |
| `backend.services.ts` | Service procedure implementations (business logic) |
| `backend.types.ts` | Type utilities for type-safe client usage |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Backend                              │
│  ┌─────────────────┐                                        │
│  │ handleRequest() │ ← raw JSON                             │
│  └────────┬────────┘                                        │
│           │ parse & validate                                │
│  ┌────────▼────────┐                                        │
│  │ #routeRequest() │ → "service.method" dispatch            │
│  └────────┬────────┘                                        │
│           │                                                 │
│  ┌────────▼────────────────────────────────────────────┐    │
│  │              BackendServices                        │    │
│  │  ┌────────────┐ ┌─────────────┐ ┌────────────────┐  │    │
│  │  │  documents │ │ collections │ │     system     │  │    │
│  │  └────────────┘ └─────────────┘ └────────────────┘  │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### Request Flow

1. Raw JSON arrives at `handleRequest()`
2. Request is parsed and validated against `requestSchema`
3. Method string (`"service.method"`) is split and routed
4. Procedure input is validated against its Zod schema
5. Handler executes and returns result or error

### Protocol Format

```typescript
// Request: { id, method: "service.method", params? }
// Success: { id, result }
// Error:   { id, error: { code, message, data? } }
```

Error codes are defined in `ErrorCodes` (e.g., `ParseError`, `MethodNotFound`, `InvalidParams`, `ServiceError`).

## Adding New Procedures

1. **Add schema** in `backend.schemas.ts`:

```typescript
const myNewParamsSchema = z.object({
  foo: z.string(),
  bar: z.number().optional(),
});
```

2. **Add procedure** in `backend.services.ts` under the appropriate service namespace:

```typescript
const myService = {
  myMethod: procedure(myNewParamsSchema, async (params): Promise<MyResult> => {
    const service = services.get(MyService);
    return service.doSomething(params);
  }),
};
```

3. **Export types** if needed from `backend.schemas.ts`.

## Key Patterns

### Procedure Definition

Use the `procedure()` helper for type-safe handlers:

```typescript
procedure(
  inputSchema,  // Zod schema for params
  async (params) => {  // Handler receives validated params
    return result;  // Return type is inferred
  }
);
```

### Service Access

Services are accessed via the dependency injection container:

```typescript
const docService = services.get(DocumentsService);
```

### Method Routing

Methods use `service.method` format — the Backend class splits this and looks up the procedure in `BackendServices`.

### Type-Safe Clients

The `BackendAPI` type in `backend.types.ts` converts procedures to function signatures. Use `GetBackendAPIParams` and `GetBackendAPIResponse` helpers to extract types for specific methods.
