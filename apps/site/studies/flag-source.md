---

title: Who flagged this?
description: A two-day, 3 x 2 study of whether the source of a flag changes what bystanders do about harassment.
---

# Who flagged this?

Does it matter who flagged a comment? And does that change whether a bystander flags the next one themselves?

A participant is scrolling a food-photo site when they reach a comment with a notice on it, saying it was flagged as harassment. The notice names who flagged it, or it doesn't. Further down, someone else is being harassed, and nobody has flagged that yet. What the participant does about the second comment is what the study is after.

## Where it comes from

This is a rebuild, for testing, of:

> Bhandari, A., Ozanne, M., Bazarova, N. N., & DiFranzo, D. (2021). Do you care who flagged this post? Effects of moderator visibility on bystander behavior. _Journal of Computer-Mediated Communication_, 26(5), 284-300.

The same study is also written up in Ozanne et al. (2022) in _Big Data & Society_.

We rebuilt the design on Truman 3 to check the platform can run it.

::: warning These aren't the original materials
These are not the original study's materials or settings. If you want to replicate the paper, start from the paper.
:::

## What a participant sees and does

1. They arrive with their Prolific ID and read the consent page. The one in the example is a placeholder, and it notes that a study like this shows people harassing each other, so consent and debriefing need to say so.
2. They read the community rules for EatSnap.Love, a food-photo site. The first rule is no bullying or harassment.
3. They make an account and land in the feed.

They stay for two days, logging in twice a day and posting once a day. While they're there, they can post, like, comment, and flag.

## What's scripted

The cast posts twelve food photos, six on each day. Among them, two things are planted on each day:

- **Near the top, a flagged comment.** One cast member's harassing comment on another's food post has a notice on it: "Flagged as harassment". The notice asks "Do you agree with this flag?" Answering offers to show the community rules.
- **Lower down, an unflagged comment.** A second harassing comment, on a different post, with no notice. On day 1 it's "When will you get into your head that nobody likes your stupid ass". On day 2 it's "Everyone hates you". It is the same in every condition.

## The conditions

There are six, from two factors. Assignment is blocked in sixes, so every six participants fill each condition once.

**Source: who the notice says flagged it**

| Level   | The notice reads                                                                |
| ------- | ------------------------------------------------------------------------------- |
| `none`  | "This comment was flagged as harassment, which is against our community rules." |
| `users` | "Other EatSnap.Love users flagged this comment as harassment..."                |
| `ai`    | "Our automated system flagged this comment as harassment..."                    |

**Wording: how clear the flagged comment is**

| Level       | Day 1                                                   | Day 2                                                       |
| ----------- | ------------------------------------------------------- | ----------------------------------------------------------- |
| `clear`     | "Is she pregnant? Or did she just gain 500 pounds? LOL" | "this photo is uglier than you, and thats saying something" |
| `ambiguous` | "ummmm imma pass on ever eating this"                   | "plzzz don't ever cook this for me"                         |

The flagged comment is by the same person, on the same post, at the same time in both wordings. Only the words change.

## What gets measured

The main measure is whether the participant flags the unflagged comment. Alongside that, Truman also records:

- their answer to "Do you agree with this flag?"
- whether they opened the community rules
- anything they wrote under either comment
- what they were shown and for how long

## How long it runs

Two days.

## How it's built

If you want to build something similar, here's how this one is put together. The notices are labels, a feature that puts a notice on a post or comment. Each notice is one row in `labels.csv`, with the condition it belongs to. The two "sources" are cast members marked as moderators, named "Other EatSnap.Love users" and "Our automated system".

The folder also has scenario tests. They put a made-up participant in each condition and check, on both days, that the right comment and the right notice show up and the wrong ones don't. [Testing a study](/guide/testing) explains how to run them.

## Getting it

It's in the repository at `studies/examples/flag-source`. Import it with:

```
pnpm study import studies/examples/flag-source
```

[Studies as files](/developers/study-files) explains the folder. The pictures, names, and bios are borrowed from [EatSnap](/studies/eatsnap).
