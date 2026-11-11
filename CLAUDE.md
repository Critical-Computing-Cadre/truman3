# Truman 3

A social media simulation platform for research. Start with `docs/architecture.md` for the map, `docs/cloud.md` for how it runs on AWS, and `docs/adr/` for why things are the way they are.

## Commands

```
pnpm dev         # API on :3000, participant app on :5180, admin app on :5181/admin
                 # the example study is at http://localhost:5180/join/eatsnap
pnpm check       # format and lint (pnpm format to fix)
pnpm typecheck
pnpm test
pnpm test:integration   # tests named *.itest.ts; needs Docker services running
pnpm test:e2e           # a real browser through the whole example study; needs Docker services
pnpm test:e2e:built     # the same tests against production builds; needs Docker services
pnpm check:container    # builds the API's container and proves it works; needs Docker
pnpm db:migrate         # bring your database up to date
pnpm db:generate        # create a migration after changing packages/db/src/schema.ts
pnpm build
pnpm study validate <folder>   # check a study; see also: pnpm study convert
pnpm study test <folder>       # run its scenarios.yaml in a throwaway database; needs Docker services
pnpm study simulate <folder> [n]   # send n random simulated participants through it, and report; --personas a,b has a model play them; needs Docker services
pnpm study import <folder>     # save it as a frozen version
pnpm study launch <slug> [n]   # open it to participants; pnpm study stop closes it
pnpm study export <slug> <folder>   # write CSVs and a codebook
pnpm study withdraw <slug> <id> <your name> [reason]   # delete a participant's data
pnpm admin setup <team name> <team slug> <email> <name>   # create a team and its first researcher
pnpm admin operator <email>   # on a hosted Truman (HOSTED=true), let them approve labs; see docs/guides/hosting.md
pnpm admin counts   # how many rows the main tables have, to check a restored backup; see docs/guides/restoring.md
docker compose up --detach --wait   # local Postgres and S3-compatible storage
```

## How we work

People have to be able to follow and extend everything here, including students who join later and didn't see it being built.

- **Small pull requests.** Each one has a plain-language summary of what changed and why, and says how it was tested, including anything that wasn't.
- **Record decisions.** A choice someone might later question gets a short ADR in `docs/adr/`, with the alternatives considered.
- **Tests show intended behavior.** New behavior comes with tests. Run the real thing as well when a test can't cover it, such as a database connection.
- **Prefer boring, explicit code** over clever abstractions. Add a package or dependency when something needs it, not in advance.

## Code rules

- The API (`apps/api`) is the only path that changes study state. Participants, agents, and admin tools all go through it.
- Shared types and schemas live in `packages/core`, defined once with Zod.
- Events get written only through `recordEvent` in `packages/db`. New event types start in `packages/core/src/events.ts`.
- Migrations are never edited once merged. Rules Drizzle can't express, like triggers, go in a custom migration (`drizzle-kit generate --custom`).
- Relative imports include the `.ts` or `.tsx` extension. Node runs TypeScript directly (ADR 0001), so TypeScript features that need compiling, like `enum`, are not allowed.
- Secrets go in `.env`, which is not committed. New settings get added to `.env.example`.

## Credit

Truman was created by Dominic DiFranzo. Truman Agents is by Qian Yang and the Cornell DesignAI Group; keep its credit when using its ideas. If code is ported from an older Truman repo, keep its copyright notices, including the Hackathon Starter notice.
