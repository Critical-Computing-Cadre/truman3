# 1. TypeScript monorepo, run without a build step

**Status:** Accepted

## Decision

All code is TypeScript in one repo, using pnpm workspaces. The API runs on Node directly, using Node 24's built-in TypeScript support. Vite builds the web apps. `pnpm -r` runs scripts across packages.

## Why

One language across the front end, API, and agents means a student only has to learn one, and types are shared rather than duplicated. One repo means a single change can touch the schema, API, and UI together. With no build step on the server, the code that runs is the code you read.

## Alternatives

- **Separate repos:** shared types would need publishing and versioning.
- **Python for agents:** familiar to many researchers, but it splits the codebase. Outside agents in any language can still connect through the API.
- **Turborepo or Nx:** their caching isn't needed at this size. Easy to add later.
- **`tsx` or a compile step:** an extra tool Node no longer requires.

## Costs

Relative imports need file extensions, and TypeScript features that need compiling (like `enum`) are not allowed.
