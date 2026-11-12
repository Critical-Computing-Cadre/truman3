# 73. The production stage

## Context

Staging has run Truman 3 on AWS since ADR 23, with no real participants. A hosted Truman (ADRs 70–72) needs a production stage for other labs' real participants.

The `Hosted Truman design` vault note set out what production needs:
- its own domain
- backups that can be restored
- alerts
- room to grow

Dominic chose a separate AWS account for production. He also registered truman-research.org, whose DNS was in another account, Social Design Lab's.

## Decision

- **Production is its own AWS account,** `truman3-production`, in Social Design Lab's AWS Organization, beside `truman3-staging`. A mistake or a leaked login in staging can't reach real participants' data. Each account has its own bill, and its own SES sandbox to leave.
- **truman-research.org's DNS lives in production.**
  - The Route 53 zone was made by hand in production, like the Claude key secret, so removing a stack never takes the domain with it. The domain's registration stays in Social Design Lab, with its name servers pointing at that zone.
  - Staging's email records are in the same zone, added by hand. They're the only records there that no stack makes.
- **The stack makes its own certificate and records** when a stage names a zone in its account (`domains.hostedZone`).
  - It makes a certificate checked by DNS, and an A and an AAAA record for each address.
  - It adds the email domain's DKIM records, when the email domain is the zone.
  - A stage can still name a certificate made by hand (`domains.certificateArn`), as before.
- **Production answers at `app.truman-research.org`.** truman-research.org itself is kept for the public site. Participants' own addresses, such as a neutral domain for each study, come in a later PR.
- **Production's settings** (`infra/lib/stages.ts`):

  | Setting           | Value                                                                                                                           |
  | ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
  | Real data         | `holdsRealData`, so the database, media, and secrets are kept if the stack is removed, and the database has deletion protection |
  | Backups           | 30 days                                                                                                                         |
  | Database          | `db.t4g.small`, with twice a micro's memory                                                                                     |
  | API               | 1 vCPU, as on staging since ADR 69                                                                                              |
  | Hosted            | Yes                                                                                                                             |
  | Email             | From truman-research.org                                                                                                        |
  | Claude key secret | `truman3-production/anthropic-api-key`, made by hand before the first deploy                                                    |

- **Alerts go to an SNS topic the stack makes,** `truman3-production-alerts`:

  | Alarm           | Raised when                                                   |
  | --------------- | ------------------------------------------------------------- |
  | `api-errors`    | More than 10 server errors in 5 minutes                       |
  | `api-slow`      | The slowest 5% of requests take over a second, for 15 minutes |
  | `api-down`      | No healthy API for 10 minutes                                 |
  | `api-busy`      | The API's CPU is over 85% for 15 minutes                      |
  | `database-busy` | The database's CPU is over 80% for 15 minutes                 |
  | `database-full` | The database has under 2 GB free                              |
  - A monthly budget ($150) warns at 80% spent, and when the month is forecast to go over.
  - People are subscribed to the topic by hand, so nobody's email is in this public repo.
  - `api-down` is left out while the API is stopped on purpose for a database update.
  - Staging has no alerts.
- **Restoring is checked, not assumed.** `docs/guides/restoring.md` restores the newest backup to a temporary database, beside the live one. Then `pnpm admin counts`, run against each, compares how many rows the main tables have, without showing what's in them. Then the copy is deleted.

## Alternatives

- **Production in staging's account.** It's simpler, with one login and one bill. But staging is where things are tried, often by people and agents with broad access, and AWS recommends keeping production apart.
- **The DNS zone in Social Design Lab's account,** where the domain is registered. Then each stack couldn't add its own records, and every new address would wait for someone with that account.
- **The DNS zone made by the production stack.** Then removing the stack, even by mistake, would take the domain's DNS with it.
- **Two zones in Multi-AZ for the database now.** It survives a zone's outage, but doubles the database's cost. Backups and a tested restore come first. Multi-AZ can be turned on later without moving data.
- **Alerts to a chat app, or a paging service.** Email to the topic is enough for now, and either can subscribe to the same topic later.
