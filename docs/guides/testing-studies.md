# Testing a study with scenarios and simulated participants

A scenario is a made-up participant who does set things at set times. Each `expect` says what should be true by then: which beats have happened, which condition they're in, and what's in their feed. The scenario runs in a world that's fast-forwarded through the study, so two days take a moment.

Use scenarios to check a study's logic before anyone real sees it. For example:
- Sam steps in by minute 10 in one condition, and never in the other.
- Answering Jake heads Sam off.
- Someone who stops posting on day 2 is moved to the stronger nudge.

## Running them

### In the admin app

1. **Write them:** in the builder, open **Tests** and write them there. They're checked as you save, like beats.
2. **Save a version:** they run by themselves on the server when the version is saved.
3. **See the results:** they're on the Studies page beside the version, with what failed. **Run tests again** reruns them.
4. **Launch:** if a version's tests haven't all passed, the Launch window warns you. You can still launch it. "Don't warn me about tests for this study" turns the warning off, and **Warn me again** on the Studies page turns it back on.

The test participants are deleted after each run, so nothing is left in the study's data or on the Monitor page. Only the results are kept.

### From the command line

```
pnpm study test studies/examples/bystander
```

```
✓ In "defended", Sam steps in when the participant stays quiet
✓ In "silent", nobody defends Maya
✓ Answering Jake heads off Sam, and Jake answers back
✓ Maya thanks a participant who's kind to her

All 4 scenarios passed.
```

- **Where it runs:** in a database made for the run and dropped afterward, so nothing real is touched. It needs the Docker services (`docker compose up --detach --wait`).
- **Improvised lines** use their rehearsed or fallback lines, never a model, so a run costs nothing.

When something isn't as expected, it says what happened instead:

```
✗ A quiet participant gets the stronger nudge
    At 0:02, "jake-mocks" should have happened, but it's set for 0:03.
    At 0:10, "sam-defends" should have happened, but it's only in "defended", and they're in "silent".
    At 0:10, "leo-likes-mocking" shouldn't have happened, but it did at 0:03.
```

## Writing them

Scenarios go in `scenarios.yaml`, beside `study.yaml`:

```yaml
scenarios:
  - name: Answering Jake heads off Sam, and Jake answers back
    condition: defended # the condition they start in
    steps:
      - at: "0:03"
        comment: "Hey, that's not nice"
        on: { beat: jake-mocks } # what a beat made, or { post: maya-art } for one of the study's
      - at: "0:10"
        expect:
          happened: [jake-answers-participant]
          notHappened: [sam-defends]
          sees: ["relax, it's a joke"]
```

Each step has an `at`, in hours:minutes from when they start, and one of these:

| Step                                     | What happens                      |
| ---------------------------------------- | --------------------------------- |
| `post: text`                             | They write a post                 |
| `comment: text`, with `on`               | They comment on a post or comment |
| `like: { post: id }` or `{ beat: id }`   | They like it                      |
| `repost: { post: id }` or `{ beat: id }` | They repost it                    |
| `follow: username`                       | They follow someone in the cast   |
| `expect`                                 | Nothing is done. It's checked     |

An `expect` can say any of these:

|                      |                                                                     |
| -------------------- | ------------------------------------------------------------------- |
| `happened: [ids]`    | These beats or decision points have happened by now                 |
| `notHappened: [ids]` | These haven't                                                       |
| `condition: key`     | They're in this condition now, which can change at a decision point |
| `sees: [text]`       | This text is in their feed, in a post or a comment                  |
| `doesNotSee: [text]` | It isn't                                                            |

Steps run in order of `at`. Before each one, the runner loads the page as the participant would, so anything that came due by then happens first.

## How it works

- **The participant** is a test participant, the same kind "Try as a participant" starts, so they're kept out of exports.
- **Their actions** go through the API, the same as a real participant's.
- **The clock:** the API takes its clock as a setting. The server uses the real time, and the runner moves its own clock forward step by step, so every timestamp in the world agrees, including what a decision point measures. See ADR 56.

