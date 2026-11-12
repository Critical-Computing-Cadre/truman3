# Deploying

What it takes to run Truman 3 somewhere other than your laptop. [ADR 19](../adr/0019-how-truman-runs-in-production.md), [ADR 21](../adr/0021-the-api-has-its-own-login-and-admin-lives-under-a-path.md), and [ADR 23](../adr/0023-staging-runs-on-aws-from-cdk.md) explain why it's like this. To run it on AWS, see [Running it on AWS](#running-it-on-aws). [Cloud architecture](../cloud.md) describes each piece on AWS and how they connect.

## The pieces

```
  participants ── a community's domain ──┐
                                         ├── /        the participant app's built files
  researchers ─── an address you choose ─┤── /admin/  the admin app's built files
                                         └── /api     the API's container ── Postgres, S3
```

| Piece           | Comes from                                                               | Notes                                                                              |
| --------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| API             | `docker build -t truman3-api .`                                          | Listens on port 3000                                                               |
| Database update | The same image, run with `node packages/db/src/migrate-cli.ts`           | Run it once before each new API version, and let it finish before starting the API |
| Participant app | `pnpm --filter @truman3/participant build`, then `apps/participant/dist` | One build serves every domain                                                      |
| Admin app       | `pnpm --filter @truman3/admin build`, then `apps/admin/dist`             | Always served under `/admin/`. See below                                           |

Updating the database is safe to repeat, since each migration runs once. Don't run two at the same time.

## Where the admin app goes

One build works for all of these. You choose by where you send `/admin/*`, in your DNS and whatever serves the apps.

| You want                     | Send `/admin/*` on                                 | Researchers go to          |
| ---------------------------- | -------------------------------------------------- | -------------------------- |
| An address only for the lab  | `admin.yourlab.edu`, and redirect `/` to `/admin/` | `admin.yourlab.edu/admin/` |
| One address for everything   | The community's domain                             | `eatsnap.love/admin/`      |
| Some domains, and not others | Only the domains you pick                          | Whichever you picked       |

On a domain where `/admin/*` isn't sent anywhere, the participant app answers it and shows nothing about admin. Where it is sent, a participant gets the sign-in form, and the API refuses them (`apps/api/src/admin/shared-address.itest.ts`). The two apps use separate cookies. The cost of sharing an address is in ADR 21: a script running on a participant page could act as a researcher who's signed in on that browser.

## Two database logins

| Login        | Used by             | Can                                                                                 |
| ------------ | ------------------- | ----------------------------------------------------------------------------------- |
| The owner    | The database update | Everything. On RDS, this is the login the database was created with, or one like it |
| `truman_app` | The API             | Read and write rows. Only add to `events` and `assignments`. No changing tables     |

Run the update as the owner, with `DATABASE_APP_PASSWORD` set to the password the API should use. It creates `truman_app` if needed, and sets out what it can do after every migration, so new tables are covered. Then give the API `DATABASE_URL=postgres://truman_app:...`. In production, the API won't start if it's logged in as an owner.

- **Your Postgres logs could hold that password,** if it logs every statement, since setting a password is a statement. Leave `log_statement` off for the update.
- **Run command-line tools, such as `pnpm admin setup`, as `truman_app` too.** They only need what the API has.
- **Migrations need nothing extra.** Do not add grants to them; the update handles those.

Local development uses one login and skips all of this, unless the tests have already created `truman_app`, which is harmless. Tests connect as `truman_app` the way production does, so something that only works as the owner fails there.

## Check it on your own computer

```
pnpm check:container   # builds the image, updates an empty database twice, starts it, and asks it things
pnpm test:e2e:built    # every browser test against production builds, with the API in production mode
```

Both run in CI, and neither touches your development database.

## What serves the apps has to

