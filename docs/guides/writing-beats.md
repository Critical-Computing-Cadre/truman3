# Writing beats

Beats are what Christof, the director, makes happen in each participant's world: someone mocks a post three minutes in, a bystander steps in, the bully answers whoever replies to him. A study writes them in `beats.yaml`, next to its sheets. `studies/examples/bystander` is a whole study to copy from. ADR 51 says why it works this way.

Christof decides whether a beat happens and when. A post or comment can have fixed `text`, or `improvise`, where the actor's model writes the words. The beat still says what happens, and the model only fills in the wording. See [Writing live](#writing-live).

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

## Writing live

Instead of `text`, a post or comment can `improvise`. That's an instruction for what the actor writes, in their own words. It needs a `fallback` line, which is used whenever live writing can't be:

```yaml
do:
  action: comment
  actor: maya
  on: trigger
  improvise: Thank them for what they said, in your own words
  fallback: "Thank you, that really means a lot"
```

Live writing is off unless the top of `beats.yaml` turns it on:

```yaml
live:
  enabled: true
  budgetUsd: 5 # the most this study spends, across everyone in it
  model: claude-opus-5-5
  maxLength: 500 # characters
  redLines: [Insulting anyone's appearance, family, or identity]
```

The server also needs `ANTHROPIC_API_KEY`. On AWS, store it by hand in Secrets Manager and name the secret in the stage's `anthropicKeySecret`. Never put it in a study or the repo.

Persona cards say who someone in the cast is. Everything in a card is optional:

```yaml
cast:
  jake:
    about: A classmate who thinks he's funny.
    voice: Lowercase, short, sarcastic.
    values: Being liked
    goals: Not backing down in front of people
    relationships:
      maya: Doesn't take her art seriously
      participant: Annoyed that they're getting involved # "participant" is whoever takes part
    redLines: [Never swears]
```

### What the model sees

The model is told:
- who the actor is, from their card
- what they've already said in this participant's world, which is their memory between visits
- the post they're on, with up to ten comments
- the comment they're replying to
- the beat's `improvise` instruction

It sees nothing else in the database.

### When the fallback line is used

The fallback line is used, and the reason is recorded, when:
- live writing is off
- the server has no key
- a researcher paused it, for the study or for that actor, from the Monitor page
- the budget is used up
- the model declines or can't be reached
- the check stops what it wrote

### Checking what's written

Every line a model writes is checked by a second call before it's posted. The check allows rudeness a study intends, and blocks only lines that cross a limit:
- the limits every study has: no slurs, sexual content, threats, real people's information, dangerous instructions, or saying it's an AI or a study
- the study's `redLines`
- the actor's own red lines

### What's recorded

For each improvised beat, `beat_runs.csv` and the Monitor page record whether it was written live or used its fallback, and why. For a live line, the record also has the prompt, the model, what it wrote, the check's answer, and what it cost.

### Waiting for a line

A page someone is looking at never waits for a model. A beat that's writing live is written by the app's background check, which runs every 30 seconds, so it can appear up to that much later than it was due. It's placed at the time it was due.

## Approving beats, for Wizard of Oz studies

A beat can wait for a researcher to approve it, change its line, or skip it before it happens. Do this for every beat with `approval: all` in `live`, or for one beat with `approve: true`. A beat can also say `approve: false` to leave itself out of `approval: all`.

```yaml
live:
  approval: all
  approvalTimeout: "0:05" # or never
```

- The beat waits on the **Monitor** page, under "Waiting for you". You see what it's about, such as the participant's post, and a suggested line: the model's, if live writing is on, or else the fallback or fixed text.
- You can **approve** it, **post your own version**, or **skip** it. Approving works with live writing off, so a researcher can write every line themselves.
- **When it posts:** an approved line appears when it's approved, and beats after it count from then.
- **If nobody decides** within `approvalTimeout` (ten minutes unless a study says), the fallback or fixed line is used, as of when the time ran out, so a participant never waits forever. `never` waits as long as it takes.
- **What's recorded:** `beat_runs.csv` records who decided, the suggested line, and whether it was changed.
