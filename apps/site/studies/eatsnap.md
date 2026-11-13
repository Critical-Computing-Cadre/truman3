---

title: EatSnap
description: A two-day study on a food-photo site, where the conditions differ in which unkind comments a participant sees.
---

# EatSnap

What do people do when someone is cruel to a stranger in their feed?

A participant joins EatSnap.Love, a made-up photo site about food, and finds it already busy: 76 people posting pictures of their meals, with likes and comments underneath. They can join in with photos of their own. Somewhere in that feed, someone is unkind to someone else, and which unkind comments turn up depends on the condition. The participant can scroll past, flag it, reply, or block the person who wrote it.

<TryIt study="eatsnap" name="EatSnap" />

## Where it comes from

EatSnap.Love is the site the first Truman study ran on (DiFranzo et al., CHI '18), and it has been Truman's example study ever since.

This version was converted from the example that shipped with the previous Truman (`cornellsml/truman_2023`). Its settings reproduce how that version behaved.

::: info This isn't the 2018 study
It is the classic demo. It isn't the materials or the design of the 2018 paper.
:::

## What a participant sees and does

1. They arrive from a link with their Prolific ID in it.
2. They read a consent page. The one in the example is a placeholder.
3. They make an account, with a username and a profile.
4. They read the community rules. The rules ban spam, bullying, discrimination, and anything not safe for work, and ask them to flag what they see.
5. They land in the feed.

The feed looks like a photo app. It's newest first and reaches back 24 hours. A participant can post their own food photos, and like, comment on, and flag what they see. When they post something new, it stays at the top for ten minutes.

## The cast and the script

The site feels lived-in because there's a lot of it:

- **76 people,** each with a name, a face, and usually a bio and a hometown.
- **284 posts,** every one a food photo with a caption.
- **342 comments** on those posts.

Everything has a time, measured from the moment the participant joins. Some posts are dated before they arrive, so the site already looks busy. The rest appear on schedule while they're there.

The cast also reacts to the participant. When they post, a few cast members like it within minutes, and one or two reply with something like "Looking good :)". There are 174 of these scripted reactions, tied to the participant's first, second, third post, and so on.

Likes on the cast's posts are drawn from a list of small numbers in `study.yaml`, so most posts have a handful of likes and comments have fewer.

## The conditions

There are five, and each participant has an equal chance of each. Almost all of the site is identical across them. The only thing that differs is which unkind comments appear.

| Condition      | What's added                                                                                 |
| -------------- | -------------------------------------------------------------------------------------------- |
| `marginal`     | 16 comments that are mildly negative or a little off, such as "That looks disgusting tbh :/" |
| `troll`        | 3 comments from obvious bad actors: two spam links and one hateful rant                      |
| `unambig_flag` | 2 comments that are plainly harassment, one on each day                                      |
| `ambig_flag`   | 2 comments in the same places, worded so they could be read either way                       |
| `unambig_none` | 2 different, plainly cruel comments, both on the second day                                  |

::: tip Rename the conditions if you build on this
The condition names came over from the older version unchanged. If you build on this, rename them to something your methods section can use.
:::

## What gets recorded

Truman records the same things for every study:

- what the participant was shown, in what order
- how long each post was on screen
- every like, comment, flag, block, and post, with its time
- which condition they were in, and how they were assigned

For this study, the comparisons of interest are whether a participant flagged, replied to, or ignored the unkind comments in their condition. [Your data](/guide/data) describes the files you get.

## How long it runs

The study is set to two days. Participants come back with the same link and their Prolific ID, so there's no password to remember.

## What it's good for

Use it to see what a full, busy site looks like on Truman, and as a source of content. The other examples borrow its pictures and names.

It doesn't use beats, so nothing in it depends on what the participant does apart from the reactions to their own posts. For a study where the cast responds to the participant, see [Bystander](/studies/bystander). For a tighter two-factor design on the same site, see [Who flagged this?](/studies/flag-source).

## Getting it

It's in the repository at `studies/examples/eatsnap`. Import it with:

```
pnpm study import studies/examples/eatsnap
```

[Studies as files](/developers/study-files) explains the folder. This example has no scenario tests of its own.
