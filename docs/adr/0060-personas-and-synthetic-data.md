# 60. Christof part 5b: personas and synthetic data

## Context

ADR 59 added simulated participants who behave at random, to stress-test a study's logic. Section 11 of the vault note `Christof design` asked for two more uses. One is piloting: a model plays a participant with a persona, so a researcher can read how the study feels before paying real people. The other is synthetic data, as an option for labs that want data shaped like a study's to build an analysis ahead of time. Section 12 asked where personas live, what to read afterwards, how to cap the cost, and how to keep synthetic data apart. You took the defaults for all four.

## Decision

- **Personas are written in `personas.yaml`,** saved with each version, like `scenarios.yaml`. It's edited on a Personas page in the builder and checked as it's saved. Each persona has an `id`, an `about` in plain words, and an optional starting `condition`. The file names the `model` that plays them, Sonnet unless it says otherwise. The cast's persona cards in `beats.yaml` are a different thing: they're who the cast is, and these are who the participant is.
- **A persona is another behavior** for ADR 59's runner. At each look at their feed, the model is shown:
  - what they see, as a numbered list
  - what they've done so far
  - the persona

  It answers with structured output: an action, the number it's on, any text, and why, in their voice. An action that can't be done, like liking their own comment, is recorded as nothing, with the reason. The writer gateway (ADR 52) gets an `act` method for this, with the same server-side fallback as the cast's writing.
- **The researcher picks personas and how many of each on the Simulate page.** They run one after another, each as a test participant, the same as random ones.
- **Each run has a budget, $2 unless set otherwise,** for the model playing personas. When it's spent, the run stops after the participant it's on. The report says so, and "Worth a look" lists it. The report also gives what the personas cost and what the cast's live writing cost.
- **The cast writes live during persona runs,** if the study writes live, so piloting shows what participants would really see. That spending comes from the study's own live-writing budget, as it would for a real participant. Random runs still use rehearsed or fallback lines, since they're for checking logic.
- **Each persona's run is a transcript:** at each look, what others posted that they hadn't seen before, what they did, and why. The Simulate page shows them, leaving out looks where nothing new appeared and nothing was done. `pnpm study simulate --personas` prints them.
- **Synthetic data is an option on any run:** "Keep them as synthetic data."
  - **Marked:** kept participants are test participants with `participants.synthetic` set. A database rule says a synthetic participant is always a test participant, so one can never count as real.
  - **Kept out:** like any test participant, they're left out of real exports, counts, and the Monitor page. They're also left off Christof's card.
  - **Downloaded separately:** they download only as synthetic data, from the Simulate page, as a separate file named `-synthetic`. Its codebook says at the top that nobody real took part. The download is recorded in `study_exports` with the contents "synthetic".
  - **In the past:** their worlds start one study length before now, so every timestamp is in the past.
  - **Deleting a study** deletes them too, since they're test participants (ADR 58).
- **A server without a Claude key can't play personas,** and says so. Random runs and synthetic data from them still work.

## Alternatives

- **Typing personas on the Simulate page for each run.** Nothing would be saved, so a run couldn't be repeated or reviewed with the version. You chose saving them with the study.
- **Letting the model use the participant app through a browser.** Closer to a real person, but much slower and costlier for each look, and the API is the same path either way.
- **One combined export, with synthetic participants marked.** A mark is easy to miss in analysis, and mixing invented data into a study's data is the mistake to prevent. A lab that wants them together can combine the two downloads.
- **Synthetic participants on the real clock.** Simulating days would take days. Starting their worlds in the past gives realistic timestamps that are never in the future.
- **Counting persona spending in the study's live-writing budget.** That budget is for participants' worlds, and a researcher piloting should be able to spend without using it up. The run's own budget covers the model playing personas.

## Consequences

- Migration 0047 adds `participants.synthetic`, with its rule.
- The bystander example has a `personas.yaml`, with two personas.
- Persona runs can be tried only on a server with a Claude key. On staging that's the key added for live writing. The tests use a stand-in writer, so no test calls a model.
- When a persona run cleans up, its cast's live-writing spend goes with the deleted worlds. The study's live budget then doesn't count it.
