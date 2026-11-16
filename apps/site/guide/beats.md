---

title: Making things happen
description: How to write beats, which make the cast do things at set times or in answer to what a participant does.
---

# Making things happen

A feed of scripted posts only goes so far. Often you want things to happen while the participant is there: someone mocks a post three minutes in, a bystander steps in, the bully answers whoever replies to him.

Each of those is a beat. A beat says what sets it off, who does what, and in which conditions. The part of Truman that runs them is called Christof, the director, and every decision Christof makes is recorded and ends up in your export.

![The Beats page, where a study's beats are written](/shots/beats.png)

## Where beats are written

In the builder, press **Beats**. The page has a text editor, with a reference table called **How beats work** beside it. A study with no beats shows one to start from.

Beats are written as text, in a format called YAML: indented lines of `name: value`. The easiest way to start is to copy an example, change the values, and press **Save beats**. The page says **No problems found**, or names the beat and what's wrong with it, such as a person who isn't in the cast.

## A first beat

Here's a small one to start with. Someone replies to the participant's first post, a minute or two later:

```yaml
beats:
  - id: welcome
    note: Someone replies to the participant's first post.
    when: { participant: post, nth: 0 }
    delay: { min: "0:01", max: "0:02" }
    do:
      action: comment
      actor: grace_o
      on: trigger
      text: Welcome! Glad you're here.
```

- `id` names the beat, in lowercase letters, numbers, `-` and `_`.
- `note` is for your team. Participants never see it.
- `when` is what sets it off.
- `delay` is how long after, as one time or a range. Times are hours:minutes.
- `do` is what happens. `actor` is a username from your cast.

## What sets a beat off

Give exactly one `when`:

| `when`                                        | Happens                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------- |
| `{ time: "0:03" }`                            | Three minutes after the participant starts                                |
| `{ participant: post }`                       | When they post. Also `comment`, `like`, `follow`, `repost`, and `message` |
| `{ participant: comment, nth: 0 }`            | Only on their first comment. `nth` counts from 0                          |
| `{ participant: comment, on: maya }`          | Only when it's on something Maya wrote                                    |
| `{ participant: comment, under: jake-mocks }` | Only on what the beat `jake-mocks` made, or anywhere under it             |
| `{ beat: jake-mocks }`                        | After that beat happens                                                   |

## What happens

| `action`                         | Does                                                          |
| -------------------------------- | ------------------------------------------------------------- |
| `post`                           | A new post, with `text`                                       |
| `comment`                        | A comment, with `on` and `text`                               |
| `like`, `repost`                 | A like or a repost of `on`                                    |
| `follow`                         | Follows the participant                                       |
| `message`                        | A direct message to the participant. Needs direct messages on |
| `remove`, `label`, `warn`, `ban` | Moderation by someone in the cast. Each needs its feature on  |
| `ask`                            | Asks the participant a question. See below                    |

`on` says what it's done to:

- `trigger` is whatever set the beat off: what the participant wrote or acted on, or what the beat before made.
- `{ beat: jake-mocks }` is what that beat made.
- `{ post: maya-art }` is one of the study's own posts, by its `id` in the posts sheet.

## Asking a question in the moment

A beat can ask the participant something, right when it matters: how a comment made them feel, just after they read it, or why they posted, just after they did. A survey at the end asks them to remember. This asks while it's happening.

```yaml
beats:
  - id: after-jake
    when: { participant: comment, under: jake-mocks }
    do:
      action: ask
      title: About what you just wrote
      questions:
        - id: felt
          text: How did Jake's comment make you feel?
          type: scale
          max: 7
          minLabel: Upset
          maxLabel: Fine
        - id: why
          text: Why did you reply?
          type: choice
          choices: [To defend Maya, To argue with Jake, No reason]
```

A card appears at the bottom of their screen, over whatever page they're on, and stays until they press **Send** or **Not now**.

- **Up to three questions at once.** It's read on a phone, in the middle of something else. A longer set belongs in a survey.
- **Four kinds:** `scale` (1 to 5 unless you set `min` and `max`, with a label for each end), `choice` (one of a list), `choices` (several of a list), and `text` (their own words, up to 500 characters).
- **`required: true`** takes away **Not now**, so the card stays until they answer. Use it sparingly. A participant who can't get past a question may leave instead.
- **Nobody in the cast asks.** It comes from the site, so there's no `actor`.
- **Everything a beat can wait for, a question can too:** a time, something the participant does, or another beat. `max` lets it ask more than once, and `conditions` limits where.

Asking changes what people do next. Someone who has just been asked how a comment made them feel may answer it differently. So decide which conditions ask, and keep the timing the same wherever you compare.

What they answer is in `answers.csv` in your download, with how long they took. Someone who was asked and didn't answer is there too, so you know who saw the question. See [Your data](/guide/data).

A beat can't yet wait for a participant to _see_ a post, only for something they do.

## Limits on a beat

Three optional settings narrow down when a beat happens:

- `conditions: [silent]` makes it happen only in those conditions. Leave it out for all.
- `max: 3` lets it happen up to three times in one participant's world. The default is once.
- `unless: [sam-defends]` cancels it if any of those beats has happened by the time it's due.

## A scene

Beats get more interesting when they refer to each other. This scene is cut down from the bystander example. Jake mocks a painting. In `defended`, Sam steps in a minute or more later, unless the participant has already answered Jake.

```yaml
beats:
  - id: jake-mocks
    when: { time: "0:03" }
    do:
      action: comment
      actor: jake
      on: { post: maya-art }
      text: lol my little brother paints better than this

  - id: sam-defends
    conditions: [defended]
    when: { beat: jake-mocks }
    delay: { min: "0:01", max: "0:03" }
    unless: [jake-answers-participant]
    do:
      action: comment
      actor: sam
      on: { post: maya-art }
      text: Not cool, Jake. It's her first painting. Maya, I love the colors!

  - id: jake-answers-participant
    when: { participant: comment, under: jake-mocks }
    delay: { min: "0:01", max: "0:02" }
    do: { action: comment, actor: jake, on: trigger, text: "relax, it's a joke" }
```

A delay in a range is drawn at random, the same way each time for the same world. If the participant is away when a beat comes due, it's still placed at the time it was due, and they find it there on their next visit.

## What's recorded

Every time Christof considers a beat in someone's world, it becomes a row in `beat_runs.csv`: what set it off, when it was due, whether it happened, and if it didn't, why. A beat that needs something that's off in a condition, like comments, is skipped there and the reason is written down.

## Check that it works

Beats are logic, and logic has paths you didn't think of. Before launch, go through the study as a test participant, write a scenario test for each path that matters, and send in simulated participants to find beats that never happen. All of that is in [Testing a study](/guide/testing).

## Words that aren't fixed

The lines in a beat don't have to be written ahead of time. A comment can have `improvise` in place of `text`: an instruction for an AI model that writes the line in that character's voice. A beat can also wait for you to approve its line before it posts. Both are in [A cast that writes for itself](/guide/live-writing).

## Decision points

Beats decide what happens inside a condition. A decision point decides which condition someone is in, partway through. Use one for an adaptive design, where people who haven't posted by the end of day 2 are re-randomized to a stronger nudge.

Decision points go under `decide:` on the Beats page:

```yaml
decide:
  - id: day-2
    when: { time: "48:00" }
    conditions: [gentle-nudge]
    measure:
      posts: { count: post }
    groups:
      - name: non-responders
        if: { posts: { atMost: 0 } }
        to: { strong-nudge: 1, peer-nudge: 1 }
      - name: responders
        to: stay
```

A measure counts something the participant did, such as posts, comments, likes, or minutes active. Groups are checked in order, and the first that fits decides. `to` either re-randomizes by weight or says `stay`.

A condition that's only reached this way has a weight of 0 in Settings, so nobody starts in it. Every assignment, including staying, is recorded with its probability in `assignments.csv`, so a standard SMART analysis can weight it.

::: info Not in shared worlds yet
Decision points aren't available in shared worlds yet. For how beats behave there, see [Several real people together](/guide/shared-worlds).
:::
