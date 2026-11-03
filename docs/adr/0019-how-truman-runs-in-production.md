# 19. How Truman runs in production

**Status:** Accepted. [ADR 21](0021-the-api-has-its-own-login-and-admin-lives-under-a-path.md) replaces what this says about the admin app's address.

## Decision

- **The API is one container,** which runs its TypeScript directly, as it does everywhere else (ADR 1). It keeps the workspace's layout, because Node won't run TypeScript from inside `node_modules`.
- **Updating the database is a separate run of the same image,** with `node packages/db/src/migrate-cli.ts`. The server never does it when starting.
- **The two apps are static files,** built once. A build names no address, so one build serves every domain.
- **The admin app has its own address, at the root path.** Neither app has a base path. Each one calls `/api` on the address it's on.
- **The API answers under `/api` itself,** as well as at bare paths, which health checks use. Nothing in between has to rewrite paths.
- **Production logs say what kind of error happened and where, and never its message.** See `apps/api/src/errors.ts`. Local development logs everything.
- **The server tells the admin app the participant address.** `/admin/studies` gives each study a `participantUrl`, and the server won't start in production without `PARTICIPANT_APP_URL`.

## Why

**Admin on its own address.** Participants see their study's address, and it's part of the cover story (the vault note "Deployment design," question 3). Dominic uses one domain per community, so `eatsnap.love/admin` would show a research tool on a study's own domain. Separate addresses also mean a researcher's cookie is never sent to a participant's page, and it's how development and the browser tests have always run, on two ports.

**`/api` in the API.** The alternative is a rewrite at the edge, such as a CloudFront Function. That's another piece to deploy and test, and every lab with a different setup would have to recreate it. The cost here is one line, in `createApp`, and development now forwards requests the same way production does.

**Error messages left out of logs.** Drizzle's error messages contain a query's parameters, and Postgres's contain column values. That includes recruitment IDs and session tokens. Hono's default handler would have written them all to the logs, where a withdrawal couldn't delete them. Scrubbing messages for known patterns would miss whatever we didn't think of, so they're left out. The cost is harder debugging in production: you get the error's kind, Postgres code, rule name, and place in the code, and reproduce it from there.

**The participant address at runtime.** It was a build setting that fell back to `localhost`, so a build could silently show researchers a broken study link. Each study has its own field, so giving studies their own domains later changes only the server.

## Alternatives

- **`/admin` on the participant address.** One address and one CDN setup, but it appears on every community's domain, and shares cookies with participants.
- **Compiling TypeScript for the image, or `pnpm deploy`.** A smaller image, but production would then run different files than everywhere else, to save little. Not worth it for now.
- **Migrating when the server starts.** Simple, but several containers starting together would all try it, and the server would need rights to change tables, which the separate database roles are meant to take away.

## Consequences

- Two addresses to set up per deployment, at least, plus one for each community domain.
- Whatever serves the apps has to send unknown paths to `index.html`, since these are single-page apps. `docs/guides/deploying.md` lists what it has to do.
- Errors thrown outside `createApp`, or logged directly with `console.error`, can still include values. New logging should go through `describeError`.
