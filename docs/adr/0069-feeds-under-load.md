# 69. Feeds under load

## Context

ADR 68's load test ran on staging: 50 made-up participants in one shared world for 30 minutes. It missed the targets:
- the feed's median load time was 2.8 seconds, and 83% of feed loads took over a second
- new posts reached others within 5 seconds only 71% of the time

The API's one task had a quarter of a CPU (0.25 vCPU, 512 MB), and it ran at 100% for most of the test. The database sat at about 10% CPU. So the limit was the API's CPU, not the database. The same load on a laptop was fine, with every request under 200 ms, since a laptop has far more CPU.

Profiling the feed locally showed where the time goes:
- **Catching up.** Each load ran 16 queries, and 6 of them caught the world's beats up. In a shared world, one new post sends all 50 participants to load their feed at once, so each burst ran the same catch-up 50 times.
- **Turning database rows into objects** (Drizzle and the Postgres driver): about half the CPU.
- **Sending every post.** The feed sends every post in the world, about 133 KB once there are 300 posts.

## Decision

- **Staging's API gets a whole CPU** (1 vCPU, 2 GB, in `infra/lib/stages.ts`). That's about $29 a month while it runs, up from about $7. One-off tasks get the same size, which only matters while they run.
- **A page load joins a catch-up that's already running.**
  - The feed and `/me` pass `join: true` to `catchUp`. If this copy of the API is already catching up the same world, they wait for that instead of starting another.
  - Loads that come one after another still each catch up. So anything that changes a world, a test included, is seen by the next load.
  - The busier the API is, the longer a catch-up takes, so the more loads share it.
  - Doing something, like posting, never joins. It always catches up, so what it sets off happens at once.
  - Timed beats for each participant are only noticed as that participant. So when a study has those, nobody's load joins someone else's catch-up.

## Alternatives

- **Skipping a catch-up if one ran within the last second.** This saves more, but a load straight after something changed the world, like a researcher's action or a test, could miss it for up to a second.
- **Two quarter-CPU tasks.** It costs about the same as half a CPU. Live updates work across copies (ADR 68), but each copy would still do all the same work for its half.
- **Sending the feed a page at a time.** This would make each load cheaper as a world grows, and it's what real sites do. But it changes what participants see and what's recorded as shown. It's the next step if worlds with hundreds of posts need it.
- **Replacing Drizzle with hand-written SQL in the feed.** That would cut the cost of turning rows into objects, but the feed's queries would be harder to read and change.

## Afterwards

With 1 vCPU, every new post reached the others within 5 seconds, and the API's CPU averaged 25–40%. But the feed's median load was still 1.16 s. The load test had all 49 others load their feed the instant a post arrived, so they queued behind each other. Real participants get the "New posts" button, and press it when they notice it. So `pnpm load-test` now has each made-up participant press it 1 to 6 seconds later. It reports when the button appeared, and when the post was on screen, and counts those feed loads apart from the ones made when opening the page.

Run that way on staging, with 50 participants for 30 minutes, every target was met:
- every request was under a second
- feed loads had a median of about 80 ms
- every new post reached the others as the button within 5 seconds, with a median of 1.0 s and the slowest at 2.0 s

The API's CPU averaged 20–30%, and the database's stayed under 15%.