1. **Send `/api/*` to the API, with the path unchanged.** The API handles the `/api` itself.
2. **Answer unknown paths with the right `index.html`,** so a page like `/join/eatsnap` or `/admin/studies/new` loads when opened directly. Under `/admin/` that's the admin app's.
3. **Redirect `/admin` to `/admin/`,** where the admin app is on that address.
4. **Pass the `Cookie` header and the request's method and body to the API,** and never cache `/api`.
5. **Use HTTPS.** Sign-in cookies are marked secure in production, so they don't work without it, except on `localhost`.
6. **Cache `assets/` for a long time, and `index.html` hardly at all.** File names under `assets/` change when their contents do.
7. **Leave query strings out of its access logs,** or turn those logs off. Study links carry recruitment IDs, such as `?PROLIFIC_PID=`, and those would otherwise end up in the logs.

## Settings for the API

Keep the real values out of the repo. `.env.example` describes these too.

| Setting                                    | Needed           | What it is                                                                                                                                                                                          |
| ------------------------------------------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                             | Yes              | The Postgres connection, as `truman_app`                                                                                                                                                            |
| `S3_REGION`, `S3_BUCKET`                   | Yes              | Media storage                                                                                                                                                                                       |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Not on AWS       | Both or neither. Without them, storage uses the container's role                                                                                                                                    |
| `S3_ENDPOINT`                              | Not on AWS       | For another S3-compatible service                                                                                                                                                                   |
| `MEDIA_PUBLIC_URL`                         | Yes              | Where browsers fetch media from, or `/` for the page's own address, which participant domains need. The stack sets `/`                                                                              |
| `PARTICIPANT_APP_URL`                      | Yes              | The participant address, for study links                                                                                                                                                            |
| `TRUMAN_SECRET_KEY`                        | For Prolific     | Encrypts Prolific tokens. Changing it means everyone connects again                                                                                                                                 |
| `ANTHROPIC_API_KEY`                        | For live writing | Lets Christof's actors write their own words with Claude. On AWS, store it by hand in Secrets Manager and name the secret in the stage's `anthropicKeySecret`. Without it, beats use fallback lines |
| `MAIL_FROM`, `MAIL_REGION`                 | For email        | The From address for email to researchers, on a domain verified in SES, and SES's region. Without it, no email is sent (ADR 72). See Email, below                                                   |
| `ADMIN_APP_URL`                            | No               | The admin app's address, for links in email. Defaults to `/admin/` beside `PARTICIPANT_APP_URL`                                                                                                     |
| `PARTICIPANT_DOMAINS`                      | No               | Domains a study can run at instead of `PARTICIPANT_APP_URL`, separated by commas (ADR 74). See Participant domains, below                                                                           |
| `PARTICIPANT_DOMAIN_DEFAULT`               | No               | The participant domain a study gets until its researcher chooses. Without it, `PARTICIPANT_APP_URL`. The stack sets the domain marked `default`                                                     |
| `HOSTED`                                   | No               | `true` for a hosted Truman, where labs apply (ADR 70). See `docs/guides/hosting.md`                                                                                                                 |
| `TRUSTED_PROXIES`                          | Behind proxies   | How many of your own proxies add to `X-Forwarded-For`. Staging has 2: CloudFront and the load balancer. Too many, and everyone looks like a proxy. Too few, and visitors can fake their address     |

The image sets `NODE_ENV=production`, which turns on secure cookies and the shorter error logs.

## Running it on AWS

`infra/` describes all of this in AWS CDK. Staging is in `infra/lib/stages.ts`, and **it isn't for real participants.** Building it asks AWS nothing, so `pnpm build`, then `pnpm --filter @truman3/infra synth`, works with no credentials, and CI runs it.

