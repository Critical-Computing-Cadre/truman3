# 3. Hono API with Zod and OpenAPI

**Status:** Accepted

## Decision

The API uses Hono. Routes are defined with Zod schemas, and the OpenAPI spec is generated from them at `/openapi.json`.

## Why

Hono is small and readable, and runs in a container or on Lambda, which keeps both hosting options open. Each route's schema validates its data, documents it, and provides its types, so those can't drift apart. The spec lets us generate clients for other languages, such as Python, and gives agents a precise description of the API.

## Alternatives

- **Express:** familiar from older Truman versions, but it has no built-in validation or spec generation.
- **tRPC:** a good fit within TypeScript, but it's awkward for clients in other languages, and outside agents need to connect.
- **Fastify:** a solid option, but more tied to long-running servers than Hono.
