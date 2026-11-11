# 68. Shared worlds: live updates, safety, testing, and load

## Context

ADR 67 put several participants in one world, but they only saw each other's posts when they loaded a page. The vault note `Shared worlds design` planned a second part:
- **real-time updates**
- **a researcher removing things live,** which Dominic chose over approving every post
- **a consent check**
- **a reference study**
- **scenario tests and simulations with several participants**
- **a load test** against his targets: 50 people in one world for 30 minutes, pages in under a second, and new posts seen within 5 seconds.

## Decision

- **Live updates use server-sent events** (`GET /live`, `apps/api/src/live.ts`).
  - A participant's page in a shared world listens.
  - It's told only what kind of thing changed: a post or comment, a notification, a message, or a removal. Then it fetches as usual, so what anyone sees is still built, and recorded, in one place.
  - The connection gets a reminder every 15 seconds, so CloudFront and the load balancer don't close it.
- **The API looks for what's new every two seconds, instead of being told by whatever wrote it.** Each copy of the API looks only at the worlds of the people listening to it:
  - it catches each world up, so the cast's beats happen on time even when nobody loads a page
  - it then finds what came due since it last looked, with one query each for content, notifications, and the study's own posts.
  - This finds what was written earlier to appear later, like a reaction due in two minutes, which a notice at the time of writing would miss. It finds what another copy of the API wrote, too.
- **The home and following feeds don't move by themselves.** A "New posts" button appears, as on real sites, and pressing it fetches the feed. A post's page, a profile, or a community refreshes at once.
- **A removal refreshes every page,** the home feed too, so what's taken down leaves everyone's screen.
- **Removing things live:**
  - The Monitor page shows what participants write in shared worlds, newest first, every five seconds.
  - Remove takes it down as the study's moderator (someone in the cast with `moderator: yes`), so others see an ordinary removal, and its author is told.
  - It's recorded as `moderation.removed_live`.
  - In a shared world this works even if the study has the removal feature off, since it's for everyone's safety.
  - Agents' tokens can't use it, since it shows what participants wrote.
- **Validation** warns about a shared-world study when:
  - it has no consent step
  - its consent page doesn't seem to say that others may be real people
  - nobody in the cast is a moderator.
- **Scenario tests with several participants:**
  - `participants: [ann, cal]` puts named participants in one world, and a step's `as` says who acts or whose view is checked.
  - The target `{ participant: ann }` is the latest post Ann wrote. `follow` and `to` can name a participant.
  - A beat counts as happened for someone if it ran for the whole world, or for them.
- **Simulations** put simulated participants in worlds of the study's size, with one condition each, and take their visits in time order, so they meet.
- **The last one out of a shared world deletes it** (migration 0055). Once nobody's left, nobody's records need it. This also cleans up after scenario tests and simulations.
- **`studies/examples/town-talk`** is reference study #5. In groups of six on a town forum, the cast opens a discussion civilly or uncivilly, inspired by Cheng et al. (2017). It isn't a rebuild of that study.
- **`pnpm load-test <address> <slug> [participants] [minutes]`** runs made-up participants against a running Truman, through its public address, and reports against the targets. `studies/load-test` is the study for it.

## Alternatives

- **Postgres LISTEN/NOTIFY,** as the design note planned. Each change would be announced the moment it's saved, to every copy of the API, by a trigger. But a reaction written now to appear in two minutes would be announced now, and not when it appears. Each copy would also need its own long-lived database connection. Looking every two seconds is a single query, and meets the 5-second target.
- **The browser polling the feed every few seconds.** Simple, but 50 people loading the feed every three seconds is far more work than one look every two seconds, and every load would be recorded as an impression.
- **WebSockets.** Two-way, which nothing here needs. Server-sent events are plain HTTP, reconnect by themselves, and pass through CloudFront.
- **Inserting new posts into the feed as they arrive.** It's more immediate, but the feed would move while someone reads it, and what they were shown would be harder to record.
- **Removing by a researcher who isn't anyone in the study.** Participants would see something taken down by nobody. A moderator in the cast keeps the site believable.