| What                   | Where                       | Why                                                                                      |
| ---------------------- | --------------------------- | ---------------------------------------------------------------------------------------- |
| CloudFront             | Everywhere                  | The one way in. Sends each path below where it goes                                      |
| `/*`, `/admin/*`       | A private S3 bucket         | The apps. `app-router.js` sends other paths to the right page                            |
| `/api/*`               | Load balancer, then API     | The balancer has no public address, and CloudFront reaches it privately                  |
| `/media/*`             | A private S3 bucket         | Study images, readable through CloudFront by anyone with the link. See ADR 25            |
| `/api/media/uploads/*` | The API, then S3            | What participants upload. The API checks who's asking, and CloudFront keeps no copy      |
| The API                | Fargate, in a public subnet | Its firewall lets in only the balancer. It can reach out, with no NAT gateway to pay for |
| Postgres               | RDS, in a private subnet    | Lets in only the API's firewall                                                          |
| Passwords and keys     | Secrets Manager             | Containers get them by reference, when they start                                        |

### Before the first deployment

These need a signed-in AWS profile. They only read.

```
aws ec2 describe-availability-zones --region us-east-1 --profile <profile> --query "AvailabilityZones[].[ZoneName,ZoneId]" --output text
aws ec2 describe-managed-prefix-lists --region us-east-1 --profile <profile> --filters Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing --query "PrefixLists[].PrefixListId" --output text
```

- **Zones.** CloudFront can't reach a private load balancer in `use1-az3`, and zone names mean different zones in each account. If either name in `stages.ts` is `use1-az3` in this account, pick another.
- **Prefix list.** It should print the ID in `truman-stack.ts`. If it's different, change it there.

### The first deployment

The API can't start until the database is updated, and the update's task has to exist first, so this goes in three steps. Run these from `infra/`, after `pnpm build` in the repo's root. Docker has to be running.

```
pnpm exec cdk bootstrap aws://<account>/us-east-1 --profile <profile>    # once per account
pnpm run deploy -c apiTasks=0 --profile <profile>                        # everything but the API
```

Then run the `UpdateDatabaseCommand` that printed, with `--profile`, and wait for it to finish. Its log is in `/truman3-staging/tasks`. Then start the API:

```
pnpm run deploy --profile <profile>
```

To create the first team, run the `AdminCommand` that printed, with `--profile` and this added:

```
--overrides '{"containerOverrides":[{"name":"task","command":["node","apps/cli/src/admin.ts","setup","<team name>","<team slug>","<email>","<name>"]}]}'
```

**The password appears in `/truman3-staging/tasks`.** That log is kept for one day, and anyone who can read logs in this account can read it. Copy it, and delete the log stream.

### Production

Production is the stage `production`, in its own account ([ADR 73](../adr/0073-production-stage.md)). Every command takes `-c stage=production` and `--profile truman-prod`. Staging's take neither, or `--profile truman`. Before its first deployment:

1. **The DNS zone** for truman-research.org exists in production, and the domain's name servers point to it. The certificate is checked through the zone, so the first deploy waits until it can be.
2. **The Claude key secret,** `truman3-production/anthropic-api-key`, is made, as in The Claude key, below.
3. **CDK is bootstrapped** in the account. That's done.

After it:

- **Subscribe to alerts:** run the command in the `AlertsTopic` output with your email, and confirm the email AWS sends.
- **Leave the SES sandbox** in production's account, as in Email, below.
- **Make yourself an operator** with the `AdminCommand`, as for the first team, with `"operator","<email>"`.

### Later deployments

