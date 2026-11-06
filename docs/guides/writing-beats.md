# Writing beats

Beats are what Christof, the director, makes happen in each participant's world: someone mocks a post three minutes in, a bystander steps in, the bully answers whoever replies to him. A study writes them in `beats.yaml`, next to its sheets. `studies/examples/bystander` is a whole study to copy from. ADR 51 says why it works this way.

Christof decides whether a beat happens and when. Nothing in a beat is left to a model yet. When actors can write their own words (Christof part 2), a beat will still say what happens, and the model will only fill in the wording.

## A beat

```yaml
beats:
  - id: jake-mocks # lowercase letters, numbers, - and _
    note: Jake mocks Maya's painting. # for your team; participants never see it
    when: { time: "0:03" } # what sets it off
    delay: { min: "0:01", max: "0:02" } # how long after, drawn the same way each time for a world
    conditions: [silent] # leave out for every condition
    max: 1 # how many times it can happen in one world (default 1)
    unless: [sam-defends] # not if any of these has happened by the time it's due
    do: # what happens
      action: comment
      actor: jake
      on: { post: maya-art }
      text: lol my little brother paints better than this
```

Times are hours:minutes from when the participant starts, as in the sheets. A delay can be one time, like `delay: "0:01"`, or a range.

## What sets a beat off (`when`)

Give exactly one of these:

| `when`                                        | Happens                                                                    |
| --------------------------------------------- | -------------------------------------------------------------------------- |
| `{ time: "0:03" }`                            | At a set time                                                              |
| `{ participant: post }`                       | When the participant posts. Also `comment`, `like`, `follow`, and `repost` |
| `{ participant: comment, nth: 0 }`            | Only on their first comment. `nth` counts from 0                           |
| `{ participant: comment, on: maya }`          | Only when it's on something Maya wrote, or, for `follow`, following Maya   |
| `{ participant: comment, under: jake-mocks }` | Only when it's on what the beat `jake-mocks` made, or anywhere under it    |
| `{ beat: jake-mocks }`                        | After that beat happens, counting the delay from then                      |

## What happens (`do`)

| `action`  | Needs                 | Does                                                                                               |
| --------- | --------------------- | -------------------------------------------------------------------------------------------------- |
| `post`    | `actor`, `text`       | A new post                                                                                         |
| `comment` | `actor`, `on`, `text` | A comment. On a comment, it's a reply where threads are on, and goes on the post where they're off |
| `like`    | `actor`, `on`         | A like                                                                                             |
| `repost`  | `actor`, `on`         | Passes it along                                                                                    |
| `follow`  | `actor`               | Follows the participant                                                                            |

`on` says what it's done to:
- `trigger`: what set the beat off. That's what the participant wrote or acted on, or what the beat before made.
- `{ beat: jake-mocks }`: what that beat made in this world.
- `{ post: maya-art }`: one of the study's own posts, by its id in `posts.csv`.

If a beat needs something that's off in a condition, like comments, it's skipped there, and the reason is recorded.

## What's recorded

Every time Christof considers a beat in someone's world, it's a row in `beat_runs.csv` in the export:
- what set it off
- when it was due
- whether it happened, and if not, why
- who did it
- what it made

What a beat makes appears at the time it was due, however late the participant's next page load is.

## Checking

`pnpm study validate <folder>` reads `beats.yaml` with the rest. It names the beat and what's wrong, such as a person who isn't in the cast, a beat that points at one that doesn't exist, or beats that follow each other in a circle.
