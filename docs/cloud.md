# Cloud architecture

How Truman 3 runs on AWS today. There's one stage, **staging**, which has no real participants. Everything here is written in AWS CDK in `infra/`, so this page describes that code. [Deploying](guides/deploying.md) has the commands to run. [Architecture](architecture.md) describes the application itself.

Why it's built this way is in [ADR 19](adr/0019-how-truman-runs-in-production.md) (the container and static apps), [ADR 21](adr/0021-the-api-has-its-own-login-and-admin-lives-under-a-path.md) (two database logins, and admin under `/admin/`), [ADR 23](adr/0023-staging-runs-on-aws-from-cdk.md) (staging on AWS), and [ADR 25](adr/0025-participant-photos-go-through-the-api.md) (what participants upload).

## The files

| File                             | What it is                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| `infra/bin/truman.ts`            | What `cdk` runs. Picks the stage, checks the apps are built, and reads `-c apiTasks`        |
| `infra/lib/stages.ts`            | Each place Truman runs, and what differs between them. Only `staging` exists                |
| `infra/lib/truman-stack.ts`      | Everything in one stack: network, database, buckets, CloudFront, the API, and one-off tasks |
| `infra/lib/app-router.js`        | A CloudFront Function that sends each app's paths to the right `index.html`                 |
| `infra/lib/truman-stack.test.ts` | Checks the stack: what's reachable, where secrets go, what's logged, and what's kept        |
| `infra/cdk.json`                 | How `cdk` runs it, including `requireApproval: broadening`                                  |
| `Dockerfile`, `.dockerignore`    | The API's image                                                                             |

Building the stack asks AWS nothing. The account, region, zones, and CloudFront's prefix list are written in the code, so `pnpm --filter @truman3/infra synth` works with no credentials, and CI runs it.

## The whole picture

```mermaid
flowchart TB
  browser([Participants and researchers])

  subgraph edge [CloudFront, the one way in]
    router[app-router function]
  end

  subgraph s3 [S3, both private]
    apps[(Apps bucket<br/>participant app at /<br/>admin app at /admin/)]
    media[(Media bucket<br/>media/ study images<br/>uploads/ participants' photos)]
  end

  subgraph vpc [VPC, two zones, no NAT gateway]
    subgraph private [Private subnets: no route to the internet]
      alb[Load balancer, internal]
      rds[(RDS Postgres 18)]
    end
    subgraph public [Public subnets]
      api[API on Fargate]
      tasks[One-off tasks:<br/>update-database, admin]
    end
  end

  secrets[[Secrets Manager]]
  logs[[CloudWatch Logs]]

  browser -- HTTPS --> edge
  edge -- "/* and /admin/*" --> apps
  edge -- "/media/*" --> media
  edge -- "/api/*, through a VPC origin" --> alb
  alb -- port 3000 --> api
  api --> rds
  tasks --> rds
  api -- read, write, delete --> media
  secrets -. when a task starts .-> api
  secrets -. when a task starts .-> tasks
  api -.-> logs
  tasks -.-> logs
  edge -.-> logs
```

There's one address for everything. Staging has no domain of its own, so it's CloudFront's `*.cloudfront.net` address, printed as `Address` after a deploy.

## Networking

- **One VPC across two zones** (`us-east-1a` and `us-east-1b`). Each zone has a public subnet and a private one.
- **Private subnets have no route to the internet** at all. The load balancer and database are there.
- **There's no NAT gateway.** It would cost more than the API does. So the API's containers sit in a public subnet, with a public address, so they can reach AWS services and Prolific.
- **Firewalls (security groups) do the protecting:**

| Firewall           | Lets in                                | Notes                                                                                                         |
| ------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `BalancerFirewall` | CloudFront's addresses, on port 80     | From AWS's prefix list for CloudFront (`pl-3b927c52` in us-east-1). No other outbound traffic than to the API |
| `ApiFirewall`      | Only the load balancer, on port 3000   | Used by the API and by the one-off tasks. A test checks nothing else gets in                                  |
| The database's     | Only `ApiFirewall`, on Postgres's port | So the API and the one-off tasks can reach it, and nothing else                                               |

**Why the zones are written down:** CloudFront can't reach a private load balancer in the zone `use1-az3`, and zone names like `us-east-1a` map to different zones in each AWS account. [Deploying](guides/deploying.md#before-the-first-deployment) says how to check them.

## CloudFront and how paths are routed

CloudFront holds the apps, the API, and media at one address, so cookies and links work the way ADR 19 and ADR 21 expect. It redirects HTTP to HTTPS everywhere.

