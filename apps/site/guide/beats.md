---

title: Making things happen
description: How to write beats, which make the cast do things at set times or in answer to what a participant does.
---

# Making things happen

By the end of this page, things happen in your study while the participant is there. Someone mocks a post three minutes in. A bystander steps in. The bully answers whoever replies to him.

Each of those is a beat. A beat says what sets it off, who does what, and in which conditions. The part of Truman that runs them is called Christof, the director. Every decision Christof makes is recorded and ends up in your export.

## Where beats are written

In the builder, press **Beats**. The page has a text editor, with a reference table called **How beats work** beside it. A study with no beats shows one to start from.

Beats are written as text, in a format called YAML: indented lines of `name: value`. Copy an example, change the values, and press **Save beats**. The page says **No problems found**, or names the beat and what's wrong with it, such as a person who isn't in the cast.

## A first beat

Someone replies to the participant's first post, a minute or two later:

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

`on` says what it's done to:

- `trigger` is whatever set the beat off: what the participant wrote or acted on, or what the beat before made.
- `{ beat: jake-mocks }` is what that beat made.
- `{ post: maya-art }` is one of the study's own posts, by its `id` in the posts sheet.

## Limits on a beat

- `conditions: [silent]` makes it happen only in those conditions. Leave it out for all.
- `max: 3` lets it happen up to three times in one participant's world. The default is once.
- `unless: [sam-defends]` cancels it if any of those beats has happened by the time it's due.

## A scene

This is cut down from the bystander example. Jake mocks a painting. In `defended`, Sam steps in a minute or more later, unless the participant has already answered Jake.

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

A comment can have `improvise` in place of `text`: an instruction for an AI model that writes the line in that character's voice. A beat can also wait for you to approve its line before it posts. Both are in [A cast that writes for itself](/guide/live-writing).

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

Decision points aren't available in shared worlds yet. For how beats behave there, see [Several real people together](/guide/shared-worlds).