`scenarios.yaml` is saved with each version, like `beats.yaml`, so a version's tests are the ones written for it.

## Simulated participants

Scenarios check the paths you write down. Simulated participants look for the ones you didn't: many made-up participants go through a version at random, and a report says how often each beat happened in each condition. Use it to find a beat that never happens, or one that happens where it shouldn't.

Each one is quiet, average, or busy. They visit at the start and, on a study of a day or more, a few more times a day. At each look at their feed they may like, comment, reply, repost, follow, post, or flag something they see. No model is used, so it costs nothing. See ADR 59.

### In the admin app

On the Studies page, press **Simulate** beside a saved version, choose how many participants (up to 200), and press **Simulate**. The report shows:

- **Worth a look:** beats that never happened for anyone who could have had them, beats that happened in a condition they aren't in, decision points never reached, and errors.
- **Each beat:** how many it happened for in each condition, the most times for one participant, why it was skipped, and whether it was still due when they finished.
- **Each decision point:** how many it decided for, and where it sent them.

The participants are deleted afterwards. **Repeat the last run exactly** runs it again with the same random choices, which is useful after changing something.

### From the command line

```
pnpm study simulate studies/examples/bystander 100
```

```
Participants: 50 in "defended", 50 in "silent"
They did: 62 repost (62 refused), 45 follow, 185 like, 95 comment, 40 flag, 59 post

Beats, and how many in each condition they happened for:
  jake-mocks: defended 50/50, silent 50/50
  leo-likes-mocking: silent 50/50
  sam-defends: defended 49/50 (1 still due when they finished)
  jake-answers-participant: defended 2/50, silent 4/50
  ...

Nothing stood out.

To repeat this run exactly: pnpm study simulate studies/examples/bystander 100 --seed 3
```

"Refused" counts things the study doesn't allow, like reposting where reposts are off. That's expected, not a problem.

A beat that's rare isn't necessarily wrong. Random participants seldom reply to one particular comment, for example. Run more participants, or write a scenario for that path.

## Personas, for piloting

Random participants check the logic. Personas show you how the study feels: a model plays a participant you describe, and you read what they saw, what they did, and why, in their words, along with what the cast said back. See ADR 60.

1. **Write personas:** in the builder, open **Personas**. Each has an `id`, an `about` saying who they are and how they use social media, and, if you like, the `condition` they start in. `model` at the top picks the Claude model that plays them.

   ```yaml
   model: claude-sonnet-5-5
   personas:
     - id: quiet-bystander
       about: >
         A second-year student who scrolls a lot and rarely posts. Feels uncomfortable when
         people are mean, but usually doesn't get involved.
     - id: upstander
       about: Confident and kind. Quick to defend someone being picked on.
       condition: silent
   ```

2. **Save a version,** then press **Simulate** beside it on the Studies page.
3. **Choose Personas,** say how many of each to run, and set a budget in US dollars. $2 is the default. Each look at the feed is one model call. The run stops when the budget is spent, and says so.
4. **Read the transcripts:** each persona's run, in order, with what was new each time they looked. Under it is the same report as for random participants, and what the model calls cost.

If the study writes live (`live: { enabled: true }` in `beats.yaml`), the cast writes live for personas too, from the study's own live-writing budget.

Personas need a Claude key on the server. From the command line, set `ANTHROPIC_API_KEY` in `.env`:

```
pnpm study simulate studies/examples/bystander --personas quiet-bystander,upstander --budget 1
```

## Synthetic data

Any run on the Simulate page can be kept as synthetic data: tick **Keep them as synthetic data**. Use it to build an analysis before data collection starts.

- **Never mixed in:** synthetic participants are never in the study's real data, its counts, or the Monitor page.
- **A separate download:** **Download synthetic data** on the Simulate page. Its codebook says at the top that nobody real took part. If you want real and synthetic data together, combine the two downloads yourself.
- **Timestamps in the past:** their worlds start one study length ago, so no time is in the future.
- **Deleting:** deleting the study deletes them too.