If a change includes a migration, stop the API, update the database, and start it again, as above. If it doesn't, `pnpm run deploy --profile <profile>` is enough. CI doesn't deploy yet. [Cloud architecture](../cloud.md#when-a-change-includes-a-migration) says why it takes these steps.

**A deploy that widens access stops and asks.** `infra/cdk.json` sets `requireApproval: broadening`, so a change that adds an IAM permission or lets more through a firewall waits for you to type `y`. Read what it lists first. Anything you didn't expect is worth asking about.

The API's output is in `/truman3-staging/api`.

### The Claude key

Christof's actors write live only if the API has an Anthropic key (ADR 52). On AWS it's a secret you make by hand, so the key never passes through the repo or a deploy.

1. In the Secrets Manager console, in the stage's account and region, store a new secret as plain text: only the key, with no JSON around it.
2. Name it what the stage's `anthropicKeySecret` says. Staging's is `truman3-staging/anthropic-api-key`.
3. Deploy. The API's containers read it when they start.

Make the secret before the deploy that names it, or the API's containers can't start. To change the key later, update the secret, then start new containers, since running ones keep the old key:

```
aws ecs update-service --cluster truman3-staging --service truman3-staging-api --force-new-deployment --profile <profile>
```

To turn live writing off for a stage, remove `anthropicKeySecret` from it and deploy. Improvised beats then use their fallback lines.

### Email

Truman emails researchers: password resets, invitations to a team, and, on a hosted Truman, news about a lab's application (ADR 72). On AWS it sends through SES, from the domain in the stage's `mail`.

1. **Deploy.** The stack sets up the domain in SES, and prints three `MailDkimRecord` outputs, each a name and a value.
2. **Add the three as CNAME records** wherever the domain's DNS is kept. If that's Route 53 in another AWS account, add them there. SES checks them by itself within a few hours, and the domain then shows as verified in the SES console.
3. **Leave the SES sandbox.** At first, SES sends only to addresses verified in it, and at most 200 a day. In the SES console, under **Account dashboard**, request production access. AWS asks what the email is for, and answers within a day or so. For trying it out before then, verify your own address under **Identities**.

Until the domain is verified, sending fails quietly: the request goes on, and the API logs that the email wasn't sent.

### Participant domains

A study can run at a domain that doesn't say "research", such as eatsnap.love ([ADR 74](../adr/0074-participant-domains.md)). To offer one on a stage:

1. **Make a Route 53 zone for the domain in the stage's account,** by hand, like truman-research.org's.
2. **Point the domain's name servers at it,** wherever it's registered. Check the domain has no records you need first, or copy them into the new zone.
3. **Add it to the stage's `participantDomains`** in `infra/lib/stages.ts`, with the zone's ID. The stage also needs its own `domains` in a zone.
4. **Deploy.** The stack adds the domain to the certificate, which is checked through its zone, so the name servers have to have moved. It also points the domain at the distribution, and tells the API and the router.

Researchers then see **Participants go to** on the Studies page, for each study they can edit. On the domain, `/admin` and `/api/admin` answer 404. Mark one domain `default: true` and studies go there until a researcher chooses otherwise. Production does this with clikbrite.com.

### Costing less, and removing it

```
pnpm run deploy -c apiTasks=0 --profile <profile>                          # stops the API
aws rds stop-db-instance --db-instance-identifier <id> --profile <profile> # stops the database
```

RDS starts a stopped database again after 7 days, so this has to be repeated. The load balancer still costs money, and only removing everything stops that:

```
pnpm run destroy --profile <profile>
```

On staging this deletes the data too. A stage with `holdsRealData` on keeps its database, media, and secrets, and refuses to be deleted until someone turns its protection off.

## Reading production logs

An error looks like this, with no message, on purpose:

```
POST request failed: { name: 'Error', cause: { name: 'PostgresError', code: '23505', constraint: 'participants_unique' }, frames: [...] }
```

Look up the Postgres code, and reproduce it locally, where errors log in full. When you add logging, use `describeError` and don't log IDs, tokens, or request bodies. A log can't be cleaned when someone withdraws.

## Not ready yet

These are known gaps. Don't run real participants until they're closed.

- **Several domains.** The apps work on any domain, and a stage can list them with a certificate, but `PARTICIPANT_APP_URL` is one address, so every study's link uses it. A study needs its own address setting.
- **A restore checked on each stage.** [Restoring from a backup](restoring.md) says how. It's to be run on staging once `pnpm admin counts` is deployed there, and on production after its first deploy.
- **CI that deploys.** Deploys are run by hand, with the diff read first.
- **Before real participants on production:**
  - the terms and privacy policy, reviewed by the university
  - each lab's data encrypted with its own key, and the break-glass login
  - scanning participants' photos
- **Storage tries to create a missing bucket when starting.** On AWS the bucket is always there, so this does nothing.
