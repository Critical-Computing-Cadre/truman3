# 86. A deploy updates the database itself, and the API keeps running

## Context

A change with a migration took three steps: deploy with the API stopped, run the database update by hand, deploy again to start the API ([cloud architecture](../cloud.md), as it was). The reasoning was sound: the old API can't be trusted on new tables, nor the new API on old ones, so nothing ran in between.

It cost more than it looked. Production's API was down for ten to thirty-five minutes each time, depending on how fast the person at the terminal noticed each step had finished. Four migrations went out in two days that way. Each one needed someone at a terminal to run commands in the right order and say when each had finished. With real participants in a study, a ten-minute gap ends sessions and loses data.

Every one of those migrations only added things: a table, a column, a row's worth of new values. The old API would have run on the new tables without noticing.

## Decision

- **The deploy runs the database update, and waits for it.** The stack has a custom resource whose function (`infra/lib/run-database-update.cjs`) starts the update's task and watches it to the end. It runs again whenever the API's image changes.
- **The API's service waits for that resource.** So CloudFormation's order is: the update's task gets the new image, the update runs, and only then is the API replaced. ECS starts the new API beside the old one and stops the old one once the new one is healthy, as it always has.
- **A failed update fails the deploy.** Nothing after it happens, and the old API carries on with the tables it knows. A migration runs in one transaction, so a failed one leaves nothing behind.
- **A migration may only add things.** For a minute or two the old API runs on the new tables. A test (`packages/db/src/migration-safety.test.ts`) fails if a migration after 0063 drops, renames, or retypes something, makes a column required, or adds a required column with no default.
- **Taking something away is two releases.** One stops the code using it. The next drops it.
- **There's a way out for the rare migration that can't be split.** It carries a line starting `-- stop-the-api:` with its reason, and is deployed with the API stopped first. The cloud architecture page has the steps.
- **The function can do one thing.** Its role may start that one task in that one cluster, see how tasks in the cluster went, and hand the task its two roles. Nothing else.

## Alternatives considered

- **The API updates the database as it starts.** One step, and what most small apps do. But the API's login can't change tables, on purpose (ADR 21), and two containers starting together would both try. Giving the API the owner's login to save a step undoes the thing that login separation is for.
- **A script that runs the three steps for you.** It removes the mistakes, not the downtime, and it only helps whoever runs the script. A deploy from CI would need its own.
- **Run the update only when the migrations change,** by keying the resource on a hash of the migrations folder. It saves about a minute on deploys with no migration. But the resource has to name the task's new revision to run the right image, and naming it is what makes it run. Running every time also means the API's rights are set out again on every deploy, which is simpler to reason about.
- **AWS's framework for waiting on a slow resource,** which polls from a Step Functions state machine. It allows more than 15 minutes. It also adds a state machine and three more functions with their own permissions. A migration that takes more than 13 minutes on this data would be a problem in itself.
- **A second database, switched over** (blue/green). It handles changes that aren't additive. It costs a second database, and the data written to the old one during the switch has to go somewhere. Far more than this needs.

## Consequences

- **One `pnpm run deploy`, migration or not,** and the site stays up. The first deployment to a new account is one step too.
- **A deploy with a new image takes about a minute longer,** for the update task to start, find nothing or something to do, and stop.
- **A migration can't be written carelessly.** The test says so before it's merged, and its message says what to do instead.
- **The test reads SQL with patterns, so it can be wrong both ways.** It can miss a change that breaks the old API, such as a new unique index the old code's writes don't satisfy, or a data change the old code undoes. A reviewer still has to ask what the old API does on the new tables. And it can flag something harmless, which the `-- stop-the-api:` line or a clearer statement gets past.
- **Rolling back the code doesn't roll back the tables.** If the new API fails its health check, ECS goes back to the old one, on the new tables. That's the same additive rule doing its job.
- **`-c apiTasks=0` is still there,** for saving money and for a restore.
- **A deploy now needs Lambda and one more role.** The first deploy with this asks for approval, because it adds permissions.
- **Not yet proved with a slow migration.** Adding a column to a large table briefly locks it. On this data that's milliseconds. A long backfill should be its own migration, in batches.
