# Deploying

What it takes to run Truman 3 somewhere other than your laptop. The infrastructure code doesn't exist yet, so this describes the pieces and how to check them. [ADR 19](../adr/0019-how-truman-runs-in-production.md) explains why they're like this.

## The pieces

```
  participants ── a community's domain ──┐
                                         ├── /      the app's built files
  researchers ─── the admin address ─────┤
                                         └── /api   the API's container ── Postgres, S3
```

| Piece           | Comes from                                                               | Notes                                                                              |
| --------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| API             | `docker build -t truman3-api .`                                          | Listens on port 3000                                                               |
| Database update | The same image, run with `node packages/db/src/migrate-cli.ts`           | Run it once before each new API version, and let it finish before starting the API |
| Participant app | `pnpm --filter @truman3/participant build`, then `apps/participant/dist` | One build serves every domain                                                      |
| Admin app       | `pnpm --filter @truman3/admin build`, then `apps/admin/dist`             | Gets its own address, not a path                                                   |

Updating the database is safe to repeat, since each migration runs once. Don't run two at the same time.

## Check it on your own computer

```
pnpm check:container   # builds the image, updates an empty database twice, starts it, and asks it things
pnpm test:e2e:built    # every browser test against production builds, with the API in production mode
```

Both run in CI, and neither touches your development database.

## What serves the apps has to

1. **Send `/api/*` to the API, with the path unchanged.** The API handles the `/api` itself.
2. **Answer unknown paths with `index.html`,** so a page like `/join/eatsnap` loads when opened directly.
3. **Pass the `Cookie` header and the request's method and body to the API,** and never cache `/api`.
4. **Use HTTPS.** Sign-in cookies are marked secure in production, so they don't work without it, except on `localhost`.
5. **Cache `assets/` for a long time, and `index.html` hardly at all.** File names under `assets/` change when their contents do.
6. **Leave query strings out of its access logs,** or turn those logs off. Study links carry recruitment IDs, such as `?PROLIFIC_PID=`, and those would otherwise end up in the logs.

## Settings for the API

Keep the real values out of the repo. `.env.example` describes these too.

| Setting                                                              | Needed                 | What it is                                                          |
| -------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------- |
| `DATABASE_URL`                                                       | Yes                    | The Postgres connection                                             |
| `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Yes                    | Media storage                                                       |
| `S3_ENDPOINT`                                                        | Not on AWS             | For another S3-compatible service                                   |
| `MEDIA_PUBLIC_URL`                                                   | Yes                    | Where browsers fetch media from                                     |
| `PARTICIPANT_APP_URL`                                                | Yes                    | The participant address, for study links                            |
| `TRUMAN_SECRET_KEY`                                                  | For Prolific           | Encrypts Prolific tokens. Changing it means everyone connects again |
| `TRUST_PROXY`                                                        | Behind a load balancer | Set to `true` so addresses come from `X-Forwarded-For`              |

The image sets `NODE_ENV=production`, which turns on secure cookies and the shorter error logs.

## Reading production logs

An error looks like this, with no message, on purpose:

```
POST request failed: { name: 'Error', cause: { name: 'PostgresError', code: '23505', constraint: 'participants_unique' }, frames: [...] }
```

Look up the Postgres code, and reproduce it locally, where errors log in full. When you add logging, use `describeError` and don't log IDs, tokens, or request bodies. A log can't be cleaned when someone withdraws.

## Not ready yet

These are known gaps. Don't run real participants until they're closed.

- **AWS credentials.** Storage requires an access key today, and should use the container's role on AWS. It also tries to create a missing bucket when starting.
- **Private media.** Anyone with the link can read an uploaded photo.
- **Separate database roles.** The API and the database update use the same login.
- **Several domains.** The apps work on any domain, but `PARTICIPANT_APP_URL` is one address, so every study's link uses it. A study needs its own address setting.
- **`TRUST_PROXY` reads the first address in `X-Forwarded-For`,** which a visitor can fake. Through CloudFront and a load balancer, it should count from the end. This affects rate limits, and the stored address for studies that opt in.
- **Backups, a tested restore, the infrastructure code, and CI that deploys.**