| Path                   | Goes to                              | Cached      | Notes                                                                            |
| ---------------------- | ------------------------------------ | ----------- | -------------------------------------------------------------------------------- |
| `/api/*`               | The load balancer, then the API      | Never       | Every method. Passes all headers, cookies, and the query                         |
| `/media/*`             | The media bucket                     | Yes         | Study images. Adds security headers, since media shares an address with the apps |
| `/admin`               | Nothing: redirects to `/admin/`      |             | Done by `app-router.js`                                                          |
| `/admin/assets/*`      | The apps bucket                      | Yes, a year | The admin app's built files. Names change when contents do                       |
| Any other `/admin/...` | The apps bucket's `admin/index.html` | No          | So `/admin/studies/new` loads when opened directly                               |
| `/assets/*`            | The apps bucket                      | Yes, a year | The participant app's built files                                                |
| Anything else          | The apps bucket's `index.html`       | No          | So `/join/eatsnap` loads when opened directly                                    |

- **`/api/media/uploads/*`** is under `/api/*`, so what participants upload always goes through the API, which checks who's asking. CloudFront can't read `uploads/` in the bucket at all.
- **The router is a CloudFront Function, not custom error pages.** Error pages apply to the whole distribution, so they'd turn the API's real 403s and 404s into a web page.
- **The cache key for the apps leaves out the query,** so a recruitment ID in a study link never reaches S3.
- **CloudFront reaches the load balancer through a VPC origin,** a private connection into the VPC. That's why the load balancer needs no public address and no certificate. Traffic from CloudFront to it is HTTP, inside AWS.
- **Price class 100,** the cheapest set of CloudFront's locations.
- **Domains are optional.** A stage can list `domains` with a certificate in us-east-1. Staging has none.

## Storage buckets

Both buckets block all public access, are encrypted, and refuse requests that aren't HTTPS.

| Bucket | Holds                                                                                    | Who can read it                                                          |
| ------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Apps   | The two apps' built files. Participant app at the root, admin app under `admin/`         | CloudFront, through origin access control                                |
| Media  | `media/<hash>`: study images. `uploads/<world>/<participant>/`: what participants upload | CloudFront, only `media/*`. The API's task role: read, write, and delete |

- **A deploy copies the apps' files in two steps.** First `assets/`, cached for a year. Then `index.html`, marked not to cache, and CloudFront is told to drop its copy. So a browser never gets an `index.html` whose files aren't there yet.
- **Old built files are kept** (`prune: false`), for anyone who already has the page open.
- **Storage uses the container's role.** The API is given no S3 keys, so the AWS SDK finds credentials itself.

## The API and one-off tasks (ECS on Fargate)

The image is built from the repo's `Dockerfile` by `cdk deploy`, on the computer running it, for `linux/arm64`. It holds `apps/api`, `apps/cli`, `packages/*` except `ui`, and `studies/starters`. `.dockerignore` lists only what's needed, so `.env` can't get in. Node runs the TypeScript directly, and the image sets `NODE_ENV=production`.

One ECS cluster, `truman3-staging`, runs three task definitions from that image. Each is ARM64, with 0.25 vCPU and 512 MB on staging (`apiCpu`, `apiMemoryMb`).

| Task definition                   | Runs                                           | Database login | Secrets it gets                                  | Logs to                  |
| --------------------------------- | ---------------------------------------------- | -------------- | ------------------------------------------------ | ------------------------ |
| `truman3-staging-api`             | `node apps/api/src/server.ts`, as a service    | `truman_app`   | App password, `TRUMAN_SECRET_KEY`, Anthropic key | `/truman3-staging/api`   |
| `truman3-staging-update-database` | `node packages/db/src/migrate-cli.ts`, by hand | `truman_owner` | Owner password, app password                     | `/truman3-staging/tasks` |
| `truman3-staging-admin`           | `node apps/cli/src/admin.ts`, by hand          | `truman_app`   | App password                                     | `/truman3-staging/tasks` |

### The API service

- **`apiTasks` containers** run, one on staging. `-c apiTasks=0` on a deploy stops them.
- **In a public subnet with a public address,** behind `ApiFirewall`.
- **The load balancer** listens on port 80 and checks `/health/ready` every 30 seconds. That route answers only when the API can reach its database.
- **Deploys replace containers one by one.** A new container has to be healthy before the old one stops (minimum 100%, maximum 200%). If new ones keep failing, ECS rolls back to the last version that worked.
- **Its settings** are `DATABASE_HOST`, `DATABASE_PORT`, `S3_REGION`, `S3_BUCKET`, `MEDIA_PUBLIC_URL` and `PARTICIPANT_APP_URL` (both the CloudFront address), and `TRUSTED_PROXIES=2` (CloudFront, then the load balancer).

### The one-off tasks

