# 2. React with Vite, not Next.js

**Status:** Accepted

## Decision

The participant and admin apps are client-side React apps built with Vite. They talk to the API over HTTP.

## Why

These apps sit behind a study link or a login, so they don't need search indexing or server rendering. Keeping all server logic in the API means there is one back end, used the same way by web apps, a mobile app, and agents.

## Alternatives

- **Next.js:** its server rendering and server components add a second kind of back end we don't need. Dominic also prefers to avoid it.
- **Keeping Pug with front-end scripts:** this is what made the older codebases hard to maintain.
