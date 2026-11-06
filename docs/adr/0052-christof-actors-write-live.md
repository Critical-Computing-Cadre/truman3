# 52. Christof part 2: actors who write their own words

## Context

Part 1 (ADR 51) let a study script what happens. Part 2 lets a beat leave the wording to the actor's model, as planned in the vault note `Christof design`. Dominic chose Claude to start with, through a gateway that can take others. He agreed to strict defaults: live writing off unless a study turns it on, a $5 budget for each study, a check on everything written, and a fallback line for every improvised beat.

## Decision

- **A post or comment beat can `improvise` instead of giving `text`,** and must then give a `fallback`. Whether something happens, and when, stays the study's decision. The model only writes the words.
- **The top of `beats.yaml` has `live`** (enabled, budget, model, length, and red lines) **and `cast`,** a persona card for anyone (about, voice, values, goals, relationships, and red lines). Live writing is off by default.
- **A gateway, `packages/writer`.** `Writer` writes and checks. `anthropicWriter` uses the Anthropic SDK with Claude Opus 5.5 by default, at low effort, with the server-side default fallback for refusals. `standInWriter` writes without a model, for tests. It lives in its own package because the SDK changed how drizzle's optional peer resolved inside the API. The workspace root now declares `@opentelemetry/api`, so there's one drizzle everywhere.
- **Fallback before model.** The fallback line is used, with the reason recorded, when:
  - live writing is off
  - the server has no key
  - a researcher paused it, for the study or for one actor
  - the study's spending has reached its budget
  - the model declines or fails
  - the check says no, or can't decide
- **A second call checks every line,** against limits every study has (slurs and identity-based hate, sexual content, threats, real people's information, dangerous instructions, breaking character), plus the study's and the actor's red lines. It's told that a study may intend rudeness, so it doesn't block that. Structured output gives it a plain yes or no, and anything unclear counts as no.
- **The model sees only what the actor would:**
  - their persona card
  - what they've already said in this participant's world, which is their memory between visits
  - the post they're acting on and up to ten comments on it
  - the comment they're replying to
  - the beat's instruction
- **No page ever waits for a model.** The feed and notifications decide beats up to the first one that might call a model, and leave the rest, in order, for `/me`. The app checks `/me` every 30 seconds in the background. The line is placed at the time it was due.
- **Everything is recorded** in `beat_runs.writing`: live or fallback, why, the prompt, the model (the one that actually answered, if a fallback model ran), what it wrote, the check's answer, and the cost. The Monitor page shows the latest decisions, spending against the budget, and switches to pause live writing for the study or for one actor. The switches are on `studies`, outside any version, so they take effect at once.
- **The key is never in the repo or a study.** Locally it's `ANTHROPIC_API_KEY` in `.env`. On AWS, a stage can name a secret made by hand, `anthropicKeySecret`, which the API container gets by reference.

## Alternatives

- **One call that writes and checks itself.** A second call is a real second opinion, and it can be stricter than the writer without changing the writer's voice.
- **Writing during page loads.** Simpler, but participants would see a feed stall for seconds. The background check already exists for unread counts.
- **A background worker for writing.** It would be another service to run and watch, for the same result.
- **Rehearsed lines now.** They're part 3, along with approval for Wizard of Oz studies.

## Consequences

- A study can spend a little over its budget, by at most the lines being written when it's reached, since spending is checked before each line.
- Prices are listed in `packages/writer`. A model not in the list is priced as the most expensive, so a budget is never overrun by a missing price.
- Live lines differ between participants. That's the point of improvising, and the record keeps what each one saw. A study that needs the same words for everyone uses `text`.
- Migration 0040 adds `beat_runs.writing` and the two switches on `studies`.