- **They're run by hand** with `aws ecs run-task`. A deploy prints each command, as `UpdateDatabaseCommand` and `AdminCommand`.
- **They use the API's subnets and firewall,** with a public address so they can pull the image and read secrets.
- **The database update is the only thing that gets the owner's login.**
- **The admin task creates teams and researchers.** The database has no route from outside, so this has to run inside. `pnpm admin setup` prints the first password, so the tasks' logs are kept for only one day.
- **Neither one-off task has storage settings.** On staging, studies are made, launched, exported, and withdrawn from in the admin app, not with `pnpm study`.

### How a container gets its database address

The app reads one setting, `DATABASE_URL`. Secrets Manager holds only the password, so each container's entry point puts the address together when it starts:

```
postgres://<login>:<password from a secret>@<DATABASE_HOST>:<DATABASE_PORT>/truman?sslmode=require
```

Storing a whole address as a secret would keep the password in two places, and one would go stale if it were changed. Generated passwords leave out characters that would need escaping in an address.

## The database

- **RDS for PostgreSQL 18**, `db.t4g.micro`, 20 GB of gp3 storage, in the private subnets.
- **One zone** (`multiAz: false`). This is set in the stack, not per stage.
- **Encrypted storage, and no public access.** Connections are encrypted (`sslmode=require`), but don't check the server's certificate. That needs the RDS certificate bundle in the image (ADR 23).
- **Automatic backups for 7 days** (`backupDays`). Nobody has tested a restore yet.
- **The database is called `truman`.**

### Logins and roles

ADR 21 explains why there are two.

| Login          | Made by                                                                                                     | Used by                    | Can                                                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `truman_owner` | RDS, when the database is created. Its password is in `truman3-staging/database-owner`                      | The database update only   | Everything. Owns the tables                                                                                          |
| `truman_app`   | The database update, the first time it runs, with the password from `truman3-staging/database-app-password` | The API and the admin task | Read and write rows. Only add to `events` and `assignments`. No changing tables, truncating, or turning off triggers |

- **After every migration, the update starts `truman_app`'s rights from nothing** and grants them again, so a new table is always covered (`packages/db/src/app-role.ts`). It also sets its password each time.
- **Withdrawal is the one way `truman_app` can delete events,** through `delete_participant_data`, which runs with its owner's rights.
- **The API won't start in production if it's logged in as an owner,** so a wrong setting shows up at once.

## Secrets

Each secret reaches a container by reference, when the container starts. None is ever a plain setting, and none is in the repo or a CloudFormation template.

| Secret                                  | Made by            | What it is                                                                                                | Given to                    |
| --------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------- | --------------------------- |
| `truman3-staging/database-owner`        | The stack, for RDS | The owner's login, as JSON with a username and password                                                   | The database update         |
| `truman3-staging/database-app-password` | The stack          | `truman_app`'s password, 40 letters and numbers                                                           | The API, both one-off tasks |
| `truman3-staging/truman-secret-key`     | The stack          | `TRUMAN_SECRET_KEY`, 43 characters that read as 32 bytes of base64. Encrypts researchers' Prolific tokens | The API only                |
| `truman3-staging/anthropic-api-key`     | A person, by hand  | `ANTHROPIC_API_KEY`, so Christof's actors can write live with Claude                                      | The API only                |

