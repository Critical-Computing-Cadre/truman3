# Deploying

What it takes to run Truman 3 somewhere other than your laptop. The infrastructure code doesn't exist yet, so this describes the pieces and how to check them. [ADR 19](../adr/0019-how-truman-runs-in-production.md) and [ADR 21](../adr/0021-the-api-has-its-own-login-and-admin-lives-under-a-path.md) explain why they're like this.

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

| Setting                                                              | Needed                 | What it is                                                          |
| -------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------- |
| `DATABASE_URL`                                                       | Yes                    | The Postgres connection, as `truman_app`                            |
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
- **Several domains.** The apps work on any domain, but `PARTICIPANT_APP_URL` is one address, so every study's link uses it. A study needs its own address setting.
- **`TRUST_PROXY` reads the first address in `X-Forwarded-For`,** which a visitor can fake. Through CloudFront and a load balancer, it should count from the end. This affects rate limits, and the stored address for studies that opt in.
- **Backups, a tested restore, the infrastructure code, and CI that deploys.**
