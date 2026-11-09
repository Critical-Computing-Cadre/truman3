# Testing a study with scenarios

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