- **The Anthropic key is made by hand** in the staging account, in us-east-1, so the key never passes through the repo or a deploy. The stage names it in `anthropicKeySecret`. Leave that out, and improvised beats use their fallback lines.
- **ECS reads secrets when a container starts.** Changing one means starting new containers. [Deploying](guides/deploying.md#the-claude-key) has the commands.
- **Changing `TRUMAN_SECRET_KEY` means every researcher connects Prolific again.**

## Logs

| Log group                | What                                                                                | Kept      |
| ------------------------ | ----------------------------------------------------------------------------------- | --------- |
| `/truman3-staging/api`   | The API's output                                                                    | Two weeks |
| `/truman3-staging/tasks` | The database update and the admin task, including a new researcher's first password | One day   |
| `truman3-staging-edge`   | CloudFront's access logs, as JSON                                                   | Two weeks |

- **Logs can't be cleaned when someone withdraws,** so they're kept short and hold as little as possible.
- **The API logs what kind of error happened and where,** never its message ([Deploying](guides/deploying.md#reading-production-logs)).
- **CloudFront's logs list the fields they keep** (`EDGE_LOG_FIELDS` in `truman-stack.ts`). Left out: the path and query (they can hold a username or a recruitment ID), the viewer's address, the referrer, and cookies. So a log says which part of the site failed, but not which page.
- **The load balancer keeps no logs,** since they'd hold whole addresses. A test checks this.

## What else the stack makes

- **IAM roles.** The API's task role can read, write, and delete in the media bucket. Each task's execution role can pull the image, write its logs, and read its own secrets. CDK writes these from the code.
- **Small Lambda functions of CDK's own,** for copying the apps' files into their bucket and emptying buckets when the stack is removed.
- **Tags** on everything: `Project=truman3`, `Stage=staging`, and `RealParticipants=no`.
- **Outputs:** `Address`, `AdminAddress`, `UpdateDatabaseCommand`, and `AdminCommand`.

## How a deploy works

Deploys are run by a person, from `infra/`, with an AWS profile signed in. CI doesn't deploy. [Deploying](guides/deploying.md#running-it-on-aws) has the exact commands.

### A deploy, step by step

1. **`pnpm build`** at the repo's root builds both apps into `apps/*/dist`. `infra/bin/truman.ts` refuses to run without them.
2. **`pnpm run deploy --profile <profile>`** runs `cdk deploy --no-lookups`. CDK:
   - builds the stack into a CloudFormation template, asking AWS nothing
   - builds the API's image with Docker, and sends it to the image repository `cdk bootstrap` made
   - sends the apps' built files to the bucket `cdk bootstrap` made
   - stops to ask, if the change widens anyone's access (see below)
   - hands the change to CloudFormation, which updates each piece
3. **ECS starts the new API containers,** waits for the load balancer to call them healthy, and then stops the old ones.
4. **The apps' new files are copied,** `assets/` first, then each `index.html`, and CloudFront drops its copies of those.

### When a change includes a migration

A migration changes the database's tables. The API's code expects its own version of them, so the old API can't run on the new tables, and the new API can't run on the old ones. Migrations run in their own task, never when the API starts (ADR 19), and that task runs the image from the last deploy. So it takes three steps:

| Step                                                      | Why                                                                                                                                                                                     |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. `pnpm run deploy -c apiTasks=0`                        | Sends the new image, so the update task has the new migrations. Stops every API container, so nothing uses the database while it changes, and no new container starts on the old tables |
| 2. Run `UpdateDatabaseCommand`, and wait for it to finish | Runs the migrations as the owner, then sets out `truman_app`'s rights again. Check `/truman3-staging/tasks` for "Database is up to date."                                               |
| 3. `pnpm run deploy`                                      | `apiTasks` goes back to what `stages.ts` says, and the new API starts on the new tables                                                                                                 |

- **The site is partly down in between.** The apps still load from S3, but `/api` has nothing behind it.
- **The first deploy works the same way.** The API can't start before the update has created `truman_app`, and the update's task doesn't exist until the first deploy has made it.
- **Without a migration,** step 2 isn't needed, and one deploy is enough.
- **Updating the database is safe to repeat.** Each migration runs once. Don't run two updates at the same time.

ADR 23 lists running migrations automatically as the eventual aim, once CI deploys. By hand, each step is visible while we learn what a deployment does.

### Why some deploys ask for approval

`infra/cdk.json` sets `"requireApproval": "broadening"`. When a deploy would widen access, such as adding an IAM permission or a firewall rule that lets more in, `cdk deploy` shows the change and waits for someone to type `y`. Other deploys go ahead without asking.

- **This needs a person at a terminal.** A deploy that widens access can't run unattended.
- **Read what it shows before saying yes.** An unexpected new permission is the thing to catch.

## Staging and production

The code has one switch for this: `holdsRealData` on a stage. Only `staging` is defined, with it off. The tests build a stage with it on, to check it, but no such stage exists yet.

| With `holdsRealData`                          | Off (staging)                        | On                                                                                                   |
| --------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| When removed: database, media bucket, secrets | Deleted, with their backups          | Kept                                                                                                 |
| Deletion protection on the database and stack | Off                                  | On                                                                                                   |
| Media bucket                                  | Not versioned                        | Versioned. Old versions expire after 7 days, so a deleted file doesn't outlast a withdrawal for long |
| Description and `RealParticipants` tag        | "For testing. No real participants." | "Holds real participants' data."                                                                     |

The apps bucket and the logs are deleted with the stack either way. They hold nothing that can't be made again.

Other settings in `Stage` (zones, sizes, `apiTasks`, storage, backups, the Anthropic secret, and domains) are chosen per stage. Everything else in `truman-stack.ts` is the same for every stage, including the single-zone database and how long logs are kept.

**Before real participants,** [Deploying](guides/deploying.md#not-ready-yet) lists what's still missing: an address per study, a tested restore, and CI that deploys.

## Removing it, and costing less

- **`-c apiTasks=0`** stops the API containers. Stopping the database by hand saves more, though RDS starts it again after 7 days.
- **The load balancer costs money while it exists.** Only removing the stack stops that.
- **`pnpm run destroy`** removes staging and everything in it. A stage with `holdsRealData` refuses until someone turns its protection off, and keeps its data.
