---

title: Example studies
description: Five finished studies that come with Truman, each built to answer one research question.
---

# Example studies

Truman comes with five finished studies. Each one answers a question, and each uses a different part of the platform. Read the one closest to what you want to run, then change it.

Three of them are rebuilds of published designs. We made them to check that Truman 3 can run that kind of study. They are not the original authors' materials, and each page says so.

## What do people do when someone is cruel to a stranger?

**[EatSnap](/studies/eatsnap)** is a food-photo site with 76 made-up people and 284 posts. Somewhere in the feed, one of them says something cruel to another. Which cruel comments a participant sees depends on their condition. This is the site the first Truman study ran on, in the version that shipped with the older Truman code.

Start here if you want a large, lived-in feed that runs over two days.

## Does it matter who flagged a post?

**[Who flagged this?](/studies/flag-source)** puts a "Flagged as harassment" notice on one comment each day. The notice says other users flagged it, or an automated system did, or it doesn't say. Lower in the feed is a second harassing comment that nobody has flagged. The question is whether the participant flags that one.

It's a rebuild of Bhandari et al. (2021). Start here for a study with two factors, or one that uses labels on posts.

## If more people seem vaccinated, do you think it's the norm?

**[Vaccine frames](/studies/vaccine-frames)** is a one-minute scroll through 30 everyday posts. Two, five, or nine of the 30 people have a "vaccinated" frame on their profile picture. Then a survey asks what the participant thinks is normal.

It's a rebuild of Aghajari et al. (2024). Start here for a short study where the measures are in a survey afterward.

## Is rudeness contagious?

**[Town talk](/studies/town-talk)** puts six real participants in one town forum. The cast answers a neighbor's question politely or with insults. Then the participants write, and they see each other.

It's inspired by Cheng et al. (2017), and it isn't a rebuild of it. Start here if your participants need to meet each other.

## What happens when a pile-on starts?

**[Bystander](/studies/bystander)** has someone post her first painting. A few minutes later a classmate mocks it. In one condition someone steps in. In the other, someone likes the mocking comment. What the cast does next depends on what the participant does.

It's made up for testing and isn't from a published study. Start here to see how beats work, including private messages and a cast that can write its own replies.

## Side by side

| Study                                     | Conditions | Runs for         | Participants together | Uses                                                                 |
| ----------------------------------------- | ---------- | ---------------- | --------------------- | -------------------------------------------------------------------- |
| [EatSnap](/studies/eatsnap)               | 5          | 2 days           | No                    | A large scripted feed, scripted reactions to the participant's posts |
| [Who flagged this?](/studies/flag-source) | 6 (3 x 2)  | 2 days           | No                    | Labels, flagging, community rules                                    |
| [Vaccine frames](/studies/vaccine-frames) | 3          | About a minute   | No                    | Profile pictures by condition, a survey link at the end              |
| [Town talk](/studies/town-talk)           | 2          | About 15 minutes | Six to a world        | Shared worlds, automatic rules, live moderation                      |
| [Bystander](/studies/bystander)           | 2          | 1 day            | No                    | Beats, direct messages, optional live writing                        |

## Getting one

Every example is in the repository, under `studies/examples/`. On your own Truman, one command brings it in as a frozen version you can launch:

```
pnpm study import studies/examples/bystander
```

[Studies as files](/developers/study-files) explains what's in the folder. Four of the five also come with scenario tests, which [Testing a study](/guide/testing) covers.

The consent pages in all five are placeholders. A real study uses the text its ethics board approved. [For IRBs](/irb) has what your board will want to know about Truman itself.
