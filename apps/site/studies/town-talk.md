---

title: Town talk
description: Six real participants share one town forum, and the cast opens the discussion politely or with insults.
---

# Town talk

In most Truman studies, each participant is alone with the cast. In this one, six real people are in the same forum at the same time. What each of them writes becomes part of what the others read.

## Where it comes from

It's inspired by the design of:

> Cheng, J., Bernstein, M., Danescu-Niculescu-Mizil, C., & Leskovec, J. (2017). Anyone can become a troll: Causes of trolling behavior in online discussions. _Proceedings of CSCW 2017_.

It isn't a rebuild of that study. Cheng and colleagues showed people a discussion that had already been written. Here the discussion is live, so a tone can spread from one participant to the next.

## The question

Is rudeness contagious? If the first few answers in a thread are insulting, do the real people who answer next write that way too? And does it compound as more of them join in?

## What a participant sees and does

1. They arrive with their Prolific ID and read the consent page. It says that some of the people they'll meet are other real participants and some are part of the study, that the group can see what they write, and that they shouldn't share anything identifying.
2. They make an account.
3. They wait. The screen says "Waiting for others to join" and how many are there.
4. The forum opens for everyone in the group at once.
5. After 15 minutes they may move on.

The forum is called Commons. It's text only. Rita, a neighbor, has asked what people think of closing Main Street to cars on weekends. There are a few other posts around it: the farmers market, a pothole, a welcome from the Commons Team.

## Groups

Six to a world. A world starts when it's full, or ten minutes after its first person joined, with whoever is there. Everything is timed from that start, so nobody misses anything while waiting.

Recruit in bursts so people arrive close together.

## The conditions

Two. The condition belongs to the world, so all six people in a group share it.

| Condition | The cast's first three answers to Rita                                                                            |
| --------- | ----------------------------------------------------------------------------------------------------------------- |
| `civil`   | Polite disagreement. "I'm a little worried about deliveries for the shops, but I'd be open to a trial run first." |
| `uncivil` | Insults. "This is the dumbest idea the council has had yet. Do any of them actually work for a living?"           |

The same three cast members answer at the same times in both. Only the tone changes.

## What's scripted to happen

- **Dan answers each participant once.** The first time someone comments on Rita's question, Dan the hardware store owner replies to them a minute or two later. In `civil` it's "Good point, I hadn't thought of it that way." In `uncivil` it's "lol ok. Not sure you've thought this through."
- **Tom comes back with news.** Eight minutes in, Tom comments once for the whole group. He has read the council's plan. In `civil` a three-month trial "seems reasonable to try". In `uncivil` it's "three months of chaos".

## What gets measured

How civil participants' own comments are, and how that changes as more of them write. Truman records every comment with its time. The export has a `world_id` on each participant and each piece of content, so you know who was together. Coding the comments for civility is yours to do.

## Safeguards

Real people can be unkind to each other, so this study has more protection than the others.

- **An automatic rule** removes any post or comment containing "kill yourself" or "kys". It's taken down for everyone else at once, as the Commons Team.
- **A moderator in the cast.** While the study runs, the Monitor page shows what participants write, newest first. A researcher can remove anything, and it looks like an ordinary removal by the Commons Team.
- **The consent page says others are real.** Truman warns you when a shared-world study's consent page doesn't.

The site also has its own terms of service and privacy policy, linked at the bottom of every page, as a real site would. They're part of the fiction. Your debriefing should say so, and should say who was real and who was the cast.

If someone withdraws, what they wrote disappears for the rest of the group. [For IRBs](/irb) covers this.

## How long it runs

About 15 minutes after the world starts, plus up to ten minutes of waiting.

## Getting it

It's in the repository at `studies/examples/town-talk`. Import it with:

```
pnpm study import studies/examples/town-talk
```

Its scenario tests put two made-up participants in one world and check that each sees what the other wrote. [Several real people together](/guide/shared-worlds) explains shared worlds. [Studies as files](/developers/study-files) explains the folder.
