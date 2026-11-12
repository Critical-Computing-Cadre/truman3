---

title: Run your own Truman
description: How to run Truman on your own computer, and what it takes to deploy it on your own servers or on AWS.
---

# Run your own Truman

Truman is open source, so you can run all of it yourself. This page starts with your own computer: by the end of the first section you'll have the API, both web apps, and the EatSnap example study running locally. After that, it covers what a real deployment needs, and the AWS deployment that comes with the repo.

## On your computer

You need two things installed:

- Node 24
- Something that runs Docker containers, such as Docker Desktop or OrbStack

Clone [the repo](https://github.com/Critical-Computing-Cadre/truman3), then run these from its folder:

```
corepack enable
pnpm install
cp .env.example .env
docker compose up --detach --wait
pnpm db:migrate
pnpm study import studies/examples/eatsnap
pnpm study launch eatsnap
pnpm dev
```

That's the whole setup. If you'd like to know what you just ran, here's what each step does:

| Command                             | What it does                                                                                                    |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `corepack enable`                   | Makes `pnpm` available, at the version the repo names                                                           |
| `cp .env.example .env`              | Creates your local settings. The defaults match the Docker services                                             |
| `docker compose up --detach --wait` | Starts Postgres 18 on port 5432, and SeaweedFS on port 8333 standing in for S3. Both listen only on `127.0.0.1` |
| `pnpm db:migrate`                   | Brings the database up to date                                                                                  |
| `pnpm study import ...`             | Saves the EatSnap example as a frozen version                                                                   |
| `pnpm study launch eatsnap`         | Opens it to participants                                                                                        |
| `pnpm dev`                          | Starts the API and both web apps                                                                                |

If `corepack enable` fails with a permission error, the repo's [README](https://github.com/Critical-Computing-Cadre/truman3/blob/main/README.md) has the fix.

### What opens where

Once `pnpm dev` is running, you have three addresses to try:

| Address                              | What it is                                                 |
| ------------------------------------ | ---------------------------------------------------------- |
| `http://localhost:5180/join/eatsnap` | The example study, as a participant sees it                |
| `http://localhost:5181/admin`        | The admin app, for researchers                             |
| `http://localhost:3000/health/ready` | The API. This route answers when it can reach its database |

Each web app forwards `/api` to the API on port 3000, so you never call port 3000 from a browser page yourself.

The admin app needs an account before you can sign in, so create a team and its first researcher:

```
pnpm admin setup "Your Lab" your-lab you@example.edu "Your Name"
```

It prints a password once, so copy it somewhere safe. Later on, `pnpm admin add` adds more people to a team, and `pnpm admin reset-password` gives someone a new password.

### Optional settings

`.env.example` explains every setting, so it's worth a skim. Two are worth knowing about early:

- `ANTHROPIC_API_KEY` lets the cast write its own lines with Claude, for studies that turn that on. Without it, those lines use the fallbacks the study wrote.
- `TRUMAN_SECRET_KEY` encrypts researchers' Prolific tokens. Without it, connecting to Prolific is turned off.

Locally, email to researchers is printed in the terminal.

## What a deployment needs

Running Truman for real means putting four pieces somewhere:

| Piece               | Comes from                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| The API             | The repo's `Dockerfile`. It listens on port 3000                                                 |
| The database update | The same image, run with `node packages/db/src/migrate-cli.ts` before each new API version       |
| The participant app | `pnpm --filter @truman3/participant build`, which writes static files to `apps/participant/dist` |
| The admin app       | `pnpm --filter @truman3/admin build`, which writes static files to `apps/admin/dist`             |

You also need Postgres and an S3-compatible bucket.

Whatever serves the apps has a few jobs to do:

- It sends `/api/*` to the API with the path unchanged.
- It answers unknown paths with the right `index.html`, so a link like `/join/eatsnap` loads when opened directly.
- It serves the admin app under `/admin/`.
- It uses HTTPS, since sign-in cookies are marked secure in production.
- It keeps query strings out of its access logs, because study links carry recruitment IDs.

The database has two logins, and the split matters. The owner runs the update. The API runs as `truman_app`, which can read and write rows but can only add to the event log, and can't change tables. In production, the API refuses to start if it's logged in as an owner.

You can check a production build on your own computer before deploying anything:

```
pnpm check:container
pnpm test:e2e:built
```

The first builds the API's image and checks it against an empty database. The second runs every browser test against production builds.

For the full list of settings, and each of these steps in detail, see [docs/guides/deploying.md](https://github.com/Critical-Computing-Cadre/truman3/blob/main/docs/guides/deploying.md).

::: warning Before you run real participants
Read the "Not ready yet" section of [docs/guides/deploying.md](https://github.com/Critical-Computing-Cadre/truman3/blob/main/docs/guides/deploying.md). It lists the known gaps.
:::

## The AWS deployment in the repo

If AWS is where you're headed, you don't have to work the above out yourself. The repo deploys itself to AWS with CDK. The code is in `infra/`, and everything is in one stack.

| What               | Where it runs                                                 |
| ------------------ | ------------------------------------------------------------- |
| The one way in     | CloudFront. It routes each path below                         |
| `/` and `/admin/`  | The apps' built files, in a private S3 bucket                 |
| `/api/*`           | An internal load balancer, then the API on ECS Fargate        |
| `/media/*`         | Study images, in a private S3 bucket                          |
| The database       | RDS Postgres, in a private subnet that only the API can reach |
| Passwords and keys | Secrets Manager. Containers get them when they start          |

What participants upload goes through the API, which checks who's asking. CloudFront can't read those files from the bucket.

A stage is one place Truman runs, and each one is described in `infra/lib/stages.ts`. The repo has a staging stage for trying things and a production stage for real participants, each in its own AWS account. A stage that holds real data keeps its database, media, and secrets when the stack is removed.

Deploys are run by a person, from `infra/`, after `pnpm build` at the repo's root:

```
pnpm run deploy --profile <profile>
```

CI doesn't deploy. A change that widens access, such as a new IAM permission, stops and asks before it goes ahead.

When a change includes a migration, a deploy takes three steps: deploy with the API stopped, run the database update as a one-off task, then deploy again to start the API. The first deployment works the same way. Plan for the gap, because the site's API is down between the first step and the last.

Building the stack asks AWS nothing, so you can try it with no credentials:

```
pnpm build
pnpm --filter @truman3/infra synth
```

For the commands, see [docs/guides/deploying.md](https://github.com/Critical-Computing-Cadre/truman3/blob/main/docs/guides/deploying.md). For how each piece connects and why, see [docs/cloud.md](https://github.com/Critical-Computing-Cadre/truman3/blob/main/docs/cloud.md).

## Hosting other labs

One Truman can serve more than one lab. Set `HOSTED=true` and labs can apply from the sign-in page. An operator approves them and sets their limits. [docs/guides/hosting.md](https://github.com/Critical-Computing-Cadre/truman3/blob/main/docs/guides/hosting.md) covers it.
